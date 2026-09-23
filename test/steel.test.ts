import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { create } from "../src/core/registry";

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

describe("steel scrape responses", () => {
  let server: Server;
  let baseURL: string;

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const body = JSON.parse(await readBody(request)) as { url?: string };
      const challenge = body.url === "https://blocked.example";
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          content: {
            html: challenge
              ? '<html><head><title>Just a moment...</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></head></html>'
              : "<article>How challenges.cloudflare.com works</article>",
          },
          metadata: {
            status_code: 200,
            title: challenge ? "Just a moment..." : "Cloudflare challenge explained",
          },
        }),
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

  it("rejects a Cloudflare interstitial without blocking ordinary pages", async () => {
    const provider = await create("steel", { apiKey: "test", baseURL });

    await expect(provider.scrape("https://blocked.example")).rejects.toThrow(
      "Steel returned a Cloudflare challenge instead of page content",
    );
    await expect(provider.scrape("https://article.example")).resolves.toEqual({
      url: "https://article.example",
      title: "Cloudflare challenge explained",
      html: "<article>How challenges.cloudflare.com works</article>",
      cleanedHtml: undefined,
      markdown: undefined,
      text: undefined,
      statusCode: 200,
      links: undefined,
    });
  });
});

describe("steel screenshots", () => {
  const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
  const session = { id: "session-1", provider: "steel", createdAt: 0 };
  let server: Server;
  let baseURL: string;

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      if (request.method === "GET" && request.url === "/static/shot.png") {
        response.setHeader("Content-Type", "image/png");
        response.end(PNG_BYTES);
        return;
      }
      const body = JSON.parse(await readBody(request)) as { url?: string };
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify(
          body.url === "https://empty.example" ? {} : { url: `${baseURL}/static/shot.png` },
        ),
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

  it("fetches the hosted image instead of returning its URL", async () => {
    const provider = await create("steel", { apiKey: "test", baseURL });

    await expect(provider.screenshot({ url: "https://example.com" }, session)).resolves.toEqual({
      data: `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
      mimeType: "image/png",
    });
  });

  it("reports a response without an image", async () => {
    const provider = await create("steel", { apiKey: "test", baseURL });

    await expect(provider.screenshot({ url: "https://empty.example" }, session)).rejects.toThrow(
      "Steel returned no screenshot",
    );
  });
});
