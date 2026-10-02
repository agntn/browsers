import { stripVTControlCharacters } from "node:util";

export class BrowserError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BrowserError";
  }
}

/** Longest provider reason an error message carries; the full body stays on `HTTPError.body`. */
const MAX_REASON_CHARS = 300;

/** Body text read for a reason; `stripVTControlCharacters` is quadratic on unterminated escapes. */
const MAX_REASON_SCAN = MAX_REASON_CHARS * 8;

/** Controls and format marks, bidi overrides included; `\s` already covers U+2028 and U+2029. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}]/gu;

function reasonFields(data: unknown): string[] {
  if (typeof data === "string") return [data];
  if (typeof data !== "object" || data === null) return [];
  if (Array.isArray(data)) return reasonFields(data[0]);
  const { message, error, errors, detail } = data as Record<string, unknown>;
  const main = typeof message === "string" ? [message] : reasonFields(error ?? errors);
  return typeof detail === "string" ? [...main, detail] : main;
}

/**
 * The provider's own explanation of a failed request, read from the response body.
 *
 * JSON bodies give up their `message`, `error` or `detail` field and never land whole; an HTML
 * page gives nothing. The result is one line of at most `MAX_REASON_CHARS` characters with no
 * escape sequences, since the message reaches the agent and the terminal as it is.
 *
 * @param body - Response body as the client received it.
 * @returns {string | undefined} A short reason, or `undefined` when the body has none.
 */
