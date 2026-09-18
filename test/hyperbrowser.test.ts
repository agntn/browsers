import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../src/providers/index";
import { create } from "../src/core/registry";

interface CapturedRequest {
  method?: string;
  url?: string;
  body: string;
  apiKey?: string;
}

const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

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
        apiKey: request.headers["x-api-key"] as string | undefined,
      };
      requests.push(captured);

      if (`${request.method} ${request.url}` === "GET /screenshots/shot-1.png") {
        response.setHeader("Content-Type", "image/png");
        response.end(PNG_BYTES);
        return;
      }

      response.setHeader("Content-Type", "application/json");
      switch (`${request.method} ${request.url}`) {
        case "POST /api/web/fetch": {
          const { url } = JSON.parse(captured.body) as { url: string };
          response.end(
            url === "https://down.example/"
              ? JSON.stringify({
                  jobId: "job-2",
                  status: "failed",
                  data: {},
                  error: "net::ERR_TUNNEL_CONNECTION_FAILED at https://down.example",
                })
              : JSON.stringify({
                  jobId: "job-1",
                  status: "completed",
                  data: {
                    metadata: { title: "Example Domain" },
                    screenshot: `${baseURL}/screenshots/shot-1.png`,
                  },
                }),
          );
          return;
        }
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

  it("screenshots through the fetch route without a session", async () => {
    const provider = create("hyperbrowser", { apiKey: "test", baseURL });
    requests.length = 0;

    expect(provider.capabilities().statelessScreenshot).toBe(true);
    const result = await provider.screenshot({
      url: "https://example.com",
      fullPage: false,
      format: "png",
    });

    expect(result).toEqual({
      data: `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
      mimeType: "image/png",
    });
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "POST /api/web/fetch",
      "GET /screenshots/shot-1.png",
    ]);
    expect(JSON.parse(requests[0]?.body ?? "")).toEqual({
      url: "https://example.com",
      outputs: { formats: [{ type: "screenshot", fullPage: false, format: "png" }] },
    });
    expect(requests[0]?.apiKey).toBe("test");
    expect(requests[1]?.apiKey).toBeUndefined();
  });

  it("reports a failed fetch instead of an empty screenshot", async () => {
    const provider = create("hyperbrowser", { apiKey: "test", baseURL });

    await expect(provider.screenshot({ url: "https://down.example/" })).rejects.toThrow(
      "Hyperbrowser returned no screenshot: net::ERR_TUNNEL_CONNECTION_FAILED at https://down.example",
    );
    await expect(provider.screenshot({})).rejects.toThrow("hyperbrowser screenshot requires a URL");
  });
});
