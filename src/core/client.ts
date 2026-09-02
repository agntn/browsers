import { ofetch, FetchError } from "ofetch";
import type { $Fetch } from "ofetch";
import type { ClientOptions } from "./types";
import { HTTPError, RateLimitError, parseRetryAfter } from "./errors";
import { version } from "../version";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY = 100;
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_USER_AGENT = `browsers/${version}`;

export class Client {
  readonly maxRetries: number;
  readonly baseDelay: number;
  readonly timeout: number;
  readonly userAgent: string;
  private readonly fetch: $Fetch;

  constructor(options: ClientOptions = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelay = options.baseDelay ?? DEFAULT_BASE_DELAY;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetch = ofetch.create({
      timeout: this.timeout,
      retry: this.maxRetries,
      retryDelay: this.baseDelay,
      retryStatusCodes: [408, 429, 500, 502, 503, 504],
      headers: { "User-Agent": this.userAgent },
    });
  }

  async getJSON<T>(
    url: string,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return await this.fetch<T>(url, { headers, signal });
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
    try {
      return await this.fetch<T>(url, { method: "POST", body, headers, signal });
    } catch (error) {
      throw this.mapError(error, url);
    }
  }

  async putJSON<T>(
    url: string,
    headers?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return await this.fetch<T>(url, { method: "PUT", headers, signal });
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
    try {
      const res = await this.fetch.raw(url, {
        method: "POST",
        body,
        headers,
        signal,
      });
      return typeof res._data === "string" ? res._data : String(res._data);
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
    try {
      const res = await this.fetch.raw(url, {
        method: "POST",
        body,
        headers,
        signal,
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
    try {
      return await this.fetch<T>(url, { method: "DELETE", headers, signal });
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
    try {
      const res = await this.fetch.raw(url, {
        method: "POST",
        body,
        headers,
        signal,
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

  private mapError(error: unknown, url: string): Error {
    if (error instanceof FetchError) {
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
