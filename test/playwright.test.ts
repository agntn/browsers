import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { describe, it, expect, afterAll } from "vitest";
// Import providers/index to register all providers
import "../src/providers/index";
import { create } from "../src/core/registry";
import { SessionNotFoundError } from "../src/core/errors";
import type { BrowserSession } from "../src/core/types";

describe("playwright provider (local)", () => {
  const provider = create("playwright");
  const sessions: BrowserSession[] = [];

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

    const releaseProvider = create("playwright");
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
    let imageFinished = false;
    let delayedResponse: ServerResponse | undefined;
    let delay: NodeJS.Timeout | undefined;
    const server = createServer((request, response) => {
      if (request.url === "/slow.png") {
        delayedResponse = response;
        delay = setTimeout(() => {
          imageFinished = true;
          response.setHeader("Content-Type", "image/png");
          response.end();
        }, 1_000);
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
      expect(imageFinished).toBe(false);
    } finally {
      if (delay) clearTimeout(delay);
      delayedResponse?.destroy();
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
});
