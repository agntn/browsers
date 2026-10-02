import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { Client } from "../src/core/client";

describe("Client request Accept headers", () => {
  let server: Server;
  let baseURL: string;
  const accepts: Array<string | undefined> = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      accepts.push(request.headers.accept);
      if (request.method === "DELETE") {
        response.statusCode = 204;
        response.end();
        return;
      }
      response.setHeader("Content-Type", "text/html");
      response.end("<html>ok</html>");
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

  it("does not advertise JSON for text responses", async () => {
    const client = new Client({ maxRetries: 0 });

    await expect(
      client.postText(`${baseURL}/content`, { url: "https://example.com" }),
    ).resolves.toBe("<html>ok</html>");

    expect(accepts.at(-1)).toBe("*/*");
  });

  it("does not advertise JSON when a DELETE has no response body", async () => {
    const client = new Client({ maxRetries: 0 });

    await expect(client.deleteJSON(`${baseURL}/stop`)).resolves.toBeUndefined();

    expect(accepts.at(-1)).toBe("*/*");
  });

  it("does not advertise JSON for binary responses", async () => {
    const client = new Client({ maxRetries: 0 });

    const data = await client.postRaw(`${baseURL}/screenshot`, { url: "https://example.com" });

    expect(new TextDecoder().decode(data)).toBe("<html>ok</html>");
    expect(accepts.at(-1)).toBe("*/*");
  });

  it("does not advertise JSON when the caller inspects the content type", async () => {
    const client = new Client({ maxRetries: 0 });

    const response = await client.postResponse(`${baseURL}/pdf`, { url: "https://example.com" });

    expect(response.headers.get("content-type")).toBe("text/html");
    expect(accepts.at(-1)).toBe("*/*");
  });

  it("keeps an explicit Accept on binary posts", async () => {
    const client = new Client({ maxRetries: 0 });

    await client.postRaw(`${baseURL}/screenshot`, {}, { Accept: "image/png" });

    expect(accepts.at(-1)).toBe("image/png");
  });
});

describe("Client.postResponse", () => {
  it("returns binary response data as an ArrayBuffer", async () => {
    const client = new Client({ maxRetries: 0 });
    const response = await client.postResponse("data:image/png;base64,iVBORw0KGgo=", {});

    const data = await response.arrayBuffer();

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(data)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  });

  it("parses JSON response data after reading as an ArrayBuffer", async () => {
    const client = new Client({ maxRetries: 0 });
    const response = await client.postResponse(
      "data:application/json,%7B%22success%22%3Atrue%7D",
      {},
    );

    await expect(response.json()).resolves.toEqual({ success: true });
  });
});

describe("Client JSON requests", () => {
  let server: Server;
  let baseURL: string;
  const seen: Array<{ method?: string; headers: Record<string, unknown>; body: string }> = [];

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      seen.push({
        method: request.method,
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
      });
      response.setHeader("Content-Type", "application/json");
      response.end(
        request.url === "/proto" ? '{"__proto__":{"polluted":true},"ok":true}' : '{"ok":true}',
      );
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

  it("sends a JSON body and lets the caller's headers win", async () => {
    const client = new Client({ maxRetries: 0, userAgent: "browsers/test" });

    await expect(
      client.postJSON(
        `${baseURL}/sessions`,
        { url: "https://example.com" },
        { "User-Agent": "mine" },
      ),
    ).resolves.toEqual({ ok: true });
    await client.putJSON(`${baseURL}/sessions/1`);
    await client.deleteJSON(`${baseURL}/sessions/1`);

    expect(seen.at(-3)).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "mine",
      },
      body: '{"url":"https://example.com"}',
    });
    expect(seen.at(-2)).toMatchObject({
      method: "PUT",
      headers: { "user-agent": "browsers/test" },
    });
    expect(seen.at(-1)).toMatchObject({ method: "DELETE", body: "" });
  });

  it("drops keys that would reach a prototype", async () => {
    const client = new Client({ maxRetries: 0 });

    const data = await client.getJSON<Record<string, unknown>>(`${baseURL}/proto`);

    expect(data).toEqual({ ok: true });
    expect(Object.hasOwn(data, "__proto__")).toBe(false);
  });
});
