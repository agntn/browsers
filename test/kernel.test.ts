import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { create } from "../src/core/registry";
import { NavigationError } from "../src/core/errors";

interface CapturedRequest {
  method?: string;
  url?: string;
  body: string;
}

const sessionResponse = {
  session_id: "session-1",
  cdp_ws_url: "wss://kernel.example/cdp",
  webdriver_ws_url: "wss://kernel.example/webdriver",
  created_at: "2026-09-02T12:00:00Z",
  headless: true,
  region: "eu-west",
  stealth: true,
  timeout_seconds: 25,
};

/** What Kernel answered for a scrape of a page that returned 500 with no body. */
const navigationFailure =
  'page.goto: net::ERR_HTTP_RESPONSE_CODE_FAILURE at https://httpbin.org/status/500\nCall log:\n\u001B[2m  - navigating to "https://httpbin.org/status/500", waiting until "networkidle"\u001B[22m\n';

/** 5xx answers by URL: Kernel's proxy as recorded on 2026-10-03, a site's own, a forged one. */
const proxyAnswers: Readonly<Record<string, { status: number; text: string }>> = {
  "http://nonexistent.invalid/": {
    status: 502,
    text: "upstream request failed: dial tcp: lookup nonexistent.invalid on 127.0.0.53:53: no such host\n",
  },
  "https://expired.badssl.com/": {
    status: 500,
    text: "egress-proxy-mitm encountered an unexpected error\nchrome tls handshake to expired.badssl.com:443: x509: certificate has expired or is not yet valid\n",
  },
  "https://example.com/503": { status: 503, text: "Down for maintenance" },
  "https://example.com/forged": {
    status: 502,
    text: "upstream request failed: \u001B]8;;https://evil.example\u0007click\u001B]8;;\u0007 \u202Eemos\n",
  },
};