function responseReason(body: string): string | undefined {
  const text = body.trim();
  if (!text || text.startsWith("<")) return undefined;
  let fields: string[];
  try {
    fields = reasonFields(JSON.parse(text));
  } catch {
    fields = [text];
  }
  const reason = stripVTControlCharacters(fields.join(" ").slice(0, MAX_REASON_SCAN))
    .replaceAll(UNPRINTABLE, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (!reason) return undefined;
  const chars = Array.from(reason);
  return chars.length > MAX_REASON_CHARS
    ? `${chars.slice(0, MAX_REASON_CHARS - 1).join("")}…`
    : reason;
}

export class HTTPError extends BrowserError {
  readonly statusCode: number;
  readonly url: string;
  readonly body: string;

  constructor(statusCode: number, url: string, body: string) {
    const reason = responseReason(body);
    super(`HTTP ${statusCode}${url ? ` from ${url}` : ""}${reason ? `: ${reason}` : ""}`);
    this.name = "HTTPError";
    this.statusCode = statusCode;
    this.url = url;
    this.body = body;
  }

  isNotFound(): boolean {
    return this.statusCode === 404;
  }
  isRateLimit(): boolean {
    return this.statusCode === 429;
  }
  isServerError(): boolean {
    return this.statusCode >= 500;
  }
}

export class AuthError extends BrowserError {
  readonly provider: string;
  constructor(message: string, provider: string) {
    super(message);
    this.name = "AuthError";
    this.provider = provider;
  }
}

export class RateLimitError extends BrowserError {
  readonly retryAfter: number;
  readonly url: string;
  readonly body: string;
  readonly provider: string;

  /**
   * @param retryAfter - Seconds to wait, from `Retry-After` or `DEFAULT_RETRY_AFTER`.
   * @param url - Sanitized request URL, so the agent can tell which provider refused.
   * @param body - Response body; its reason tells a burst limit from a used-up quota.
   * @param provider - Provider key, named in the message when there is no URL.
   */
  constructor(retryAfter: number, url = "", body = "", provider = "") {
    const reason = responseReason(body);
    const source = url || provider;
    super(
      `Rate limited${source ? ` by ${source}` : ""}, retry after ${retryAfter}s${reason ? `: ${reason}` : ""}`,
    );
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
    this.url = url;
    this.body = body;
    this.provider = provider;
  }
}

export class TimeoutError extends BrowserError {
  readonly timeout: number;
  readonly url: string;

  /**
   * @param timeout - Milliseconds the client waited for each attempt.
   * @param url - Sanitized request URL, so the agent can tell which provider stayed silent.
   */
  constructor(timeout: number, url = "") {
    super(`Timed out after ${timeout / 1000}s with no response${url ? ` from ${url}` : ""}`);
    this.name = "TimeoutError";
    this.timeout = timeout;
    this.url = url;
  }
}

export class TransportError extends BrowserError {
  readonly url: string;
  readonly reason: string;
  readonly code: string | undefined;

  /**
   * @param url - Sanitized request URL, so the agent can tell which provider was out of reach.
   * @param reason - Why no response came, such as `getaddrinfo ENOTFOUND <host>`.
   * @param code - System error code, such as `ENOTFOUND` or `ECONNREFUSED`.
   * @param options - The system error, kept as `cause`.
   */
  constructor(url: string, reason: string, code?: string, options?: ErrorOptions) {
    const detail = code && !reason.includes(code) ? `${reason} (${code})`.trim() : reason;
    super(`No response${url ? ` from ${url}` : ""}${detail ? `: ${detail}` : ""}`, options);
    this.name = "TransportError";
    this.url = url;
    this.reason = reason;
    this.code = code;
  }
}

export class UnknownProviderError extends BrowserError {
  readonly provider: string;
  constructor(provider: string) {
    super(`Unknown provider: ${provider}`);
    this.name = "UnknownProviderError";
    this.provider = provider;
  }
}

export class SessionError extends BrowserError {
  readonly sessionId: string;
  readonly provider: string;
  constructor(message: string, sessionId: string, provider: string) {
    super(message);
    this.name = "SessionError";
    this.sessionId = sessionId;
    this.provider = provider;
  }
}

export class SessionNotFoundError extends SessionError {
  constructor(sessionId: string, provider: string) {
    super(`Session not found: ${sessionId}`, sessionId, provider);
    this.name = "SessionNotFoundError";
  }
}

export class SessionLimitError extends SessionError {
  constructor(provider: string) {
    super(`Session limit reached for provider: ${provider}`, "", provider);
    this.name = "SessionLimitError";
  }
}

export class NoProviderConfiguredError extends BrowserError {
  constructor() {
    super("No browser provider configured. Set an API key env var or register a provider.");
    this.name = "NoProviderConfiguredError";
  }
}

export class NoProviderAvailableError extends BrowserError {
  readonly providers: readonly string[];
  constructor(providers: readonly string[]) {
    const list = providers.length > 0 ? providers.join(", ") : "unknown";
    super(`No configured browser provider is currently reachable: ${list}`);
    this.name = "NoProviderAvailableError";
    this.providers = providers;
  }
}

export class EmptyUrlError extends BrowserError {
  constructor() {
    super("URL cannot be empty");
    this.name = "EmptyUrlError";
  }
}

export class ScrapeNotSupportedError extends BrowserError {
  readonly provider: string;
  constructor(provider: string) {
    super(`Provider does not support stateless scrape: ${provider}`);
    this.name = "ScrapeNotSupportedError";
    this.provider = provider;
  }
}

export class InvalidInputError extends BrowserError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}

export class UnsupportedOperationError extends BrowserError {
  readonly provider: string;
  constructor(message: string, provider: string) {
    super(message);
    this.name = "UnsupportedOperationError";
    this.provider = provider;
  }
}

export class BlockedPageError extends BrowserError {
  readonly provider: string;
  readonly page: string;

  /**
   * @param provider - Provider key, like `steel`.
   * @param page - What came back instead of content, like `a Reddit captcha`.
   */
  constructor(provider: string, page: string) {
    const label = provider.charAt(0).toUpperCase() + provider.slice(1);
    super(`${label} returned ${page} instead of page content`);
    this.name = "BlockedPageError";
    this.provider = provider;
    this.page = page;
  }
}

export class NavigationError extends BrowserError {
  readonly provider: string;
  readonly reason: string;
  readonly statusCode: number | undefined;

