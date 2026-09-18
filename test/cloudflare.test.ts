import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/providers/index";
import { resetDefaultClientForTests } from "../src/core/client";
import { create } from "../src/core/registry";
import { browserScrape } from "../src/tool-operations";

const previousToken = process.env.CF_API_TOKEN;
const previousAccountID = process.env.CF_ACCOUNT_ID;

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

function cloudflareResponse(url: string): Response {
  if (url.includes("/screenshot")) {
    return new Response(Uint8Array.from([137, 80, 78, 71]), {
      headers: { "Content-Type": "image/png" },
    });
  }
  if (url.includes("/pdf")) {
    return new Response(Uint8Array.from([37, 80, 68, 70]), {
      headers: { "Content-Type": "application/pdf" },
    });
  }
  if (url.includes("/devtools/browser")) {
    return jsonResponse({
      sessionId: "session-1",
      webSocketDebuggerUrl: "wss://example.test/session-1",
    });
  }
  if (url.includes("/devtools/session")) return jsonResponse([]);

  let result: unknown = {};
  if (url.includes("/content")) result = "<html>Kitesurf</html>";
  else if (url.includes("/crawl")) result = "crawl-1";
  else if (url.includes("/links")) result = ["https://example.test/about"];
  else if (url.includes("/json")) result = { title: "Example" };
  return jsonResponse({ success: true, result });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetDefaultClientForTests();
  if (previousToken === undefined) delete process.env.CF_API_TOKEN;
  else process.env.CF_API_TOKEN = previousToken;
  if (previousAccountID === undefined) delete process.env.CF_ACCOUNT_ID;
  else process.env.CF_ACCOUNT_ID = previousAccountID;
});

describe("cloudflare browser selection", () => {
  it("routes Kitesurf calls through the documented Browser Run endpoints", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = input instanceof Request ? input.url : String(input);
        urls.push(url);
        return cloudflareResponse(url);
      }),
    );
    resetDefaultClientForTests();

    const provider = create("cloudflare", {
      apiKey: "test-token",
      accountID: "test-account",
      browser: "kitesurf",
    });

    const session = await provider.createSession({ timeout: 60_000 });
    await provider.getSession("session-1");
    await provider.listSessions();
    await provider.scrape("https://example.test");
    await provider.screenshot({ url: "https://example.test" });
    await provider.crawl?.("https://example.test");
    await provider.pdf?.("https://example.test");
    await provider.links?.("https://example.test");
    await provider.extract?.("https://example.test", { prompt: "Extract the title" });
    await provider.releaseSession("session-1");

    expect(session.cdpUrl).toBe("wss://example.test/session-1");
    expect(urls).toEqual([
      "https://api.cloudflare.com/client/v4/accounts/test-account/browser-run/devtools/browser?keep_alive=60000&browser=kitesurf",
      "https://api.cloudflare.com/client/v4/accounts/test-account/browser-run/devtools/browser/session-1?browser=kitesurf",
      "https://api.cloudflare.com/client/v4/accounts/test-account/browser-run/devtools/session?browser=kitesurf",
      "https://api.cloudflare.com/client/v4/accounts/test-account/browser-run/content?browser=kitesurf",
      "https://api.cloudflare.com/client/v4/accounts/test-account/browser-run/screenshot?browser=kitesurf",
      "https://api.cloudflare.com/client/v4/accounts/test-account/browser-run/crawl?browser=kitesurf",
      "https://api.cloudflare.com/client/v4/accounts/test-account/browser-run/pdf?browser=kitesurf",
      "https://api.cloudflare.com/client/v4/accounts/test-account/browser-run/links?browser=kitesurf",
      "https://api.cloudflare.com/client/v4/accounts/test-account/browser-run/json?browser=kitesurf",
      "https://api.cloudflare.com/client/v4/accounts/test-account/browser-run/devtools/browser/session-1?browser=kitesurf",
    ]);
  });

  it("selects Cloudflare automatically when an agent requests Kitesurf", async () => {
    const urls: string[] = [];
    process.env.CF_API_TOKEN = "test-token";
    process.env.CF_ACCOUNT_ID = "test-account";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        urls.push(input instanceof Request ? input.url : String(input));
        return new Response(JSON.stringify({ success: true, result: "<html>Kitesurf</html>" }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    resetDefaultClientForTests();

    const result = await browserScrape({
      browser: "kitesurf",
      url: "https://example.test",
    });

    expect(result.details.provider).toBe("cloudflare");
    expect(urls).toEqual([
      "https://api.cloudflare.com/client/v4/accounts/test-account/browser-run/content?browser=kitesurf",
    ]);
  });

  it("keeps Chromium as the Cloudflare default", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        urls.push(input instanceof Request ? input.url : String(input));
        return new Response(JSON.stringify({ success: true, result: "<html>Chromium</html>" }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    resetDefaultClientForTests();

    const provider = create("cloudflare", {
      apiKey: "test-token",
      accountID: "test-account",
    });
    await provider.scrape("https://example.test");

    expect(urls).toEqual([
      "https://api.cloudflare.com/client/v4/accounts/test-account/browser-rendering/content",
    ]);
  });

  it("rejects undocumented browser engines before network I/O", () => {
    expect(() =>
      create("cloudflare", {
        apiKey: "test-token",
        accountID: "test-account",
        browser: "firefox" as never,
      }),
    ).toThrow('Unsupported Cloudflare browser: "firefox"');
  });
});