/* Answers a Kernel execute call, with the recorded 5xx for a URL in `proxyAnswers`. */
function executeResponse(body: string): unknown {
  if (body.includes("throw")) return { success: false, error: "execution failed" };
  if (body.includes("status/500")) return { success: false, error: navigationFailure };
  const code = (JSON.parse(body) as { code: string }).code;
  const url = Object.keys(proxyAnswers).find((key) => code.includes(JSON.stringify(key)));
  if (!url) return { success: true, result: "Example Domain", stdout: "done" };
  const serverError = proxyAnswers[url];
  if (!code.includes("page.content()")) return { success: true, result: serverError };
  const html = `<html><body><pre>${serverError?.text ?? ""}</pre></body></html>`;
  return { success: true, result: { serverError, html, title: "" } };
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

describe("kernel current API contract", () => {
  let server: Server;
  let baseURL: string;
  const requests: CapturedRequest[] = [];

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const captured = {
        method: request.method,
        url: request.url,
        body: await readBody(request),
      };
      requests.push(captured);

      response.setHeader("Content-Type", "application/json");
      switch (`${request.method} ${request.url}`) {
        case "POST /browsers":
        case "GET /browsers/session-1":
          response.end(JSON.stringify(sessionResponse));
          return;
        case "GET /browsers":
          response.end(JSON.stringify([sessionResponse]));
          return;
        case "POST /browsers/session-1/playwright/execute":
          response.end(JSON.stringify(executeResponse(captured.body)));
          return;
        case "POST /browsers/session-1/computer/screenshot":
          response.setHeader("Content-Type", "image/png");
          response.end(Buffer.from([137, 80, 78, 71]));
          return;
        case "DELETE /browsers/session-1":
          response.statusCode = 204;
          response.end();
          return;
        default:
          response.statusCode = 404;
          response.end(JSON.stringify({ error: "unexpected request" }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address === "object" && address) baseURL = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("creates and maps a browser session", async () => {
    const provider = await create("kernel", { apiKey: "test", baseURL });
    const session = await provider.createSession({
      region: "eu-west",
      headless: true,
      profileId: "profile-1",
      timeout: 25_900,
      stealth: true,
      viewport: { width: 1280, height: 720 },
      extra: { tags: { suite: "kernel" } },
    });

    expect(session).toEqual({
      id: "session-1",
      cdpUrl: "wss://kernel.example/cdp",
      provider: "kernel",
      createdAt: Date.parse("2026-09-02T12:00:00Z"),
    });
    expect(requests.at(-1)).toMatchObject({ method: "POST", url: "/browsers" });
    expect(JSON.parse(requests.at(-1)?.body ?? "")).toEqual({
      region: "eu-west",
      headless: true,
      profile: { id: "profile-1" },
      timeout_seconds: 25,
      stealth: true,
      viewport: { width: 1280, height: 720 },
      tags: { suite: "kernel" },
    });
  });

  it("uses the current lifecycle and browser control routes", async () => {
    const provider = await create("kernel", { apiKey: "test", baseURL });

    await expect(provider.getSession("session-1")).resolves.toMatchObject({
      id: "session-1",
      cdpUrl: "wss://kernel.example/cdp",
    });
    await expect(provider.listSessions()).resolves.toEqual([
      {
        id: "session-1",
        cdpUrl: "wss://kernel.example/cdp",
        provider: "kernel",
        createdAt: Date.parse("2026-09-02T12:00:00Z"),
      },
    ]);
    await expect(
      provider.evaluate("return await page.title()", {
        id: "session-1",
        provider: "kernel",
        createdAt: 0,
      }),
    ).resolves.toEqual({ value: "Example Domain", logs: ["done"] });
    await expect(
      provider.screenshot(
        {},
        {
          id: "session-1",
          provider: "kernel",
          createdAt: 0,
        },
      ),
    ).resolves.toEqual({
      data: "data:image/png;base64,iVBORw==",
      mimeType: "image/png",
    });
    await provider.releaseSession("session-1");

    expect(requests.slice(-5).map(({ method, url }) => `${method} ${url}`)).toEqual([
      "GET /browsers/session-1",
      "GET /browsers",
      "POST /browsers/session-1/playwright/execute",
      "POST /browsers/session-1/computer/screenshot",
      "DELETE /browsers/session-1",
    ]);
  });

  it("rejects failed Playwright execution envelopes", async () => {
    const provider = await create("kernel", { apiKey: "test", baseURL });
    const session = { id: "session-1", provider: "kernel", createdAt: 0 };

    await expect(provider.evaluate("throw new Error('nope')", session)).rejects.toThrow(
      "execution failed",
    );
  });

  it("throws NavigationError without the call log when the page fails to load", async () => {
    const provider = await create("kernel", { apiKey: "test", baseURL });
    const session = { id: "session-1", provider: "kernel", createdAt: 0 };
    const url = "https://httpbin.org/status/500";

    for (const call of [
      () => provider.scrape(url, undefined, session),
      () => provider.navigate(url, session),
    ]) {
      const error = await call().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NavigationError);
      expect(error).toMatchObject({
        provider: "kernel",
        reason: "ERR_HTTP_RESPONSE_CODE_FAILURE",
        message: "Kernel couldn't load the page, Chrome showed ERR_HTTP_RESPONSE_CODE_FAILURE",
      });
      expect((error as Error).cause).toMatchObject({ message: navigationFailure });
    }
  });

  it("throws NavigationError when Kernel's proxy answers for the site", async () => {
    const provider = await create("kernel", { apiKey: "test", baseURL });
    const session = { id: "session-1", provider: "kernel", createdAt: 0 };
    const cases = [
      {
        url: "http://nonexistent.invalid/",
        statusCode: 502,
        reason:
          "upstream request failed: dial tcp: lookup nonexistent.invalid on 127.0.0.53:53: no such host",
      },
      {
        url: "https://expired.badssl.com/",
        statusCode: 500,
        reason:
          "egress-proxy-mitm encountered an unexpected error: chrome tls handshake to expired.badssl.com:443: x509: certificate has expired or is not yet valid",
      },
    ];

    for (const { url, statusCode, reason } of cases) {
      for (const call of [
        () => provider.scrape(url, undefined, session),
        () => provider.navigate(url, session),
      ]) {
        const error = await call().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(NavigationError);
        expect(error).toMatchObject({
          provider: "kernel",
          statusCode,
          reason,
          message: `Kernel couldn't load the page, Chrome showed ${reason}`,
        });
      }
    }
  });

  it("strips escapes from a site's 5xx that reads like the proxy", async () => {
    const provider = await create("kernel", { apiKey: "test", baseURL });
    const session = { id: "session-1", provider: "kernel", createdAt: 0 };

    await expect(provider.navigate("https://example.com/forged", session)).rejects.toMatchObject({
      reason: "upstream request failed: click emos",
    });
  });

  it("keeps a site's own 5xx page as content", async () => {
    const provider = await create("kernel", { apiKey: "test", baseURL });
    const session = { id: "session-1", provider: "kernel", createdAt: 0 };
    const url = "https://example.com/503";

    await expect(provider.scrape(url, undefined, session)).resolves.toMatchObject({
      html: "<html><body><pre>Down for maintenance</pre></body></html>",
    });
    await expect(provider.navigate(url, session)).resolves.toBeUndefined();
  });
});
