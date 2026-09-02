import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
