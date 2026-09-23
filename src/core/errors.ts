export class BrowserError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BrowserError";
  }
}

/** Longest provider reason an error message carries; the full body stays on `HTTPError.body`. */
const MAX_REASON_CHARS = 300;

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
 * page gives nothing. The result is one line of at most `MAX_REASON_CHARS` characters, since
 * the message reaches the agent as it is.
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
  const reason = fields.join(" ").replaceAll(/\s+/g, " ").trim();
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
  constructor(retryAfter: number) {
    super(`Rate limited. Retry after ${retryAfter}s`);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
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
      return new RateLimitError(parseRetryAfter(error.response?.headers?.get("Retry-After")));
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
