import { runCommand } from "citty";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BrowserProvider } from "../../src/core/types";
import { register } from "../../src/core/registry";
import scrape from "../../src/commands/scrape";

const previousApiKey = process.env.CLITEST_API_KEY;
let statelessScrape = false;
const createSession = vi.fn<BrowserProvider["createSession"]>().mockResolvedValue({
  id: "session-1",
  provider: "clitest",
  createdAt: 1_000,
});
const releaseSession = vi.fn<BrowserProvider["releaseSession"]>().mockResolvedValue(undefined);
const providerScrape = vi.fn<BrowserProvider["scrape"]>();

function cliTestProvider(): BrowserProvider {
  return {
    name: () => "clitest",
    capabilities: () => ({
      scrape: true,
      screenshot: false,
      navigate: false,
      evaluate: false,
      sessions: true,
      cdp: false,
      statelessScrape,
      statelessScreenshot: false,
      elementScreenshot: false,
      crawl: false,
      pdf: false,
      links: false,
      search: false,
      extract: false,
    }),
    createSession,
    getSession: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn().mockResolvedValue([]),
    releaseSession,
    scrape: providerScrape,
    screenshot: vi.fn(),
    navigate: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({ value: undefined }),
  };
}

beforeAll(() => {
  register("clitest", "https://example.test", () => cliTestProvider());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  statelessScrape = false;
  if (previousApiKey === undefined) delete process.env.CLITEST_API_KEY;
  else process.env.CLITEST_API_KEY = previousApiKey;
});

describe("scrape command", () => {
  it("gives scrapers that need a session a temporary session", async () => {
    process.env.CLITEST_API_KEY = "test";
    providerScrape.mockResolvedValueOnce({ url: "https://example.test", text: "page text" });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCommand(scrape, {
      rawArgs: ["https://example.test", "--provider", "clitest", "--format", "text"],
    });

    expect(createSession).toHaveBeenCalledOnce();
    expect(providerScrape).toHaveBeenCalledWith(
      "https://example.test",
      { waitFor: undefined, maxChars: undefined },
      expect.objectContaining({ id: "session-1" }),
    );
    expect(releaseSession).toHaveBeenCalledWith("session-1");
    expect(log).toHaveBeenCalledWith("page text");
  });

  it("scrapes without a session when the provider is stateless", async () => {
    process.env.CLITEST_API_KEY = "test";
    statelessScrape = true;
    providerScrape.mockResolvedValueOnce({ url: "https://example.test", text: "page text" });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCommand(scrape, {
      rawArgs: ["https://example.test", "--provider", "clitest", "--format", "text"],
    });

    expect(createSession).not.toHaveBeenCalled();
    expect(releaseSession).not.toHaveBeenCalled();
    expect(providerScrape).toHaveBeenCalledWith("https://example.test", {
      waitFor: undefined,
      maxChars: undefined,
    });
  });
});
