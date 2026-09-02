import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/providers/index";
import { create } from "../src/core/registry";

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
          response.end(
            captured.body.includes("throw")
              ? JSON.stringify({ success: false, error: "execution failed" })
              : JSON.stringify({ success: true, result: "Example Domain", stdout: "done" }),
          );
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
    const provider = create("kernel", { apiKey: "test", baseURL });
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
    const provider = create("kernel", { apiKey: "test", baseURL });

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
    const provider = create("kernel", { apiKey: "test", baseURL });
    const session = { id: "session-1", provider: "kernel", createdAt: 0 };

    await expect(provider.evaluate("throw new Error('nope')", session)).rejects.toThrow(
      "execution failed",
    );
  });
});
