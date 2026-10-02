import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { NavigationError } from "../src/core/errors";
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
            statusCode: 200,
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
      statusCode: undefined,
      links: undefined,
    });
  });
});

describe("steel navigation errors", () => {
  let server: Server;
  let baseURL: string;

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const body = JSON.parse(await readBody(request)) as { url?: string; format?: string[] };
      const failed =
        body.url === "https://h2.example/" || body.url?.startsWith("https://httpbin.org/status/");
      const code = body.url === "https://h2.example/" ? "" : body.url?.split("/").at(-1);
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          content: body.format?.includes("cleaned_html")
            ? { cleaned_html: `<div class="error-code">HTTP ERROR ${code}</div>` }
            : body.format?.includes("markdown")
              ? {
                  markdown: `## This page isn’t working\n\n**httpbin.org** is currently unable to handle this request.\n\nHTTP ERROR ${code}\n\n![](data:image/png;base64,iVBORw0KGgo)`,
                }
              : {
                  html: failed
                    ? `<html><head><title>httpbin.org</title><script>var loadTimeDataRaw = {"errorCode":"${code ? `HTTP ERROR ${code}` : "ERR_HTTP2_PROTOCOL_ERROR"}"};</script></head><body class="neterror"><div id="main-frame-error"></div></body></html>`
                    : "<article>Chrome prints HTTP ERROR 500 on its error page</article>",
                },
          metadata: {
            statusCode: 200,
            title: "httpbin.org",
            urlSource: failed ? "chrome-error://chromewebdata/" : body.url,
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

  it("fails when Chrome shows its error page in place of the site", async () => {
    const provider = await create("steel", { apiKey: "test", baseURL });

    const error = await provider
      .scrape("https://httpbin.org/status/500")
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(NavigationError);
    expect(error).toMatchObject({
      provider: "steel",
      reason: "HTTP ERROR 500",
      statusCode: 500,
      message: "Steel couldn't load the page, Chrome showed HTTP ERROR 500",
    });
    await expect(
      provider.scrape("https://httpbin.org/status/403", { formats: ["markdown"] }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      provider.scrape("https://httpbin.org/status/404", { formats: ["cleanedHtml"] }),
    ).rejects.toMatchObject({ reason: "HTTP ERROR 404", statusCode: 404 });
    await expect(provider.scrape("https://h2.example/")).rejects.toMatchObject({
      reason: "ERR_HTTP2_PROTOCOL_ERROR",
      statusCode: undefined,
    });
    await expect(
      provider.scrape("https://errors.example/chrome", { formats: ["html"] }),
    ).resolves.toMatchObject({
      html: "<article>Chrome prints HTTP ERROR 500 on its error page</article>",
    });
  });
});

describe("steel scrape metadata", () => {
  let server: Server;
  let baseURL: string;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          content: {
            markdown: "[Skip to content](#start-of-content)",
            readability: { 0: "<", 1: "b", 2: "o" },
          },
          metadata: {
            statusCode: 200,
            title: "Page not found · GitHub · GitHub",
            urlSource: "https://github.com/agntn/no-such-repo-139",
          },
          links: [
            {
              url: "https://github.com/agntn/no-such-repo-139#start-of-content",
              text: "Skip to content",
            },
            { url: "https://github.com/", text: "" },
          ],
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

  it("keeps link URLs and leaves out what Steel cannot tell", async () => {
    const provider = await create("steel", { apiKey: "test", baseURL });

    const page = await provider.scrape("https://github.com/agntn/no-such-repo-139", {
      formats: ["markdown"],
    });

    expect(page.links).toEqual([
      "https://github.com/agntn/no-such-repo-139#start-of-content",
      "https://github.com/",
    ]);
    expect(page.statusCode).toBeUndefined();
    expect(page.text).toBeUndefined();
  });
});

describe("steel scrape formats", () => {
  let server: Server;
  let baseURL: string;
  let requests: Record<string, unknown>[] = [];

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const body = JSON.parse(await readBody(request)) as { format?: string[] };
      requests.push(body);
      const page = { html: "<h1>Docs</h1>", markdown: "# Docs", cleaned_html: "<h1>Docs</h1>" };
      const format = body.format ?? ["html"];
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          content: Object.fromEntries(
            Object.entries(page).filter(([name]) => format.includes(name)),
          ),
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

  it("asks Steel for the formats the caller wants", async () => {
    requests = [];
    const provider = await create("steel", { apiKey: "test", baseURL });

    const markdown = await provider.scrape("https://docs.example", { formats: ["markdown"] });
    const both = await provider.scrape("https://docs.example", {
      formats: ["cleanedHtml", "text", "html"],
    });
    const plain = await provider.scrape("https://docs.example");
    const unknown = await provider.scrape("https://docs.example", {
      formats: ["pdf" as "html"],
    });

    expect(markdown.markdown).toBe("# Docs");
    expect(markdown.html).toBeUndefined();
    expect(both.cleanedHtml).toBe("<h1>Docs</h1>");
    expect(plain.html).toBe("<h1>Docs</h1>");
    expect(unknown.html).toBe("<h1>Docs</h1>");
    expect(requests.map((body) => body.format)).toEqual([
      ["markdown"],
      ["cleaned_html", "html"],
      undefined,
      undefined,
    ]);
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

describe("steel availability", () => {
  let server: Server;
  let baseURL: string;
  const urls: (string | undefined)[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      urls.push(request.url);
      response.setHeader("Content-Type", "application/json");
      if (request.headers["steel-api-key"] !== "test") {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      if (request.method === "GET" && request.url === "/v1/sessions?limit=1") {
        response.end(JSON.stringify({ sessions: [], nextCursor: null, totalCount: 0 }));
        return;
      }
      response.statusCode = 421;
      response.end(JSON.stringify({ message: `No route defined for GET ${request.url}` }));
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

  it("probes a route Steel serves and checks the key", async () => {
    const provider = await create("steel", { apiKey: "test", baseURL });
    const rejected = await create("steel", { apiKey: "wrong", baseURL });

    await expect(provider.checkAvailability?.()).resolves.toBeUndefined();
    await expect(rejected.checkAvailability?.()).rejects.toThrow(
      "Authentication failed for steel: Unauthorized",
    );
    expect(urls).toEqual(["/v1/sessions?limit=1", "/v1/sessions?limit=1"]);
  });
});
