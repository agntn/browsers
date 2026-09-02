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

const sessionDetail = {
  id: "session-1",
  status: "active",
  createdAt: "2026-09-02T12:00:00Z",
  wsEndpoint: "wss://hyperbrowser.example/cdp?token=cdp-secret",
  liveUrl: "https://hyperbrowser.example/live?token=live-secret",
  token: "session-secret",
};

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

describe("hyperbrowser current session API", () => {
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
        case "POST /api/session":
        case "GET /api/session/session-1":
          response.end(JSON.stringify(sessionDetail));
          return;
        case "GET /api/sessions":
          response.end(
            JSON.stringify({
              sessions: [
                {
                  id: "session-1",
                  status: "active",
                  createdAt: "2026-09-02T12:00:00Z",
                },
              ],
              totalCount: 1,
              page: 1,
              perPage: 10,
            }),
          );
          return;
        case "PUT /api/session/session-1/stop":
          response.end(JSON.stringify({ success: true }));
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

  it("uses the current lifecycle without exposing provider session metadata", async () => {
    const provider = create("hyperbrowser", { apiKey: "test", baseURL });
    const session = await provider.createSession({
      region: "us-west",
      stealth: true,
      captchaSolving: true,
      profileId: "profile-1",
      timeout: 61_000,
      viewport: { width: 1280, height: 720 },
      proxy: {
        server: "http://proxy.example:8080",
        username: "user",
        password: "pass",
      },
      extra: { tags: { suite: "hyperbrowser" } },
    });

    expect(session).toEqual({
      id: "session-1",
      cdpUrl: "wss://hyperbrowser.example/cdp?token=cdp-secret",
      provider: "hyperbrowser",
      createdAt: Date.parse("2026-09-02T12:00:00Z"),
      metadata: { status: "active" },
    });
    expect(session.metadata).not.toHaveProperty("token");
    expect(session.metadata).not.toHaveProperty("liveUrl");
    expect(session.metadata).not.toHaveProperty("wsEndpoint");
    expect(JSON.parse(requests.at(-1)?.body ?? "")).toEqual({
      region: "us-west",
      useStealth: true,
      solveCaptchas: true,
      profile: { id: "profile-1" },
      timeoutMinutes: 2,
      screen: { width: 1280, height: 720 },
      useProxy: true,
      proxyServer: "http://proxy.example:8080",
      proxyServerUsername: "user",
      proxyServerPassword: "pass",
      tags: { suite: "hyperbrowser" },
    });

    await expect(provider.getSession("session-1")).resolves.toEqual(session);
    await expect(provider.listSessions()).resolves.toEqual([
      {
        id: "session-1",
        provider: "hyperbrowser",
        createdAt: Date.parse("2026-09-02T12:00:00Z"),
        metadata: { status: "active" },
      },
    ]);
    expect(await provider.isAvailable?.()).toBe(true);
    await provider.releaseSession("session-1");

    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "POST /api/session",
      "GET /api/session/session-1",
      "GET /api/sessions",
      "GET /api/sessions",
      "PUT /api/session/session-1/stop",
    ]);
  });
});
