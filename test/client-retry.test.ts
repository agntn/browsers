import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "../src/core/client";

const requests = [
  (client: Client, url: string) => client.getJSON(url),
  (client: Client, url: string) => client.getRaw(url),
  (client: Client, url: string) => client.postJSON(url, {}),
  (client: Client, url: string) => client.putJSON(url),
  (client: Client, url: string) => client.deleteJSON(url),
  (client: Client, url: string) => client.postText(url, {}),
  (client: Client, url: string) => client.postRaw(url, {}),
  (client: Client, url: string) => client.postResponse(url, {}),
];

describe("Client retry timeout", () => {
  let server: Server;
  let url: string;
  let count: number;
  let respond: (request: IncomingMessage, response: ServerResponse) => void;
  const timers: ReturnType<typeof setTimeout>[] = [];

  beforeEach(async () => {
    count = 0;
    respond = (_request, response) => {
      if (count > 1) response.end('{"ok":true}');
    };
    server = createServer((request, response) => {
      count += 1;
      response.setHeader("Content-Type", "application/json");
      respond(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing TCP address");
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const timer of timers.splice(0)) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it.each(requests)("retries a timeout through request method %#", async (request) => {
    const client = new Client({ timeout: 150, maxRetries: 1, baseDelay: 1 });
    await request(client, url);
    expect(count).toBe(2);
  });

  it("gives a retry its full budget after a late connection failure", async () => {
    respond = (request, response) => {
      const attempt = count;
      timers.push(
        setTimeout(() => {
          if (attempt === 1) request.socket.destroy();
          else response.end('{"ok":true}');
        }, 200),
      );
    };
    const client = new Client({ timeout: 350, maxRetries: 1, baseDelay: 1 });
    await expect(client.getJSON(url)).resolves.toEqual({ ok: true });
    expect(count).toBe(2);
  });

  it("keeps the timeout when the caller supplies a signal", async () => {
    const controller = new AbortController();
    const client = new Client({ timeout: 150, maxRetries: 1, baseDelay: 1 });
    await expect(client.getJSON(url, undefined, controller.signal)).resolves.toEqual({ ok: true });
    expect(count).toBe(2);
    expect(controller.signal.aborted).toBe(false);
  });

  it("does not retry caller cancellation with a custom reason", async () => {
    const controller = new AbortController();
    respond = () => controller.abort(new Error("Cancelled by caller"));
    const client = new Client({ timeout: 150, maxRetries: 2, baseDelay: 1 });
    await expect(client.getJSON(url, undefined, controller.signal)).rejects.toThrow();
    expect(count).toBe(1);
  });

  it("does not send a request after cancellation during backoff", async () => {
    const controller = new AbortController();
    respond = (_request, response) => {
      response.statusCode = 503;
      response.end("Unavailable");
      timers.push(setTimeout(() => controller.abort(), 25));
    };
    const client = new Client({ timeout: 150, maxRetries: 1, baseDelay: 100 });
    await expect(client.getJSON(url, undefined, controller.signal)).rejects.toThrow();
    expect(count).toBe(1);
  });

  it("allows disabling the timeout", async () => {
    respond = (_request, response) => response.end('{"ok":true}');
    const client = new Client({ timeout: 0 });
    await expect(client.getJSON(url)).resolves.toEqual({ ok: true });
    expect(count).toBe(1);
  });

  it("accepts fractional timeout values", async () => {
    respond = (_request, response) => response.end('{"ok":true}');
    const client = new Client({ timeout: 150.5 });
    await expect(client.getJSON(url)).resolves.toEqual({ ok: true });
    expect(count).toBe(1);
  });

  it("stops after exhausting the retry budget", async () => {
    respond = () => {};
    const client = new Client({ timeout: 150, maxRetries: 1, baseDelay: 1 });
    await expect(client.getJSON(url)).rejects.toThrow("HTTP 0");
    expect(count).toBe(2);
  });

  it("respects a zero retry budget", async () => {
    const client = new Client({ timeout: 150, maxRetries: 0 });
    await expect(client.getJSON(url)).rejects.toThrow("HTTP 0");
    expect(count).toBe(1);
  });

  it("does not retry a non-retryable status", async () => {
    respond = (_request, response) => {
      response.statusCode = 400;
      response.end("Bad request");
    };
    const client = new Client({ timeout: 150, maxRetries: 1, baseDelay: 1 });
    await expect(client.getJSON(url)).rejects.toThrow(/^HTTP 400 from .*: Bad request$/);
    expect(count).toBe(1);
  });
});
