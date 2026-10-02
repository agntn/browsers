import type { ClientOptions } from "./types.ts";
import {
  HTTPError,
  RateLimitError,
  TimeoutError,
  TransportError,
  parseRetryAfter,
} from "./errors.ts";
import { version } from "../version.ts";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY = 100;
const DEFAULT_TIMEOUT = 30_000;

/** Statuses worth another attempt. A request that got no response is retried too. */
const RETRY_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/** Statuses that never carry a body. */
const EMPTY_STATUS_CODES = new Set([101, 204, 205, 304]);

/** How a response body is read: parsed as JSON where it is JSON, as text, or as bytes. */
type BodyFormat = "json" | "text" | "bytes";

interface Call {
  readonly method: string;
  readonly body?: Readonly<Record<string, unknown>>;
  readonly headers?: Headers | Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly format: BodyFormat;
}

interface Init {
  readonly method: string;
  readonly headers: Headers;
  readonly body?: string;
}

interface Reply {
  readonly headers: Headers;
  readonly data: unknown;
}

type Attempt = { readonly reply: Reply } | { readonly error: Error; readonly retry: boolean };

/**
 * Headers for a POST whose response is text or bytes: a JSON body would otherwise ask for
 * JSON back, and Browserless answers that with a 404.
 *
 * @param {Readonly<Record<string, string>>} [headers] Caller headers, kept as given.
 * @returns {Headers} Headers that accept any content type unless the caller chose one.
 */
function acceptAnyType(headers?: Readonly<Record<string, string>>): Headers {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("Accept")) requestHeaders.set("Accept", "*/*");
  return requestHeaders;
}

export class Client {
  readonly maxRetries: number;
  readonly baseDelay: number;
  readonly timeout: number;
  readonly userAgent: string;

  constructor(options: ClientOptions = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelay = options.baseDelay ?? DEFAULT_BASE_DELAY;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.userAgent = options.userAgent ?? `browsers/${version}`;
  }

