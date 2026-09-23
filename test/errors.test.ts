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
    expect(result.message).toBe(
      `Payment required: HTTP ${statusCode} from https://api.example.com: quota exhausted`,
    );
  });

  it("names the provider and keeps only the reason of a 401 body", () => {
    const body = '{"statusCode":401,"error":"Unauthorized","message":"Unauthorized"}';
    const result = normalizeError(new HTTPError(401, "https://api.browserbase.com/v1", body));
    expect(result.message).toBe("Authentication failed: Unauthorized");

    const named = normalizeError(
      new HTTPError(401, "https://api.hyperbrowser.ai", '{"error":"NOT AUTHENTICATED"}'),
      "hyperbrowser",
    );
    expect(named).toBeInstanceOf(AuthError);
    expect(named.message).toBe("Authentication failed for hyperbrowser: NOT AUTHENTICATED");
  });
});

describe("HTTPError reason", () => {
  // Provider bodies as they came back on 2026-09-23, then two other common shapes.
  it.each([
    [
      "steel",
      422,
      '{"error":"Unprocessable Entity","message":"The scrape action could not load the target page — the site did not respond, refused the connection, or presented an invalid certificate. Verify the URL is reachable; this is not a Steel failure and was not charged."}',
      "The scrape action could not load the target page — the site did not respond, refused the connection, or presented an invalid certificate. Verify the URL is reachable; this is not a Steel failure and was not charged.",
    ],
    [
      "cloudflare",
      422,
      '{"success":false,"errors":[{"code":5006,"message":"Network connection closed.","detail":"Can also happen due to failure to resolve DNS."}]}',
      "Network connection closed. Can also happen due to failure to resolve DNS.",
    ],
    ["anchor", 404, '{"error":{"code":404,"message":"Session not found"}}', "Session not found"],
    ["kernel", 404, '{"code":"not_found","message":"browser not found"}', "browser not found"],
    ["browserless", 500, "Internal Server Error\n", "Internal Server Error"],
    ["fastapi", 404, '{"detail":"Not Found"}', "Not Found"],
    ["plain list", 400, '{"errors":["url is required"]}', "url is required"],
  ])("carries the %s reason", (_provider, statusCode, body, reason) => {
    const error = new HTTPError(statusCode, "https://api.example.com/v1", body);
    expect(error.message).toBe(`HTTP ${statusCode} from https://api.example.com/v1: ${reason}`);
    expect(error.body).toBe(body);
  });

  it.each([
    ["an HTML page", "<!DOCTYPE html><html><body><h1>502 Bad Gateway</h1></body></html>"],
    ["a JSON body with no reason field", '{"code":5006,"success":false}'],
    ["an empty body", ""],
  ])("leaves %s out of the message", (_label, body) => {
    expect(new HTTPError(502, "https://api.example.com", body).message).toBe(
      "HTTP 502 from https://api.example.com",
    );
  });

  it("bounds a long reason to one line", () => {
    const error = new HTTPError(400, "", `bad\n\n${"x".repeat(1000)} 🧭`);
    expect(error.message.startsWith("HTTP 400: bad x")).toBe(true);
    expect(error.message).not.toContain("\n");
    expect(Array.from(error.message.slice("HTTP 400: ".length))).toHaveLength(300);
    expect(error.message.endsWith("…")).toBe(true);
  });
});
