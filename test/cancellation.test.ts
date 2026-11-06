import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { invokeTool, type ToolDefinition } from "@agntn/tools";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { resetDefaultClientForTests } from "../src/core/client";
import { create } from "../src/core/registry";
import type { BrowserProvider, BrowserSession, ProviderCapabilities } from "../src/core/types";
import { JOB_POLL_INTERVAL, scrapeWithSessionWhenNeeded } from "../src/core/utils";
import {
  accessibilityTool,
  crawlTool,
  extractTool,
  linksTool,
  scrapeTool,
  searchTool,
} from "../src/tools";

interface Call {
  readonly method: string;
  readonly url: string;
  readonly signal?: AbortSignal;
}

/**
 * Replaces `fetch` with one that answers through `answer`, or never answers when it returns
 * undefined, and fails only once the request's signal aborts.
 *
 * @param {(call: Call) => unknown} answer JSON body for a call, or undefined to hang.
 * @returns {Call[]} Every call, in order.
 */
function stubFetch(answer: (call: Call) => unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = { method: init?.method ?? "GET", url, signal: init?.signal ?? undefined };
      calls.push(call);
      const body = answer(call);
      if (body !== undefined) {
        return new Response(JSON.stringify(body), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Promise<Response>((_resolve, reject) => {
        call.signal?.addEventListener("abort", () => reject(call.signal?.reason), { once: true });
      });
    }),
  );
  resetDefaultClientForTests();
  return calls;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetDefaultClientForTests();
});

const page = { url: "https://example.test/", provider: "cloudflare" };

const readTools: ReadonlyArray<{ tool: ToolDefinition; args: Record<string, unknown> }> = [
  { tool: scrapeTool, args: page },
  { tool: extractTool, args: { ...page, prompt: "Title" } },
  { tool: crawlTool, args: page },
  { tool: linksTool, args: page },
  { tool: accessibilityTool, args: page },
  { tool: searchTool, args: { query: "browsers" } },
];

describe("cancelling a read tool", () => {
  it.each(readTools)(
    "$tool.name aborts the provider request it started",
    async ({ tool, args }) => {
      vi.stubEnv("CLOUDFLARE_API_TOKEN", "token");
      vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
      vi.stubEnv("HYPERBROWSER_API_KEY", "key");
      const calls = stubFetch(() => undefined);
      const controller = new AbortController();

      const call = invokeTool(tool, args, { signal: controller.signal });
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      controller.abort();

      await expect(call).rejects.toThrow();
      expect(calls[0]?.signal?.aborted).toBe(true);
    },
  );
});

const kernelSession: BrowserSession = { id: "browser-1", provider: "kernel", createdAt: 0 };

describe("cancelling a provider scrape", () => {
  it.each(["browserbase", "browserless", "hyperbrowser", "kernel", "steel"])(
    "%s aborts its request",
    async (name) => {
      const calls = stubFetch(() => undefined);
      const provider = await create(name, { apiKey: "key" });
      const controller = new AbortController();

      const scrape = provider.scrape(
        "https://example.test/",
        { signal: controller.signal },
        name === "kernel" ? kernelSession : undefined,
      );
      const outcome = expect(scrape).rejects.toThrow("This operation was aborted");
      await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
      controller.abort();
      await outcome;

      expect(calls.every((call) => call.signal?.aborted)).toBe(true);
    },
  );
});

const CF_CRAWL =
  "https://api.cloudflare.com/client/v4/accounts/test-account/browser-rendering/crawl";

/**
 * A Cloudflare crawl that never finishes, so only cancellation ends the wait.
 *
 * @returns {Call[]} Every call the provider makes.
 */
function endlessCloudflareCrawl(): Call[] {
  return stubFetch(({ method }) =>
    method === "POST"
      ? { success: true, result: "job-1" }
      : { success: true, result: { status: "running" } },
  );
}

