import { createServer } from "node:http";
import type { Server } from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vite-plus/test";
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

describe("browserbase scrape", () => {
  let server: Server;
  let baseURL: string;
  const formats: (string | undefined)[] = [];
  let failing: string | undefined;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const { format } = JSON.parse(body) as { format?: string };
        formats.push(format);
        res.setHeader("Content-Type", "application/json");
        if (format === failing) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Bad Request" }));
          return;
        }
        res.end(
          JSON.stringify(
            format === "markdown"
              ? { statusCode: 200, contentType: "text/markdown", content: "# Example" }
              : {
                  statusCode: 200,
                  contentType: "text/html; charset=utf-8",
                  content: "<h1>Example</h1>",
                },
          ),
        );
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

  it("asks for raw HTML when HTML is requested", async () => {
    const provider = await create("browserbase", { apiKey: "test", baseURL });
    formats.length = 0;
    const page = await provider.scrape("https://example.com", { formats: ["html"] });

    expect(formats).toEqual(["raw"]);
    expect(page.html).toBe("<h1>Example</h1>");
    expect(page.markdown).toBeUndefined();
  });

  it("keeps markdown out of the html field", async () => {
    const provider = await create("browserbase", { apiKey: "test", baseURL });
    formats.length = 0;
    const page = await provider.scrape("https://example.com", { formats: ["markdown"] });

    expect(formats).toEqual(["markdown"]);
    expect(page.markdown).toBe("# Example");
    expect(page.html).toBeUndefined();
  });

  it("fetches both when both are requested", async () => {
    const provider = await create("browserbase", { apiKey: "test", baseURL });
    formats.length = 0;
    const page = await provider.scrape("https://example.com", { formats: ["html", "markdown"] });

    expect(formats).toHaveLength(2);
    expect(formats).toEqual(expect.arrayContaining(["markdown", "raw"]));
    expect(page.html).toBe("<h1>Example</h1>");
    expect(page.markdown).toBe("# Example");
    expect(page.statusCode).toBe(200);
  });

  it("keeps the markdown when the HTML fetch fails", async () => {
    const provider = await create("browserbase", { apiKey: "test", baseURL });
    failing = "raw";
    try {
      const page = await provider.scrape("https://example.com", { formats: ["html", "markdown"] });
      expect(page.html).toBeUndefined();
      expect(page.markdown).toBe("# Example");
    } finally {
      failing = undefined;
    }
  });

  it("fails when the only requested fetch fails", async () => {
    const provider = await create("browserbase", { apiKey: "test", baseURL });
    failing = "raw";
    try {
      await expect(provider.scrape("https://example.com", { formats: ["html"] })).rejects.toThrow();
    } finally {
      failing = undefined;
    }
  });
});
