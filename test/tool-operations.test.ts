import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BrowserProvider } from "../src/core/types";
import { register } from "../src/core/registry";
import {
  browserCapabilities,
  browserScrape,
  browserSession,
  browserScreenshot,
  listBrowserProviders,
  releaseBrowserSession,
} from "../src/tool-operations";

const previousApiKey = process.env.TOOLTEST_API_KEY;
const releaseSession = vi.fn<(sessionId: string) => Promise<void>>();
const scrape = vi.fn<BrowserProvider["scrape"]>();
const screenshot = vi.fn<BrowserProvider["screenshot"]>();

function toolTestProvider(): BrowserProvider {
  return {
    name: () => "tooltest",
    capabilities: () => ({
      scrape: true,
      screenshot: true,
      navigate: false,
      evaluate: false,
      sessions: true,
      cdp: true,
      statelessScrape: true,
      statelessScreenshot: true,
      crawl: false,
      pdf: false,
      links: false,
      search: false,
      extract: false,
    }),
    createSession: vi.fn().mockResolvedValue({
      id: "session-1",
      provider: "tooltest",
      createdAt: 1_000,
      cdpUrl: "wss://example.test?token=secret",
      metadata: { token: "secret" },
    }),
    getSession: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn().mockResolvedValue([]),
    releaseSession,
    scrape,
    screenshot,
    navigate: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({ value: undefined }),
  };
}

beforeAll(() => {
  register("tooltest", "https://example.test", () => toolTestProvider());
});

afterEach(() => {
  vi.clearAllMocks();
  if (previousApiKey === undefined) delete process.env.TOOLTEST_API_KEY;
  else process.env.TOOLTEST_API_KEY = previousApiKey;
});

describe("browser tool operations", () => {
  it("bounds normalized scrape content once", async () => {
    process.env.TOOLTEST_API_KEY = "test";
    scrape.mockResolvedValue({ url: "https://example.test", text: "abcdefgh" });

    const result = await browserScrape({
      provider: "tooltest",
      url: "https://example.test",
      maxChars: 5,
    });

    expect(result.content).toEqual([
      {
        type: "text",
        text: "[provider=tooltest] https://example.test\n\nabcde\n\n[truncated 3 of 8 characters]",
      },
    ]);
    expect(result.details).toEqual({
      url: "https://example.test",
      provider: "tooltest",
      contentLength: 8,
    });
    expect(JSON.stringify(result).split("abcde")).toHaveLength(2);
  });

  it("rejects an invalid scrape limit before provider I/O", async () => {
    process.env.TOOLTEST_API_KEY = "test";

    await expect(
      browserScrape({
        provider: "tooltest",
        url: "https://example.test",
        maxChars: 200_001,
      }),
    ).rejects.toThrow("maxChars must be an integer between 1 and 200000");
    expect(scrape).not.toHaveBeenCalled();
  });

  it("keeps session credentials out of the shared result", async () => {
    process.env.TOOLTEST_API_KEY = "test";

    const result = await browserSession({ provider: "tooltest", region: "eu-west-1" });

    expect(result.content).toEqual([
      { type: "text", text: "[provider=tooltest] Session created: session-1" },
    ]);
    expect(result.details).toEqual({
      session: { id: "session-1", provider: "tooltest", createdAt: 1_000 },
    });
    expect(JSON.stringify(result)).not.toContain("token=secret");
  });

  it("releases sessions through the same executor used by every surface", async () => {
    process.env.TOOLTEST_API_KEY = "test";

    const result = await releaseBrowserSession({
      provider: "tooltest",
      sessionId: "session-1",
    });

    expect(releaseSession).toHaveBeenCalledWith("session-1");
    expect(result.details).toEqual({ released: true });
  });

  it("returns stateless screenshots without exposing the image twice", async () => {
    process.env.TOOLTEST_API_KEY = "test";
    screenshot.mockResolvedValue({ data: "base64-image", mimeType: "image/png" });

    const result = await browserScreenshot({
      provider: "tooltest",
      url: "https://example.test",
      fullPage: true,
    });

    expect(result.content[0]?.text).toContain("Data length: 12 chars");
    expect(result.details).toEqual({
      url: "https://example.test",
      provider: "tooltest",
      saved: false,
    });
    expect(JSON.stringify(result)).not.toContain("base64-image");
  });

  it("lists registered providers and reports capabilities consistently", async () => {
    process.env.TOOLTEST_API_KEY = "test";

    const listing = listBrowserProviders();
    const capabilities = browserCapabilities({ provider: "tooltest" });

    expect(listing.details.providers).toContainEqual(
      expect.objectContaining({ name: "tooltest", configured: true }),
    );
    expect(capabilities.details).toMatchObject({
      provider: "tooltest",
      capabilities: { scrape: true, statelessScrape: true },
    });
  });
});