describe("cancelling a provider job", () => {
  it("cancels the Cloudflare crawl job it started, between two reads", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const calls = endlessCloudflareCrawl();
    const provider = await create("cloudflare", { apiKey: "token", accountID: "test-account" });
    const controller = new AbortController();

    const crawl = provider.crawl?.("https://example.test/", { signal: controller.signal });
    const outcome = expect(crawl).rejects.toThrow("This operation was aborted");
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    controller.abort();
    await outcome;

    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `POST ${CF_CRAWL}`,
      `GET ${CF_CRAWL}/job-1?limit=1`,
      `DELETE ${CF_CRAWL}/job-1`,
    ]);
  });

  it("leaves a resumed Cloudflare job running, since its ID is the caller's", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const calls = endlessCloudflareCrawl();
    const provider = await create("cloudflare", { apiKey: "token", accountID: "test-account" });
    const controller = new AbortController();

    const resume = provider.resumeCrawl?.("job-1", { signal: controller.signal });
    const outcome = expect(resume).rejects.toThrow("This operation was aborted");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.abort();
    await outcome;

    expect(calls.map(({ method }) => method)).toEqual(["GET"]);
  });

  it("stops polling a Hyperbrowser extract job without waiting out the pause", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const calls = stubFetch(({ method }) =>
      method === "POST" ? { jobId: "job-1" } : { status: "running" },
    );
    const provider = await create("hyperbrowser", { apiKey: "key" });
    const controller = new AbortController();

    const extract = provider.extract?.("https://example.test/", {
      prompt: "Title",
      signal: controller.signal,
    });
    const outcome = expect(extract).rejects.toThrow("This operation was aborted");
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    controller.abort();
    await outcome;

    await vi.advanceTimersByTimeAsync(JOB_POLL_INTERVAL);
    expect(calls).toHaveLength(2);
  });
});

/**
 * A provider that scrapes only inside a session and records what it was asked to do.
 *
 * @param {() => void} onCreate Runs while the session is being created.
 * @returns {{ provider: BrowserProvider; log: string[] }} The provider and its call log.
 */
function sessionOnlyProvider(onCreate: () => void): { provider: BrowserProvider; log: string[] } {
  const log: string[] = [];
  const session: BrowserSession = { id: "session-1", provider: "fake", createdAt: 0 };
  const provider = {
    name: () => "fake",
    capabilities: () => ({ scrape: true, statelessScrape: false }) as ProviderCapabilities,
    createSession: async () => {
      onCreate();
      log.push("create");
      return session;
    },
    scrape: async () => {
      log.push("scrape");
      return { url: "https://example.test/" };
    },
    releaseSession: async (id: string) => {
      log.push(`release ${id}`);
    },
  } as unknown as BrowserProvider;
  return { provider, log };
}

describe("cancelling a scrape that needs a temporary session", () => {
  it("releases the session that arrived after the abort, without scraping", async () => {
    const controller = new AbortController();
    const { provider, log } = sessionOnlyProvider(() => controller.abort());

    await expect(
      scrapeWithSessionWhenNeeded(provider, "https://example.test/", {
        signal: controller.signal,
      }),
    ).rejects.toThrow("This operation was aborted");

    expect(log).toEqual(["create", "release session-1"]);
  });
});

/** A cold Chrome launch on a CI runner takes longer than the 5 s vitest default. */
describe("cancelling a local Playwright scrape", { timeout: 30_000 }, () => {
  it("closes the browser it launched, which drops the page's request", async () => {
    let dropped!: () => void;
    const droppedRequest = new Promise<void>((resolve) => {
      dropped = resolve;
    });
    let arrived!: () => void;
    const arrivedRequest = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const server = createServer((request) => {
      arrived();
      request.socket.on("close", () => dropped());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const provider = await create("playwright");
      const controller = new AbortController();

      const scrape = provider.scrape(`http://127.0.0.1:${port}/`, {
        signal: controller.signal,
      });
      const outcome = expect(scrape).rejects.toThrow("This operation was aborted");
      await arrivedRequest;
      controller.abort();
      await outcome;
      await droppedRequest;
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
