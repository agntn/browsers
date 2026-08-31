import { describe, it, expect } from "vitest";
import {
  BrowserError,
  HTTPError,
  AuthError,
  RateLimitError,
  UnknownProviderError,
  SessionError,
  SessionNotFoundError,
  SessionLimitError,
  NoProviderConfiguredError,
  NoProviderAvailableError,
  EmptyUrlError,
  ScrapeNotSupportedError,
  InvalidInputError,
  UnsupportedOperationError,
  PaymentError,
  parseRetryAfter,
  DEFAULT_RETRY_AFTER,
  normalizeError,
} from "../../src/core/errors";

describe("BrowserError", () => {
  it("base", () => {
    const e = new BrowserError("test");
    expect(e).toBeInstanceOf(Error);
  });
  it("HTTPError", () => {
    const e = new HTTPError(500, "https://api.example.com", "body");
    expect(e.statusCode).toBe(500);
  });
  it("AuthError", () => {
    const e = new AuthError("x402", "bad");
    expect(e).toBeInstanceOf(BrowserError);
  });
  it("RateLimitError", () => {
    const e = new RateLimitError("x402", 30);
    expect(e).toBeInstanceOf(BrowserError);
  });
  it("UnknownProviderError", () => {
    const e = new UnknownProviderError("foo");
    expect(e).toBeInstanceOf(BrowserError);
  });
  it("SessionError", () => {
    const e = new SessionError("x402", "expired");
    expect(e).toBeInstanceOf(BrowserError);
  });
  it("SessionNotFoundError", () => {
    const e = new SessionNotFoundError("x402", "id-1");
    expect(e).toBeInstanceOf(SessionError);
  });
  it("SessionLimitError", () => {
    const e = new SessionLimitError("x402", 10);
    expect(e).toBeInstanceOf(SessionError);
  });
  it("NoProviderConfiguredError", () => {
    const e = new NoProviderConfiguredError();
    expect(e).toBeInstanceOf(BrowserError);
  });
  it("NoProviderAvailableError takes providers array", () => {
    const e = new NoProviderAvailableError(["a", "b"]);
    expect(e).toBeInstanceOf(BrowserError);
    expect(e.providers).toEqual(["a", "b"]);
  });
  it("EmptyUrlError", () => {
    const e = new EmptyUrlError();
    expect(e).toBeInstanceOf(BrowserError);
  });
  it("ScrapeNotSupportedError", () => {
    const e = new ScrapeNotSupportedError("x402");
    expect(e).toBeInstanceOf(BrowserError);
  });
  it("InvalidInputError", () => {
    const e = new InvalidInputError("x402", "url", "bad");
    expect(e).toBeInstanceOf(BrowserError);
  });
  it("UnsupportedOperationError", () => {
    const e = new UnsupportedOperationError("x402", "scrape");
    expect(e).toBeInstanceOf(BrowserError);
  });
  it("PaymentError", () => {
    const e = new PaymentError("x402", "no funds");
    expect(e).toBeInstanceOf(BrowserError);
  });
});

describe("parseRetryAfter", () => {
  it("parses numeric", () => {
    expect(parseRetryAfter("30")).toBe(30);
  });
  it("parses HTTP-date", () => {
    const future = new Date(Date.now() + 60000).toUTCString();
    const r = parseRetryAfter(future);
    expect(r).toBeGreaterThan(0);
  });
  it("returns DEFAULT for null", () => {
    expect(parseRetryAfter(null)).toBe(DEFAULT_RETRY_AFTER);
  });
});

describe("normalizeError", () => {
  it("passes through", () => {
    const e = new EmptyUrlError();
    expect(normalizeError(e)).toBe(e);
  });
  it("wraps Error", () => {
    const out = normalizeError(new Error("oops"));
    expect(out).toBeInstanceOf(BrowserError);
  });
  it("wraps non-Error", () => {
    const out = normalizeError("oops" as unknown);
    expect(out).toBeInstanceOf(BrowserError);
  });
});
