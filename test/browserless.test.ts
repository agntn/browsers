import { execSync } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SessionNotFoundError } from "../src/core/errors";
import { create } from "../src/core/registry";

interface CapturedRequest {
  method?: string;
  url?: string;
  body: string;
}

const PNG_BYTES = Buffer.from([137, 80, 78, 71]);
const PDF_BYTES = Buffer.from("%PDF-1.4");

/**
 * Answers the stateless capture routes the way Browserless does: bytes for
 * any client that accepts them, 404 for one that asks for JSON.
 *
 * @param {IncomingMessage} req Incoming request.
 * @param {ServerResponse} res Response to write.
 * @returns {boolean} Whether the request was a capture route.
 */
function serveCapture(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "POST") return false;
  if (req.url !== "/screenshot?token=test" && req.url !== "/pdf?token=test") return false;
  if (req.headers.accept?.includes("application/json")) {
    res.statusCode = 404;
    res.end("Not Found: check that your Content-Type header is supported");
    return true;
  }
  const pdf = req.url.startsWith("/pdf");
  res.setHeader("Content-Type", pdf ? "application/pdf" : "image/png");
  res.end(pdf ? PDF_BYTES : PNG_BYTES);
  return true;
}

describe("browserless current session API", () => {
  let server: Server;
  let baseURL: string;
  const requests: CapturedRequest[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        requests.push({ method: req.method, url: req.url, body });
        if (req.method === "POST" && req.url === "/session?token=test") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              id: "session-1",
              connect: "wss://browserless.test/session/connect/session-1?token=test",
              stop: `${baseURL}/session/opaque-stop?token=test&signature=keep`,
              ttl: 120_000,
            }),
          );
          return;
        }
        if (
          req.method === "DELETE" &&
          req.url === "/session/opaque-stop?token=test&signature=keep"
        ) {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (serveCapture(req, res)) return;
        res.statusCode = 404;
        res.end("not found");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address === "object" && address) baseURL = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    requests.length = 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("creates and releases through the URLs returned by Browserless", async () => {
    const provider = await create("browserless", { apiKey: "test", baseURL });
    const session = await provider.createSession({
      timeout: 120_000,
      stealth: true,
      extra: { processKeepAlive: 10_000 },
    });

    expect(session).toMatchObject({
      id: "session-1",
      cdpUrl: "wss://browserless.test/session/connect/session-1?token=test",
      provider: "browserless",
    });
    expect(session.metadata).toBeUndefined();

    const releaseProvider = await create("browserless", { apiKey: "test", baseURL });
    await expect(releaseProvider.getSession(session.id)).resolves.toEqual(session);
    await expect(releaseProvider.listSessions()).resolves.toEqual([session]);
    await releaseProvider.releaseSession(session.id);
    await expect(releaseProvider.getSession(session.id)).resolves.toBeNull();
    await expect(releaseProvider.listSessions()).resolves.toEqual([]);

    expect(requests).toEqual([
      {
        method: "POST",
        url: "/session?token=test",
        body: JSON.stringify({ ttl: 120_000, stealth: true, processKeepAlive: 10_000 }),
      },
      {
        method: "DELETE",
        url: "/session/opaque-stop?token=test&signature=keep",
        body: "",
      },
    ]);
  });

  it("captures screenshots and PDFs from endpoints that refuse JSON clients", async () => {
    const provider = await create("browserless", { apiKey: "test", baseURL });

    const screenshot = await provider.screenshot({ url: "https://example.com" });
    const pdf = await provider.pdf?.("https://example.com");

    expect(screenshot).toEqual({
      data: `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
      mimeType: "image/png",
    });
    expect(pdf).toEqual({
      data: `data:application/pdf;base64,${PDF_BYTES.toString("base64")}`,
      mimeType: "application/pdf",
    });
    expect(requests.map((request) => request.url)).toEqual([
      "/screenshot?token=test",
      "/pdf?token=test",
    ]);
  });

  it("asks for one element when given a selector", async () => {
    const provider = await create("browserless", { apiKey: "test", baseURL });

    await provider.screenshot({ url: "https://example.com", selector: "#price" });

    expect(requests.map((request) => JSON.parse(request.body) as unknown)).toEqual([
      { url: "https://example.com", selector: "#price" },
    ]);
  });
});

function systemChromium(): string | undefined {
  for (const name of ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]) {
    try {
      const path = execSync(`which ${name}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      if (path) return path;
    } catch {
      // not found
    }
  }
  return undefined;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

// A cold Chrome launch on a CI runner takes longer than the vitest defaults,
// and a suite timeout does not reach its hooks, so beforeAll gets its own.
const chromeTimeout = 30_000;

describe("browserless session page", { timeout: chromeTimeout }, () => {
  let chrome: Browser;
  let server: Server;
  let baseURL: string;
  const paths: string[] = [];

  beforeAll(async () => {
    const cdpPort = await freePort();
    chrome = await chromium.launch({
      executablePath: systemChromium(),
      args: [`--remote-debugging-port=${cdpPort}`],
    });
    server = createServer((req, res) => {
      paths.push(`${req.method} ${req.url}`);
      if (req.method === "POST" && req.url === "/session?token=test") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            id: "cdp-session",
            connect: `http://127.0.0.1:${cdpPort}`,
            stop: `${baseURL}/session/cdp-session?token=test`,
          }),
        );
        return;
      }
      if (req.method === "DELETE" && req.url === "/session/cdp-session?token=test") {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method === "GET" && req.url === "/page") {
        res.setHeader("Content-Type", "text/html");
        res.end("<title>Session page</title><h1>kept</h1>");
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, chromeTimeout);

  afterAll(async () => {
    await chrome?.close();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("evaluates in the page navigate opened", async () => {
    const provider = await create("browserless", { apiKey: "test", baseURL });
    const session = await provider.createSession();

    await provider.navigate(`${baseURL}/page`, session);
    const other = await create("browserless", { apiKey: "test", baseURL });
    await expect(other.evaluate("document.title", session)).resolves.toEqual({
      value: "Session page",
    });
    await expect(
      provider.evaluate("document.querySelector('h1').textContent", session),
    ).resolves.toEqual({ value: "kept" });

    await provider.releaseSession(session.id);
    await expect(provider.evaluate("1 + 1", session)).rejects.toBeInstanceOf(SessionNotFoundError);
    expect(paths.filter((path) => !path.startsWith("GET "))).toEqual([
      "POST /session?token=test",
      "DELETE /session/cdp-session?token=test",
    ]);
  });

  it("fails for a session it did not create", async () => {
    const provider = await create("browserless", { apiKey: "test", baseURL });
    const session = { id: "missing", provider: "browserless", createdAt: 0 };

    await expect(provider.navigate(`${baseURL}/page`, session)).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
    await expect(provider.evaluate("1 + 1", session)).rejects.toBeInstanceOf(SessionNotFoundError);
  });
});
