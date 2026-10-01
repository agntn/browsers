import type { $Fetch, FetchError, FetchOptions } from "ofetch";
import type { ClientOptions } from "./types.ts";
import {
  HTTPError,
  RateLimitError,
  TimeoutError,
  TransportError,
  parseRetryAfter,
} from "./errors.ts";
import { lazy } from "./lazy.ts";
import { version } from "../version.ts";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY = 100;
const DEFAULT_TIMEOUT = 30_000;

/**
 * Headers for a POST whose response is text or bytes: ofetch asks for JSON
 * whenever the body is an object, and Browserless answers that with a 404.
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
  private FetchError: typeof FetchError | undefined;
  /**
   * The configured ofetch instance, imported and created on the first request: ofetch and its
   * fetch polyfill are the heaviest modules the package imports, and a process that only
   * resolves or lists providers never needs them.
   */
  private readonly http = lazy(async (): Promise<$Fetch> => {
    const ofetch = await import("ofetch");
    this.FetchError = ofetch.FetchError;
    return ofetch.ofetch.create({
      timeout: this.timeout,
      retry: this.maxRetries,
      retryDelay: this.baseDelay,
      retryStatusCodes: [408, 429, 500, 502, 503, 504],
      headers: { "User-Agent": this.userAgent },
    });
  });

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
    const fetch = await this.http();
    try {
      return await fetch<T>(url, { headers, ...this.retryControl(signal) });
    } catch (error) {
      throw this.mapError(error, url, signal);
    }
  }

  async postJSON<T>(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<T> {
    const fetch = await this.http();
    try {
      return await fetch<T>(url, { method: "POST", body, headers, ...this.retryControl(signal) });
    } catch (error) {
      throw this.mapError(error, url, signal);
    }
  }

  async putJSON<T>(
    url: string,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<T> {
    const fetch = await this.http();
    try {
      return await fetch<T>(url, { method: "PUT", headers, ...this.retryControl(signal) });
    } catch (error) {
      throw this.mapError(error, url, signal);
    }
  }

  async postText(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string> {
    const fetch = await this.http();
    try {
      const res = await fetch.raw(url, {
        method: "POST",
        body,
        headers: acceptAnyType(headers),
        ...this.retryControl(signal),
      });
      return typeof res._data === "string" ? res._data : String(res._data);
    } catch (error) {
      throw this.mapError(error, url, signal);
    }
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
    const fetch = await this.http();
    try {
      const res = await fetch.raw(url, {
        headers,
        ...this.retryControl(signal),
        responseType: "arrayBuffer",
      });
      return res._data as ArrayBuffer;
    } catch (error) {
      throw this.mapError(error, url, signal);
    }
  }

  async postRaw(
    url: string,
    body: Readonly<Record<string, unknown>>,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    const fetch = await this.http();
    try {
      const res = await fetch.raw(url, {
        method: "POST",
        body,
        headers: acceptAnyType(headers),
        ...this.retryControl(signal),
        responseType: "arrayBuffer",
      });
      return res._data as ArrayBuffer;
    } catch (error) {
      throw this.mapError(error, url, signal);
    }
  }

  async deleteJSON<T>(
    url: string,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<T> {
    const fetch = await this.http();
    try {
      return await fetch<T>(url, { method: "DELETE", headers, ...this.retryControl(signal) });
    } catch (error) {
      throw this.mapError(error, url, signal);
    }
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
    const fetch = await this.http();
    try {
      const res = await fetch.raw(url, {
        method: "POST",
        body,
        headers: acceptAnyType(headers),
        ...this.retryControl(signal),
      });
      const data: unknown = res._data;
      return {
        headers: res.headers as unknown as Headers,
        arrayBuffer: () =>
          data instanceof Blob ? data.arrayBuffer() : Promise.resolve(data as ArrayBuffer),
        json: () => Promise.resolve(data as unknown),
      };
    } catch (error) {
      throw this.mapError(error, url, signal);
    }
  }

  /**
   * ofetch carries its generated signal into retries; each attempt needs its own clock.
   * @param {AbortSignal} [signal] Caller cancellation, shared across attempts.
   * @returns {FetchOptions} Hooks that renew the timeout without renewing cancellation.
   */
  private retryControl(signal?: AbortSignal): Pick<FetchOptions, "onRequest" | "onRequestError"> {
    return {
      onRequest: ({ options }) => {
        signal?.throwIfAborted();
        const timeout =
          this.timeout > 0 ? AbortSignal.timeout(Math.trunc(this.timeout)) : undefined;
        const signals = [signal, timeout].filter((candidate) => candidate !== undefined);
        options.signal = signals.length > 0 ? AbortSignal.any(signals) : undefined;
      },
      onRequestError: ({ options }) => {
        if (signal?.aborted) options.retry = false;
      },
    };
  }

  /**
   * Turns an ofetch failure into the error the caller sees.
   *
   * @param {unknown} error Failure from ofetch.
   * @param {string} url Request URL, sanitized before it reaches a message.
   * @param {AbortSignal} [signal] Caller cancellation: an abort or timeout of its own goes back as is.
   * @returns {Error} The mapped error.
   */
  private mapError(error: unknown, url: string, signal?: AbortSignal): Error {
    const failure: unknown = signal?.aborted ? signal.reason : error;
    if (this.FetchError !== undefined && failure instanceof this.FetchError) {
      return fetchFailure(failure, sanitizeUrl(url), this.timeout);
    }
    return failure instanceof Error ? failure : new Error(String(failure));
  }
}

/**
 * Maps an ofetch failure the caller didn't cancel.
 *
 * @param {FetchError} error Failure from ofetch.
 * @param {string} url Sanitized request URL.
 * @param {number} timeout The client's timeout in milliseconds.
 * @returns {Error} The mapped error.
 */
function fetchFailure(error: FetchError, url: string, timeout: number): Error {
  if (error.cause instanceof Error && error.cause.name === "TimeoutError") {
    return new TimeoutError(timeout, url);
  }
  if (error.response === undefined) return transportError(error.cause, url);
  const body = responseText(error.data);
  if (error.statusCode === 429) {
    const retryAfter = parseRetryAfter(error.response.headers.get("Retry-After"));
    return new RateLimitError(retryAfter, url, body);
  }
  return new HTTPError(error.statusCode ?? 0, url, body);
}

/**
 * The reason is the deepest message in the chain, since `fetch failed` itself says nothing.
 *
 * @param {unknown} cause Cause of the ofetch failure, the `TypeError` fetch threw.
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
 * The body of a failed response as text: the byte routes (`getRaw`, `postRaw`) get an
 * `ArrayBuffer` back from ofetch, which `JSON.stringify` would turn into `{}`.
 *
 * @param {unknown} data Parsed body from the ofetch error.
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
