import { describe, it, expect } from "vitest";
import {
  BrowserError,
  HTTPError,
  AuthError,
  PaymentError,
  RateLimitError,
  UnknownProviderError,
  SessionError,
  SessionNotFoundError,
  SessionLimitError,
  NoProviderConfiguredError,
  NoProviderAvailableError,
  EmptyUrlError,
  ScrapeNotSupportedError,
  parseRetryAfter,
  DEFAULT_RETRY_AFTER,
  normalizeError,
} from "../src/core/errors";

describe("error classes", () => {
  it("BrowserError is base", () => {
    const err = new BrowserError("test");
    expect(err.name).toBe("BrowserError");
    expect(err.message).toBe("test");
    expect(err).toBeInstanceOf(Error);
  });

  it("HTTPError stores status/url/body", () => {
    const err = new HTTPError(404, "https://example.com", "not found");
    expect(err.name).toBe("HTTPError");
    expect(err.statusCode).toBe(404);
    expect(err.url).toBe("https://example.com");
    expect(err.body).toBe("not found");
    expect(err.isNotFound()).toBe(true);
    expect(err.isRateLimit()).toBe(false);
    expect(err.isServerError()).toBe(false);
  });

  it("HTTPError.isRateLimit", () => {
    const err = new HTTPError(429, "", "");
    expect(err.isRateLimit()).toBe(true);
  });

  it("HTTPError.isServerError", () => {
    const err500 = new HTTPError(500, "", "");
    const err503 = new HTTPError(503, "", "");
    const err400 = new HTTPError(400, "", "");
    expect(err500.isServerError()).toBe(true);
    expect(err503.isServerError()).toBe(true);
    expect(err400.isServerError()).toBe(false);
  });

  it("AuthError", () => {
    const err = new AuthError("bad key", "steel");
    expect(err.name).toBe("AuthError");
    expect(err.provider).toBe("steel");
  });

  it("RateLimitError", () => {
    const err = new RateLimitError(30);
    expect(err.name).toBe("RateLimitError");
    expect(err.retryAfter).toBe(30);
    expect(err.message).toContain("30");
  });

  it("UnknownProviderError", () => {
    const err = new UnknownProviderError("foo");
    expect(err.name).toBe("UnknownProviderError");
    expect(err.provider).toBe("foo");
    expect(err.message).toContain("foo");
  });

  it("SessionNotFoundError extends SessionError", () => {
    const err = new SessionNotFoundError("abc", "steel");
    expect(err).toBeInstanceOf(SessionError);
    expect(err.sessionId).toBe("abc");
    expect(err.provider).toBe("steel");
  });

  it("SessionLimitError", () => {
    const err = new SessionLimitError("browserbase");
    expect(err.name).toBe("SessionLimitError");
    expect(err.provider).toBe("browserbase");
  });

  it("NoProviderConfiguredError", () => {
    const err = new NoProviderConfiguredError();
    expect(err.name).toBe("NoProviderConfiguredError");
  });

  it("NoProviderAvailableError", () => {
    const err = new NoProviderAvailableError(["steel", "kernel"]);
    expect(err.providers).toEqual(["steel", "kernel"]);
    expect(err.message).toContain("steel");
  });

  it("EmptyUrlError", () => {
    const err = new EmptyUrlError();
    expect(err.name).toBe("EmptyUrlError");
  });

  it("ScrapeNotSupportedError", () => {
    const err = new ScrapeNotSupportedError("anchor");
    expect(err.provider).toBe("anchor");
  });
});

describe("parseRetryAfter", () => {
  it("returns default for null/undefined", () => {
    expect(parseRetryAfter(null)).toBe(DEFAULT_RETRY_AFTER);
    expect(parseRetryAfter(undefined)).toBe(DEFAULT_RETRY_AFTER);
  });

  it("parses valid seconds", () => {
    expect(parseRetryAfter("30")).toBe(30);
    expect(parseRetryAfter("120")).toBe(120);
  });

  it("returns default for non-numeric", () => {
    expect(parseRetryAfter("foo")).toBe(DEFAULT_RETRY_AFTER);
  });

  it("returns default for zero or negative", () => {
    expect(parseRetryAfter("0")).toBe(DEFAULT_RETRY_AFTER);
    expect(parseRetryAfter("-5")).toBe(DEFAULT_RETRY_AFTER);
  });

  it("returns default for too large (>3600)", () => {
    expect(parseRetryAfter("7200")).toBe(DEFAULT_RETRY_AFTER);
  });
});

describe("normalizeError", () => {
  it("passes through BrowserError", () => {
    const err = new BrowserError("test");
    expect(normalizeError(err)).toBe(err);
  });

  it("converts plain Error to BrowserError", () => {
    const result = normalizeError(new Error("plain"));
    expect(result).toBeInstanceOf(BrowserError);
    expect(result.message).toBe("plain");
  });

  it("converts non-Error to BrowserError", () => {
    const result = normalizeError("string error");
    expect(result).toBeInstanceOf(BrowserError);
    expect(result.message).toBe("string error");
  });

  it("preserves a message from an object with a non-numeric status", () => {
    const result = normalizeError({ status: "500", message: "upstream boom" });
    expect(result).toBeInstanceOf(BrowserError);
    expect(result.message).toBe("upstream boom");
  });

  it.each([402, 403])("maps HTTP %i to a payment error", (statusCode) => {
    const result = normalizeError(
      new HTTPError(statusCode, "https://api.example.com", "quota exhausted"),
      "steel",
    );

    expect(result).toBeInstanceOf(PaymentError);
    expect(result).toMatchObject({ statusCode, provider: "steel" });
    expect(result.message).toBe(`Payment required: HTTP ${statusCode}: https://api.example.com`);
    expect(result.message).not.toContain("quota exhausted");
  });
});
