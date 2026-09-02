import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import "../src/providers/index";
import { create } from "../src/core/registry";

interface CapturedRequest {
  method?: string;
  url?: string;
  body: string;
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
    const provider = create("browserless", { apiKey: "test", baseURL });
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

    const releaseProvider = create("browserless", { apiKey: "test", baseURL });
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
});
