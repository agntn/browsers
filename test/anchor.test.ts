import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { create } from "../src/core/registry";
import { AuthError } from "../src/core/errors";

interface RecordedRequest {
  method: string;
  url: string;
  apiKey?: string;
  authorization?: string;
  body?: unknown;
}

const API_KEY = "sk-test";
const SESSION_ID = "e73a769b-13e1-4293-b1bd-3b69a4dfcdb9";
const CDP_URL = `wss://connect.anchorbrowser.io?sessionId=${SESSION_ID}&rt=3ab8e650`;
const LIVE_VIEW_URL = "https://anchorforge.io/devtools-frontend/inspector.html?wss=connect";
const CREATED_AT = "2026-09-18T13:17:54.976Z";
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

interface Reply {
  status: number;
  type: string;
  body: string | Buffer;
}

function json(payload: unknown, status = 200): Reply {
  return { status, type: "application/json", body: JSON.stringify(payload) };
}

const UNAUTHORIZED = json({ message: "Unauthorized, please log in." }, 401);
const NOT_FOUND = json({ error: { code: 404, message: "Not found" } }, 404);
const SESSION_STATUS = { session_id: SESSION_ID, status: "running", created_at: CREATED_AT };

const replies: Record<string, Reply> = {
  "POST /v1/sessions": json({
    data: { id: SESSION_ID, cdp_url: CDP_URL, live_view_url: LIVE_VIEW_URL },
  }),
  "GET /v1/sessions/all/status": json({
    data: { count: 1, items: [{ ...SESSION_STATUS, tags: [] }] },
  }),
  [`GET /v1/sessions/${SESSION_ID}`]: json({
    data: { id: "883f5172-b63c-4a11-8320-6d5af2f1d471", ...SESSION_STATUS },
  }),
  [`DELETE /v1/sessions/${SESSION_ID}`]: json({ data: { status: "success" } }),
  "POST /v1/tools/screenshot": { status: 200, type: "image/png", body: JPEG_BYTES },
};

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

async function record(request: IncomingMessage): Promise<RecordedRequest> {
  const raw = await readBody(request);
  return {
    method: request.method ?? "",
    url: request.url ?? "",
    apiKey: request.headers["anchor-api-key"] as string | undefined,
    authorization: request.headers.authorization,
    body: raw ? JSON.parse(raw) : undefined,
  };
}

function replyFor(recorded: RecordedRequest): Reply {
  if (recorded.apiKey !== API_KEY) return UNAUTHORIZED;
  return replies[`${recorded.method} ${recorded.url.split("?")[0]}`] ?? NOT_FOUND;
}

describe("anchor provider", () => {
  let server: Server;
  let baseURL: string;
  const requests: RecordedRequest[] = [];

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const recorded = await record(request);
      requests.push(recorded);
      const reply = replyFor(recorded);
      response.writeHead(reply.status, { "Content-Type": reply.type });
      response.end(reply.body);
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

  beforeEach(() => {
    requests.length = 0;
  });

  it("sends the key in the anchor-api-key header", async () => {
    const provider = await create("anchor", { apiKey: API_KEY, baseURL });

    await expect(provider.createSession()).resolves.toMatchObject({ id: SESSION_ID });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.apiKey).toBe(API_KEY);
    expect(requests[0]?.authorization).toBeUndefined();
  });

  it("reports a rejected key as an auth error", async () => {
    const provider = await create("anchor", { apiKey: "sk-wrong", baseURL });

    await expect(provider.createSession()).rejects.toBeInstanceOf(AuthError);
  });

  it("nests session options under session and browser", async () => {
    const provider = await create("anchor", { apiKey: API_KEY, baseURL });

    await provider.createSession({
      headless: true,
      viewport: { width: 800, height: 600 },
      timeout: 90_000,
      proxy: { server: "http://proxy.example:8080", username: "u", password: "p" },
      captchaSolving: true,
      extra: { browser: { adblock: { active: false } } },
    });

    expect(requests[0]?.body).toEqual({
      session: {
        proxy: {
          type: "custom",
          active: true,
          server: "http://proxy.example:8080",
          username: "u",
          password: "p",
        },
        timeout: { max_duration: 2 },
      },
      browser: {
        headless: { active: true },
        viewport: { width: 800, height: 600 },
        captcha_solver: { active: true },
        adblock: { active: false },
      },
    });
  });

  it("unwraps the data envelope on every session route", async () => {
    const provider = await create("anchor", { apiKey: API_KEY, baseURL });

    const created = await provider.createSession();
    expect(created).toMatchObject({
      id: SESSION_ID,
      cdpUrl: CDP_URL,
      provider: "anchor",
      metadata: { liveViewUrl: LIVE_VIEW_URL },
    });

    const fetched = await provider.getSession(SESSION_ID);
    expect(fetched).toMatchObject({
      id: SESSION_ID,
      provider: "anchor",
      createdAt: Date.parse(CREATED_AT),
      metadata: { status: "running" },
    });

    await expect(provider.getSession("missing")).resolves.toBeNull();

    await expect(provider.listSessions()).resolves.toEqual([
      {
        id: SESSION_ID,
        cdpUrl: undefined,
        provider: "anchor",
        createdAt: Date.parse(CREATED_AT),
        metadata: { status: "running" },
      },
    ]);
    expect(requests.at(-1)?.url).toBe("/v1/sessions/all/status");

    await provider.releaseSession(SESSION_ID);
    expect(requests.at(-1)).toMatchObject({ method: "DELETE", url: `/v1/sessions/${SESSION_ID}` });
  });

  it("screenshots through the tools route with or without a session", async () => {
    const provider = await create("anchor", { apiKey: API_KEY, baseURL });
    expect(provider.capabilities().statelessScreenshot).toBe(false);

    const stateless = await provider.screenshot({ url: "https://example.com", quality: 80 });
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "/v1/tools/screenshot",
      body: { url: "https://example.com", capture_full_height: true, image_quality: 80 },
    });
    expect(stateless.mimeType).toBe("image/jpeg");
    expect(stateless.data).toBe(`data:image/jpeg;base64,${JPEG_BYTES.toString("base64")}`);

    const session = await provider.createSession();
    await provider.screenshot({ fullPage: false }, session);
    expect(requests.at(-1)).toMatchObject({
      method: "POST",
      url: `/v1/tools/screenshot?sessionId=${SESSION_ID}`,
      body: { capture_full_height: false },
    });

    await expect(provider.screenshot({})).rejects.toThrow(
      "anchor screenshot requires either a URL or a session",
    );
  });

  it("probes availability on the sessions status route", async () => {
    const provider = await create("anchor", { apiKey: API_KEY, baseURL });

    expect(await provider.isAvailable?.()).toBe(true);
    expect(requests[0]).toMatchObject({ method: "GET", url: "/v1/sessions/all/status" });

    const rejected = await create("anchor", { apiKey: "sk-wrong", baseURL });
    expect(await rejected.isAvailable?.()).toBe(false);
  });
});
