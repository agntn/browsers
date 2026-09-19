import { createServer } from "node:http";
import type { Server } from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { create } from "../src/core/registry";
import { UnsupportedOperationError } from "../src/core/errors";

interface CapturedRequest {
  method?: string;
  url?: string;
  body: string;
}

describe("browserbase releaseSession", () => {
  let server: Server;
  let baseURL: string;
  const captured: CapturedRequest = { body: "" };

  beforeAll(async () => {
    server = createServer((req, res) => {
      captured.method = req.method;
      captured.url = req.url;
      captured.body = "";
      req.on("data", (chunk) => {
        captured.body += chunk;
      });
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ id: "s1", status: "COMPLETED" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address === "object" && address) baseURL = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("releases through the documented session update, not DELETE", async () => {
    const provider = await create("browserbase", { apiKey: "test", baseURL });
    await provider.releaseSession("s1");

    expect(captured.method).toBe("POST");
    expect(captured.url).toBe("/v1/sessions/s1");
    expect(JSON.parse(captured.body)).toEqual({ status: "REQUEST_RELEASE" });
  });

  it("does not advertise or request screenshots", async () => {
    const provider = await create("browserbase", { apiKey: "test", baseURL });
    captured.method = undefined;
    captured.url = undefined;

    expect(provider.capabilities().screenshot).toBe(false);
    await expect(
      provider.screenshot(
        { url: "https://example.com" },
        { id: "s1", provider: "browserbase", createdAt: 0 },
      ),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);
    expect(captured.method).toBeUndefined();
    expect(captured.url).toBeUndefined();
  });
});