  async getJSON<T>(
    url: string,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<T> {
    const reply = await this.request(url, { method: "GET", headers, signal, format: "json" });
    return reply.data as T;
  }

  async postJSON<T>(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<T> {
    const reply = await this.request(url, {
      method: "POST",
      body,
      headers,
      signal,
      format: "json",
    });
    return reply.data as T;
  }

  async putJSON<T>(
    url: string,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<T> {
    const reply = await this.request(url, { method: "PUT", headers, signal, format: "json" });
    return reply.data as T;
  }

  async postText(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string> {
    const reply = await this.request(url, {
      method: "POST",
      body,
      headers: acceptAnyType(headers),
      signal,
      format: "text",
    });
    return typeof reply.data === "string" ? reply.data : "";
  }

  /**
   * GET whose response is bytes, such as a screenshot a vendor stores at a URL.
   *
   * @param {string} url Target URL.
   * @param {Readonly<Record<string, string>>} [headers] Request headers.
   * @param {AbortSignal} [signal] Cancellation signal.
   * @returns {Promise<ArrayBuffer>} Response body.
   */
  async getRaw(
    url: string,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    const reply = await this.request(url, { method: "GET", headers, signal, format: "bytes" });
    return reply.data as ArrayBuffer;
  }

  async postRaw(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    const reply = await this.request(url, {
      method: "POST",
      body,
      headers: acceptAnyType(headers),
      signal,
      format: "bytes",
    });
    return reply.data as ArrayBuffer;
  }

  async deleteJSON<T>(
    url: string,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<T> {
    const reply = await this.request(url, { method: "DELETE", headers, signal, format: "json" });
    return reply.data as T;
  }

  /**
   * POST that returns a response-like object for content type inspection.
   *
   * @param {string} url Target URL.
   * @param {Readonly<Record<string, unknown>>} body Request body.
   * @param {Readonly<Record<string, string>>} [headers] Request headers.
   * @param {AbortSignal} [signal] Cancellation signal.
   * @returns {Promise<{ headers: Headers; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<unknown> }>} Response readers and headers.
   */
  async postResponse(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<{ headers: Headers; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<unknown> }> {
    const reply = await this.request(url, {
      method: "POST",
      body,
      headers: acceptAnyType(headers),
      signal,
      format: "bytes",
    });
    const data = (reply.data as ArrayBuffer | undefined) ?? new ArrayBuffer(0);
    return {
      headers: reply.headers,
      arrayBuffer: () => Promise.resolve(data),
      json: () => Promise.resolve(parseJSON(new TextDecoder().decode(data))),
    };
  }

  /**
   * A caller who cancelled gets their own reason back, whatever failed underneath.
   *
   * @param {string} url Target URL.
   * @param {Call} request Method, body, headers, cancellation and body format.
   * @returns {Promise<Reply>} Headers and body of the successful response.
   */
  private async request(url: string, request: Call): Promise<Reply> {
    try {
      return await this.send(url, request);
    } catch (error) {
      const failure: unknown = request.signal?.aborted ? request.signal.reason : error;
      throw failure instanceof Error ? failure : new Error(String(failure));
    }
  }

  /**
   * Retries with a fresh timeout per attempt until the budget or the caller's signal runs out.
   *
   * @param {string} url Target URL.
   * @param {Call} request Method, body, headers, cancellation and body format.
   * @returns {Promise<Reply>} Headers and body of the successful response.
   */
  private async send(url: string, request: Call): Promise<Reply> {
    const init = requestInit(request, this.userAgent);
    for (let retries = this.maxRetries; ; retries -= 1) {
      request.signal?.throwIfAborted();
      const outcome = await this.attempt(url, init, request);
      if ("reply" in outcome) return outcome.reply;
      if (retries <= 0 || !outcome.retry) throw outcome.error;
      await this.backoff();
    }
  }

  /**
   * One request: a failure says whether to retry, and the caller's cancellation is thrown.
   *
   * @param {string} url Target URL.
   * @param {Init} init Method, headers and serialized body.
   * @param {Call} request Cancellation and body format.
   * @returns {Promise<Attempt>} The reply, or the mapped error.
   */
  private async attempt(url: string, init: Init, request: Call): Promise<Attempt> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: this.attemptSignal(request.signal) });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      return { error: noResponse(error, sanitizeUrl(url), this.timeout), retry: true };
    }
    const data = await readBody(response, init.method, request.format);
    if (response.status < 400 || response.status >= 600) {
      return { reply: { headers: response.headers, data } };
    }
    return {
      error: failedResponse(response, data, sanitizeUrl(url)),
      retry: RETRY_STATUS_CODES.has(response.status),
    };
  }

  /**
   * The signal for one attempt: the caller's, joined with a timeout of its own.
   *
   * @param {AbortSignal} [signal] Caller cancellation.
   * @returns {AbortSignal | undefined} The combined signal, or none when neither applies.
   */
  private attemptSignal(signal?: AbortSignal): AbortSignal | undefined {
    const timeout = this.timeout > 0 ? AbortSignal.timeout(Math.trunc(this.timeout)) : undefined;
    const signals = [signal, timeout].filter((candidate) => candidate !== undefined);
    return signals.length > 0 ? AbortSignal.any(signals) : undefined;
  }

  /**
   * Waits out the retry delay.
   *
   * @returns {Promise<void>} Resolves after `baseDelay` milliseconds.
   */
  private async backoff(): Promise<void> {
    if (this.baseDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.baseDelay));
    }
  }
}

/**
 * Caller headers over the user agent, and a JSON body that asks for JSON back by default.
 *
 * @param {Call} request Method, body and headers.
 * @param {string} userAgent The client's user agent.
 * @returns {Init} What every attempt sends.
 */
function requestInit(request: Call, userAgent: string): Init {
  const headers = new Headers({ "User-Agent": userAgent });
  for (const [name, value] of new Headers(request.headers)) headers.set(name, value);
  if (request.body === undefined) {
    return { method: request.method, headers };
  }
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return { method: request.method, headers, body: JSON.stringify(request.body) };
}

/**
 * Reads a response body in the format the route expects.
 *
 * @param {Response} response The response.
 * @param {string} method Request method.
 * @param {BodyFormat} format How to read the body.
 * @returns {Promise<unknown>} The body, or `undefined` when the response has none.
 */
async function readBody(response: Response, method: string, format: BodyFormat): Promise<unknown> {
  if (!response.body || EMPTY_STATUS_CODES.has(response.status) || method === "HEAD") {
    return undefined;
  }
  if (format === "bytes") return response.arrayBuffer();
  const text = await response.text();
  return format === "json" ? parseJSON(text) : text;
}

