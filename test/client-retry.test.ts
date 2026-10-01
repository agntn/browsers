import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Client } from "../src/core/client";
import { TimeoutError, TransportError } from "../src/core/errors";

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
    await expect(client.getJSON(url)).rejects.toThrow(TimeoutError);
    expect(count).toBe(2);
  });

  it("respects a zero retry budget", async () => {
    const client = new Client({ timeout: 150, maxRetries: 0 });
    await expect(client.getJSON(url)).rejects.toThrow(TimeoutError);
    expect(count).toBe(1);
  });

  it.each(requests)("names a timeout and its length through request method %#", async (request) => {
    respond = () => {};
    const client = new Client({ timeout: 150, maxRetries: 0 });
    const error = await request(client, `${url}/?token=secret`).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as Error).message).toBe(
      `Timed out after 0.15s with no response from ${url}/?token=%5BREDACTED%5D`,
    );
  });

  it("leaves a timeout of the caller's own signal to the caller", async () => {
    respond = () => {};
    const client = new Client({ timeout: 5000, maxRetries: 0 });
    const error = await client.getJSON(url, undefined, AbortSignal.timeout(100)).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TimeoutError);
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

describe("Client with no response", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function closedPort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing TCP address");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return address.port;
  }

  function failure(request: Promise<unknown>): Promise<unknown> {
    return request.then(
      () => undefined,
      (error: unknown) => error,
    );
  }

  function failFetch(cause: Error): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed", { cause });
      }),
    );
  }

  it.each(requests)("names a refused connection through request method %#", async (request) => {
    const port = await closedPort();
    const client = new Client({ maxRetries: 0 });
    const error = await failure(request(client, `http://127.0.0.1:${port}/?token=secret`));

    expect(error).toBeInstanceOf(TransportError);
    expect((error as TransportError).message).toBe(
      `No response from http://127.0.0.1:${port}/?token=%5BREDACTED%5D: connect ECONNREFUSED 127.0.0.1:${port}`,
    );
    expect((error as TransportError).code).toBe("ECONNREFUSED");
    expect(((error as Error).cause as { code?: string }).code).toBe("ECONNREFUSED");
  });

  it("names an unresolved host", async () => {
    failFetch(
      Object.assign(new Error("getaddrinfo ENOTFOUND nonexistent.invalid"), { code: "ENOTFOUND" }),
    );
    const client = new Client({ maxRetries: 0 });
    const error = await failure(client.getJSON("https://nonexistent.invalid/v1"));

    expect(error).toBeInstanceOf(TransportError);
    expect((error as Error).message).toBe(
      "No response from https://nonexistent.invalid/v1: getaddrinfo ENOTFOUND nonexistent.invalid",
    );
    expect((error as TransportError).code).toBe("ENOTFOUND");
  });

  it("reads a refusal on every address family from its first attempt", async () => {
    const attempts = [
      Object.assign(new Error("connect ECONNREFUSED ::1:59999"), { code: "ECONNREFUSED" }),
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:59999"), { code: "ECONNREFUSED" }),
    ];
    const refused = Object.assign(new AggregateError(attempts, ""), { code: "ECONNREFUSED" });
    failFetch(refused);
    const client = new Client({ maxRetries: 0 });
    const error = await failure(client.getJSON("http://localhost:59999/"));

    expect((error as Error).message).toBe(
      "No response from http://localhost:59999/: connect ECONNREFUSED ::1:59999",
    );
    expect((error as TransportError).code).toBe("ECONNREFUSED");
    expect((error as Error).cause).toBe(refused);
  });

  it("adds a code the reason leaves out", async () => {
    failFetch(
      Object.assign(new Error("self-signed certificate"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" }),
    );
    const client = new Client({ maxRetries: 0 });
    const error = await failure(client.getJSON("https://self-signed.example/"));

    expect((error as Error).message).toBe(
      "No response from https://self-signed.example/: self-signed certificate (DEPTH_ZERO_SELF_SIGNED_CERT)",
    );
  });

  it("hands the caller's own abort back as it is", async () => {
    const server = createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing TCP address");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50);
    const client = new Client({ maxRetries: 0 });
    const error = await failure(
      client.getJSON(`http://127.0.0.1:${address.port}/`, undefined, controller.signal),
    );
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(error).toBe(controller.signal.reason);
  });
});
