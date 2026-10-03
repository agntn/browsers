import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { describe, it, expect, afterAll, beforeAll } from "vite-plus/test";
import { create } from "../src/core/registry";
import { InvalidInputError, NavigationError, SessionNotFoundError } from "../src/core/errors";
import type { BrowserProvider, BrowserSession } from "../src/core/types";

// A cold Chrome launch on a CI runner takes longer than the 5 s vitest default.
describe("playwright provider (local)", { timeout: 30_000 }, () => {
  let provider: BrowserProvider;
  const sessions: BrowserSession[] = [];

  beforeAll(async () => {
    provider = await create("playwright");
  });

  afterAll(async () => {
    for (const s of sessions) {
      await provider.releaseSession(s.id).catch(() => {});
    }
  });

  it("has correct capabilities", () => {
    const caps = provider.capabilities();
    expect(caps.scrape).toBe(true);
    expect(caps.screenshot).toBe(true);
    expect(caps.navigate).toBe(true);
    expect(caps.evaluate).toBe(true);
    expect(caps.sessions).toBe(true);
    expect(caps.cdp).toBe(false);
    expect(caps.crawl).toBe(true);
    expect(caps.pdf).toBe(true);
    expect(caps.links).toBe(true);
  });

  it("creates and releases a session", async () => {
    const session = await provider.createSession({ headless: true });
    sessions.push(session);
    expect(session.id).toBeTruthy();
    expect(session.provider).toBe("playwright");

    const listed = await provider.listSessions();
    expect(listed.some((s) => s.id === session.id)).toBe(true);

    await provider.releaseSession(session.id);
    sessions.pop();

    const after = await provider.listSessions();
    expect(after.some((s) => s.id === session.id)).toBe(false);
  });

  it("releases a session created by another provider instance", async () => {
    const session = await provider.createSession({ headless: true });
    sessions.push(session);

    const releaseProvider = await create("playwright");
    await expect(releaseProvider.getSession(session.id)).resolves.toEqual(session);
    await expect(releaseProvider.listSessions()).resolves.toContainEqual(session);
    await releaseProvider.releaseSession(session.id);
    sessions.pop();

    await expect(releaseProvider.getSession(session.id)).resolves.toBeNull();
    await expect(provider.listSessions()).resolves.not.toContainEqual(session);
  });

  it("scrapes a data: URL", async () => {
    const result = await provider.scrape(
      "data:text/html,<html><head><title>Test</title></head><body>Hello</body></html>",
    );
    expect(result.html).toContain("Hello");
    expect(result.title).toBe("Test");
    expect(result.text).toContain("Hello");
  });

  it("returns the DOM before a slow image finishes", async () => {
    let delayedResponse: ServerResponse | undefined;
    const server = createServer((request, response) => {
      if (request.url === "/slow.png") {
        delayedResponse = response;
        return;
      }
      response.setHeader("Content-Type", "text/html");
      response.end("<html><body>Ready<img src=/slow.png></body></html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("Missing test server address");

    try {
      const result = await provider.scrape(`http://127.0.0.1:${address.port}`);

      expect(result.text).toContain("Ready");
      expect(delayedResponse).toBeDefined();
    } finally {
      delayedResponse?.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("throws NavigationError without the call log when the page fails to load", async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 500;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("Missing test server address");
    const url = `http://127.0.0.1:${address.port}/`;

    try {
      for (const call of [() => provider.scrape(url), () => provider.links!(url)]) {
        const error = await call().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(NavigationError);
        expect(error).toMatchObject({
          provider: "playwright",
          reason: "ERR_HTTP_RESPONSE_CODE_FAILURE",
          statusCode: undefined,
          message:
            "Playwright couldn't load the page, Chrome showed ERR_HTTP_RESPONSE_CODE_FAILURE",
        });
        expect(String((error as Error).cause)).toContain("Call log");
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("loads the next page in a session after a failed one", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/500") {
        response.statusCode = 500;
        response.end();
      } else if (request.url === "/drop") {
        request.socket.destroy();
      } else {
        response.setHeader("content-type", "text/html");
        response.end("<title>Loaded</title>");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("Missing test server address");
    const base = `http://127.0.0.1:${address.port}`;
    const session = await provider.createSession({ headless: true });
    sessions.push(session);

    try {
      for (const failures of [["/500"], ["/drop"], ["/500", "/drop", "/drop"]]) {
        for (const failing of failures) {
          await expect(
            provider.scrape(`${base}${failing}`, undefined, session),
          ).rejects.toBeInstanceOf(NavigationError);
        }
        for (const _attempt of [1, 2]) {
          await expect(provider.scrape(`${base}/ok`, undefined, session)).resolves.toMatchObject({
            title: "Loaded",
          });
        }
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("preserves a missing-session error while scraping", async () => {
    const session = { id: "executable", provider: "playwright", createdAt: 0 };
    await expect(
      provider.scrape("data:text/html,unused", undefined, session),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it("navigates and evaluates in a session", async () => {
    const session = await provider.createSession({ headless: true });
    sessions.push(session);

    await provider.navigate(
      'data:text/html,<html><body><p id="msg">World</p></body></html>',
      session,
    );
    const evalResult = await provider.evaluate(
      'document.getElementById("msg").textContent',
      session,
    );
    expect(evalResult.value).toBe("World");

    await provider.releaseSession(session.id);
    sessions.pop();
  });

  it("reports a screenshot without a session as an input error", async () => {
    await expect(provider.screenshot({ url: "https://example.test" })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
  });

  it("takes screenshot in a session", async () => {
    const session = await provider.createSession({ headless: true });
    sessions.push(session);

    await provider.navigate("data:text/html,<html><body>Screen</body></html>", session);
    const screenshot = await provider.screenshot({ fullPage: true }, session);
    expect(screenshot.data).toBeTruthy();
    expect(screenshot.mimeType).toBe("image/png");

    await provider.releaseSession(session.id);
    sessions.pop();
  });

  it("captures only the element a selector names", async () => {
    const session = await provider.createSession({ headless: true });
    sessions.push(session);

    await provider.navigate(
      'data:text/html,<body style="margin:0"><div id="box" style="width:120px;height:40px;background:red"></div></body>',
      session,
    );
    const screenshot = await provider.screenshot({ selector: "#box" }, session);
    const png = Buffer.from(screenshot.data, "base64");

    // Width and height sit at bytes 16 and 20 of the PNG header chunk.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([120, 40]);

    await provider.navigate(
      'data:text/html,<body style="margin:0"><p style="margin:0;width:60px;height:20px">a</p><p style="margin:0;width:90px;height:30px">b</p></body>',
      session,
    );
    const first = Buffer.from(
      (await provider.screenshot({ selector: "p" }, session)).data,
      "base64",
    );
    expect([first.readUInt32BE(16), first.readUInt32BE(20)]).toEqual([60, 20]);

    await provider.releaseSession(session.id);
    sessions.pop();
  });
});