/**
 * JSON when the text parses, the text otherwise, without keys that could reach a prototype.
 *
 * @param {string} text Response text.
 * @returns {unknown} The parsed value or the text.
 */
function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text, (key, value: unknown) =>
      key === "__proto__" ||
      (key === "constructor" && typeof value === "object" && value !== null && "prototype" in value)
        ? undefined
        : value,
    );
  } catch {
    return text;
  }
}

/**
 * Maps a response with an error status.
 *
 * @param {Response} response The response.
 * @param {unknown} data Its body, as read for the route.
 * @param {string} url Sanitized request URL.
 * @returns {Error} The rate limit or HTTP error.
 */
function failedResponse(response: Response, data: unknown, url: string): Error {
  const body = responseText(data);
  if (response.status === 429) {
    const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
    return new RateLimitError(retryAfter, url, body);
  }
  return new HTTPError(response.status, url, body);
}

/**
 * Maps a request that got no response and that the caller didn't cancel.
 *
 * @param {unknown} error What `fetch` threw.
 * @param {string} url Sanitized request URL.
 * @param {number} timeout The client's timeout in milliseconds.
 * @returns {Error} The timeout or transport error.
 */
function noResponse(error: unknown, url: string, timeout: number): Error {
  if (error instanceof Error && error.name === "TimeoutError") {
    return new TimeoutError(timeout, url);
  }
  return transportError(error, url);
}

/**
 * The reason is the deepest message in the chain, since `fetch failed` itself says nothing.
 *
 * @param {unknown} cause What `fetch` threw, usually a `TypeError` with the system error below.
 * @param {string} url Sanitized request URL.
 * @returns {TransportError} The error with its reason, code and system error.
 */
function transportError(cause: unknown, url: string): TransportError {
  const chain = causeChain(cause);
  const reason = chain.findLast((error) => error.message)?.message ?? "";
  const system = chain.find((error) => typeof systemCode(error) === "string");
  const safeReason = reason
    .replaceAll(/https?:\/\/\S+/g, (match) => sanitizeUrl(match))
    .replaceAll(/\s+/g, " ")
    .trim();
  return new TransportError(
    url,
    safeReason,
    system && systemCode(system),
    system && { cause: system },
  );
}

/**
 * Each error down the `cause` links, through the first attempt of an `AggregateError`.
 *
 * @param {unknown} error Outermost error.
 * @returns {Error[]} The chain, outermost first, at most eight deep.
 */
function causeChain(error: unknown): Error[] {
  const chain: Error[] = [];
  for (let current = error; current instanceof Error && chain.length < 8;) {
    chain.push(current);
    current = current.cause ?? (current instanceof AggregateError ? current.errors[0] : undefined);
  }
  return chain;
}

/**
 * The `code` Node puts on a system error.
 *
 * @param {Error} error Any error.
 * @returns {string | undefined} The code, when it is a string.
 */
function systemCode(error: Readonly<Error>): string | undefined {
  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : undefined;
}

/**
 * The body of a failed response as text: the byte routes (`getRaw`, `postRaw`) read an
 * `ArrayBuffer`, which `JSON.stringify` would turn into `{}`.
 *
 * @param {unknown} data Body as read for the route.
 * @returns {string} The body as the provider sent it, or its JSON form.
 */
function responseText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  return JSON.stringify(data ?? "");
}

/** Query parameters that carry a credential, compared in lower case. */
const SENSITIVE_PARAMS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "key",
  "password",
  "secret",
  "sig",
  "signature",
  "token",
  "x-amz-credential",
  "x-amz-security-token",
  "x-amz-signature",
]);

/**
 * The request URL as an error may show it: credentials in the userinfo and in the query,
 * signed stop URLs included, become `[REDACTED]`.
 *
 * @param {string} url Request URL.
 * @returns {string} The URL without its credentials.
 */
function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username) parsed.username = "[REDACTED]";
    if (parsed.password) parsed.password = "[REDACTED]";
    for (const param of new Set(parsed.searchParams.keys())) {
      if (SENSITIVE_PARAMS.has(param.toLowerCase())) {
        parsed.searchParams.set(param, "[REDACTED]");
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

let _defaultClient: Client | undefined;

export function defaultClient(): Client {
  _defaultClient ??= new Client();
  return _defaultClient;
}

export function resetDefaultClientForTests(): void {
  _defaultClient = undefined;
}
