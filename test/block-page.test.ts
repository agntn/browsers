import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { blockPage, rejectBlockPage } from "../src/core/block-page";
import { BlockedPageError, BrowserError } from "../src/core/errors";
import { create } from "../src/core/registry";
import recorded from "./fixtures/block-pages.json" with { type: "json" };

const article = `<html><head><title>How Reddit blocks scrapers</title></head><body><article>
<p>Reddit answers a flagged scraper with "whoa there, pardner!" and says the request was
blocked due to a network policy. Newer pages say you've been blocked by network security, maybe
blocked by mistake, or ask you to prove your humanity. Reddit, Inc. runs both.</p>
${"<p>A long explanation of rate limits, user agents and residential proxies.</p>\n".repeat(40)}
</article></body></html>`;

describe("block pages", () => {
  it.each([
    ["steel old.reddit.com", "a Reddit block page"],
    ["hyperbrowser www.reddit.com", "a Reddit block page"],
    ["browserless www.reddit.com", "a Reddit block page"],
    ["playwright old.reddit.com", "a Reddit block page"],
    ["kernel www.reddit.com", "a Reddit captcha"],
  ] as const)("recognizes the recorded %s answer", (name, page) => {
    expect(blockPage({ url: "https://www.reddit.com/", ...recorded[name] })).toBe(page);
  });

  it("reads a captcha from innerText alone", () => {
    const text =
      'Prove your humanity\n\nWe’re committed to safety and security. But not for bots.\n\nReddit, Inc. © "2026". All rights reserved.';
    expect(blockPage({ url: "https://www.reddit.com/", text })).toBe("a Reddit captcha");
  });

  it("keeps a page that quotes block pages as content", () => {
    expect(blockPage({ url: "https://blog.example/", html: article })).toBeUndefined();
    expect(
      blockPage({ url: "https://blog.example/", text: "Prove your humanity" }),
    ).toBeUndefined();
    expect(
      blockPage({
        url: "https://blog.example/",
        title: "Cloudflare challenge explained",
        html: "<article>How challenges.cloudflare.com works</article>",
      }),
    ).toBeUndefined();
  });

  it("finds the Cloudflare challenge title inside the HTML", () => {
    const html =
      '<html><head><title>Just a moment...</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></head></html>';
    expect(blockPage({ url: "https://blocked.example/", html })).toBe("a Cloudflare challenge");
  });

  it("scans unclosed tags in linear time", () => {
    const html = `${"<script".repeat(200_000)}${"<title".repeat(200_000)}`;
    const started = performance.now();
    expect(blockPage({ url: "https://hostile.example/", html })).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("throws a BlockedPageError that names the provider and the page", () => {
    const error = (() => {
      try {
        rejectBlockPage(
          { url: "https://www.reddit.com/", ...recorded["kernel www.reddit.com"] },
          "kernel",
        );
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(BlockedPageError);
    expect(error).toBeInstanceOf(BrowserError);
    expect(error).toMatchObject({
      message: "Kernel returned a Reddit captcha instead of page content",
      provider: "kernel",
      page: "a Reddit captcha",
    });
  });
});

describe("browserless scrape of a block page", () => {
  let server: Server;
  let baseURL: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString()));
      request.on("end", () => {
        const { url } = JSON.parse(body) as { url: string };
        response.setHeader("Content-Type", "text/html");
        response.end(
          url.includes("reddit") ? recorded["browserless www.reddit.com"].html : article,
        );
      });
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

  it("fails instead of returning the block page as content", async () => {
    const provider = await create("browserless", { apiKey: "test", baseURL });

    await expect(provider.scrape("https://www.reddit.com/r/ethfinance/")).rejects.toThrow(
      new BlockedPageError("browserless", "a Reddit block page"),
    );
    await expect(provider.scrape("https://blog.example/")).resolves.toEqual({
      url: "https://blog.example/",
      html: article,
    });
  });
});
