import { runCommand } from "citty";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { BrowserProvider } from "../../src/core/types";
import { register } from "../../src/core/registry";
import crawl from "../../src/commands/crawl";

const previousApiKey = process.env.CRAWLTEST_API_KEY;
const providerCrawl = vi.fn<NonNullable<BrowserProvider["crawl"]>>();

function crawlTestProvider(): BrowserProvider {
  return {
    name: () => "crawltest",
    capabilities: () => ({
      scrape: false,
      screenshot: false,
      navigate: false,
      evaluate: false,
      sessions: false,
      cdp: false,
      statelessScrape: false,
      statelessScreenshot: false,
      elementScreenshot: false,
      crawl: true,
      pdf: false,
      links: false,
      search: false,
      extract: false,
    }),
    createSession: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn().mockResolvedValue([]),
    releaseSession: vi.fn().mockResolvedValue(undefined),
    scrape: vi.fn(),
    screenshot: vi.fn(),
    navigate: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({ value: undefined }),
    crawl: providerCrawl,
  };
}

beforeAll(() => {
  register("crawltest", "https://example.test", () => crawlTestProvider());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  if (previousApiKey === undefined) delete process.env.CRAWLTEST_API_KEY;
  else process.env.CRAWLTEST_API_KEY = previousApiKey;
});

describe("crawl command", () => {
  it("prints the job ID of a crawl still running as its result", async () => {
    process.env.CRAWLTEST_API_KEY = "test";
    providerCrawl.mockResolvedValueOnce({
      jobId: "job-1",
      status: "running",
      pages: [],
      totalFound: 0,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCommand(crawl, { rawArgs: ["https://example.test", "--provider", "crawltest"] });

    expect(log.mock.calls).toEqual([["job-1"]]);
  });

  it("prints only the pages of a finished crawl", async () => {
    process.env.CRAWLTEST_API_KEY = "test";
    providerCrawl.mockResolvedValueOnce({
      jobId: "job-2",
      status: "completed",
      totalFound: 1,
      pages: [{ url: "https://example.test", markdown: "# Example" }],
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCommand(crawl, { rawArgs: ["https://example.test", "--provider", "crawltest"] });

    expect(log.mock.calls).toEqual([["\n--- https://example.test ---"], ["# Example"]]);
  });
});
