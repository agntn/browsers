import type { $Fetch, FetchError, FetchOptions } from "ofetch";
import type { ClientOptions } from "./types.ts";
import { HTTPError, RateLimitError, parseRetryAfter } from "./errors.ts";
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
      throw this.mapError(error, url);
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
      throw this.mapError(error, url);
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
      throw this.mapError(error, url);
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
      throw this.mapError(error, url);
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
      throw this.mapError(error, url);
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
      throw this.mapError(error, url);
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
      throw this.mapError(error, url);
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
      throw this.mapError(error, url);
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

  private mapError(error: unknown, url: string): Error {
    if (this.FetchError !== undefined && error instanceof this.FetchError) {
      if (error.statusCode === 429) {
        const retryAfter = parseRetryAfter(error.response?.headers.get("Retry-After"));
        return new RateLimitError(retryAfter);
      }
      const body = typeof error.data === "string" ? error.data : JSON.stringify(error.data ?? "");
      return new HTTPError(error.statusCode ?? 0, sanitizeUrl(url), body);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

const SENSITIVE_PARAMS = ["api_key", "key", "token", "secret", "password", "apikey"];

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const param of SENSITIVE_PARAMS) {
      if (parsed.searchParams.has(param)) {
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