  /**
   * @param provider - Provider key, like `steel`.
   * @param reason - What the browser showed, like `HTTP ERROR 500`, or an empty string.
   * @param statusCode - The site's HTTP status, when the reason carries one.
   * @param options - The browser's own error, kept as `cause`.
   */
  constructor(provider: string, reason: string, statusCode?: number, options?: ErrorOptions) {
    const label = provider.charAt(0).toUpperCase() + provider.slice(1);
    super(`${label} couldn't load the page${reason ? `, Chrome showed ${reason}` : ""}`, options);
    this.name = "NavigationError";
    this.provider = provider;
    this.reason = reason;
    this.statusCode = statusCode;
  }
}

/** Chrome's network error that opens Playwright's message, like `net::ERR_NAME_NOT_RESOLVED`. */
const NET_ERROR_CODE = /^page\.goto: net::(ERR_[A-Z0-9_]+)\b/;

/**
 * Reads a failed Playwright navigation as a `NavigationError`, without Playwright's call log.
 *
 * @param error - What `page.goto` threw, or the error Kernel reported for it.
 * @param provider - Provider key, like `playwright`.
 * @returns {NavigationError | undefined} The error, or `undefined` when Chrome gave no `ERR_` code.
 */
export function navigationFailure(error: unknown, provider: string): NavigationError | undefined {
  const code = error instanceof Error ? NET_ERROR_CODE.exec(error.message)?.[1] : undefined;
  return code ? new NavigationError(provider, code, undefined, { cause: error }) : undefined;
}

export class PaymentError extends BrowserError {
  readonly statusCode: number;
  readonly provider: string;
  constructor(message: string, statusCode: number, provider: string) {
    super(message);
    this.name = "PaymentError";
    this.statusCode = statusCode;
    this.provider = provider;
  }
}

export const DEFAULT_RETRY_AFTER = 60;

export function parseRetryAfter(header: string | null | undefined): number {
  if (header === null || header === undefined) return DEFAULT_RETRY_AFTER;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_RETRY_AFTER;
  const parsed = Number.parseInt(trimmed, 10);
  return parsed > 0 && parsed < 3600 ? parsed : DEFAULT_RETRY_AFTER;
}

interface StatusError {
  readonly status: number;
  readonly message: string;
  readonly response?: {
    readonly headers?: { readonly get: (key: string) => string | null };
  };
}

function isStatusError(error: unknown): error is StatusError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    "message" in error &&
    typeof error.message === "string"
  );
}

function objectErrorMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("message" in error)) return undefined;
  return typeof error.message === "string" ? error.message : undefined;
}

function effectiveProvider(provider: string | undefined): string {
  return provider || "unknown";
}

function messageOrDefault(message: string, fallback: string): string {
  return message || fallback;
}

function normalizeStatusError(error: StatusError, provider?: string): BrowserError {
  const message = messageOrDefault(error.message, `HTTP ${error.status}`);
  switch (error.status) {
    case 401:
      return new AuthError(`Authentication failed: ${message}`, effectiveProvider(provider));
    case 402:
    case 403:
      return new PaymentError(
        `Payment required: ${message}`,
        error.status,
        effectiveProvider(provider),
      );
    case 429:
      return new RateLimitError(
        parseRetryAfter(error.response?.headers?.get("Retry-After")),
        "",
        error.message,
        provider,
      );
    default:
      return error.status >= 500
        ? new HTTPError(error.status, "", message)
        : new BrowserError(message);
  }
}

function authFailure(body: string, provider?: string): AuthError {
  const reason = responseReason(body) ?? "Invalid or missing API key";
  const target = provider ? ` for ${provider}` : "";
  return new AuthError(`Authentication failed${target}: ${reason}`, effectiveProvider(provider));
}

export function normalizeError(error: unknown, provider?: string): BrowserError {
  if (error instanceof HTTPError) {
    if (error.statusCode === 401) return authFailure(error.body, provider);
    if (error.statusCode === 402 || error.statusCode === 403) {
      return new PaymentError(
        `Payment required: ${error.message}`,
        error.statusCode,
        effectiveProvider(provider),
      );
    }
  }
  if (error instanceof BrowserError) return error;
  if (isStatusError(error)) return normalizeStatusError(error, provider);
  if (error instanceof Error) return new BrowserError(error.message);
  const message = objectErrorMessage(error);
  return new BrowserError(message ?? String(error));
}
