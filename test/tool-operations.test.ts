import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BrowserProvider } from "../src/core/types";
import { register } from "../src/core/registry";
import {
  browserCapabilities,
  browserLinks,
  browserPdf,
  browserScrape,
  browserSession,
  browserScreenshot,
  listBrowserProviders,
  releaseBrowserSession,
} from "../src/tool-operations";

const previousApiKey = process.env.TOOLTEST_API_KEY;
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PDF_BYTES = Buffer.from("%PDF-1.7\n%%EOF\n");
let statelessScrape = true;
const createSession = vi.fn<BrowserProvider["createSession"]>().mockResolvedValue({
  id: "session-1",
  provider: "tooltest",
  createdAt: 1_000,
  cdpUrl: "wss://example.test?token=secret",
  metadata: { token: "secret" },
});
const releaseSession = vi.fn<(sessionId: string) => Promise<void>>().mockResolvedValue(undefined);
const scrape = vi.fn<BrowserProvider["scrape"]>();
const screenshot = vi.fn<BrowserProvider["screenshot"]>();
const links = vi.fn<NonNullable<BrowserProvider["links"]>>();
const pdf = vi.fn<NonNullable<BrowserProvider["pdf"]>>();

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
      statelessScrape,
      statelessScreenshot: true,
      crawl: false,
      pdf: true,
      links: true,
      search: false,
      extract: false,
    }),
    createSession,
    getSession: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn().mockResolvedValue([]),
    releaseSession,
    scrape,
    screenshot,
    navigate: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({ value: undefined }),
    links,
    pdf,
  };
}

beforeAll(() => {
  register("tooltest", "https://example.test", () => toolTestProvider());
});

afterEach(() => {
  vi.clearAllMocks();
  releaseSession.mockReset().mockResolvedValue(undefined);
  statelessScrape = true;
  if (previousApiKey === undefined) delete process.env.TOOLTEST_API_KEY;
  else process.env.TOOLTEST_API_KEY = previousApiKey;
});

describe("browser tool operations", () => {
  it("bounds normalized scrape content once", async () => {
    process.env.TOOLTEST_API_KEY = "test";
    scrape.mockResolvedValueOnce({ url: "https://example.test", text: "abcdefgh" });

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
    expect(createSession).not.toHaveBeenCalled();
    expect(releaseSession).not.toHaveBeenCalled();
  });

  it("gives scrapers that need a session a temporary session", async () => {
    process.env.TOOLTEST_API_KEY = "test";
    statelessScrape = false;
    scrape.mockResolvedValueOnce({ url: "https://example.test", text: "content" });

    await browserScrape({ provider: "tooltest", url: "https://example.test" });

    expect(createSession).toHaveBeenCalledOnce();
    expect(scrape).toHaveBeenCalledWith(
      "https://example.test",
      { waitFor: undefined, maxChars: 20_000 },
      expect.objectContaining({ id: "session-1" }),
    );
    expect(releaseSession).toHaveBeenCalledWith("session-1");
  });

  it("releases temporary scrape sessions without replacing the scrape error", async () => {
    process.env.TOOLTEST_API_KEY = "test";
    statelessScrape = false;
    scrape.mockRejectedValueOnce(new Error("scrape failed"));
    releaseSession.mockRejectedValueOnce(new Error("release failed"));

    await expect(
      browserScrape({ provider: "tooltest", url: "https://example.test" }),
    ).rejects.toThrow("scrape failed");
    expect(releaseSession).toHaveBeenCalledWith("session-1");
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

  it("rejects Kitesurf with providers other than Cloudflare before I/O", async () => {
    process.env.TOOLTEST_API_KEY = "test";

    await expect(
      browserScrape({
        provider: "tooltest",
        browser: "kitesurf",
        url: "https://example.test",
      }),
    ).rejects.toThrow("The Kitesurf browser is only available with Cloudflare");
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

  it("deduplicates links in order of first appearance across visible and structured output", async () => {
    process.env.TOOLTEST_API_KEY = "test";
    links.mockResolvedValue({
      url: "https://example.test",
      links: [
        { href: "https://example.test/first" },
        { href: "https://example.test/second" },
        { href: "https://example.test/first" },
      ],
    });

    const result = await browserLinks({ provider: "tooltest", url: "https://example.test" });

    expect(result.content).toEqual([
      {
        type: "text",
        text: "[provider=tooltest] 2 links:\nhttps://example.test/first\nhttps://example.test/second",
      },
    ]);
    expect(result.details.links).toEqual([
      "https://example.test/first",
      "https://example.test/second",
    ]);
  });

  it("returns the screenshot as an image block, typed by its bytes", async () => {
    process.env.TOOLTEST_API_KEY = "test";
    screenshot.mockResolvedValue({
      data: `data:image/png;base64,${JPEG_BYTES.toString("base64")}`,
      mimeType: "image/png",
    });

    const result = await browserScreenshot({
      provider: "tooltest",
      url: "https://example.test",
      fullPage: true,
    });

    expect(result.content).toEqual([
      {
        type: "text",
        text: "[provider=tooltest] Stateless screenshot of https://example.test: image/jpeg, 6 bytes.",
      },
      { type: "image", data: JPEG_BYTES.toString("base64"), mimeType: "image/jpeg" },
    ]);
    expect(result.details).toEqual({
      url: "https://example.test",
      provider: "tooltest",
      mimeType: "image/jpeg",
      bytes: 6,
      saved: false,
    });
  });

  it("writes the screenshot to path instead of returning it", async () => {
    process.env.TOOLTEST_API_KEY = "test";
    screenshot.mockResolvedValue({ data: PNG_BYTES.toString("base64"), mimeType: "image/png" });
    const directory = await mkdtemp(join(tmpdir(), "browsers-screenshot-"));
    const path = join(directory, "nested", "page.png");

    try {
      const result = await browserScreenshot({
        provider: "tooltest",
        url: "https://example.test",
        path,
      });

      expect(await readFile(path)).toEqual(PNG_BYTES);
      expect(result.content).toEqual([
        {
          type: "text",
          text: `[provider=tooltest] Stateless screenshot of https://example.test: image/png, 12 bytes, saved to ${path}.`,
        },
      ]);
      expect(result.details).toEqual({
        url: "https://example.test",
        provider: "tooltest",
        mimeType: "image/png",
        bytes: 12,
        saved: true,
        path,
      });
      await expect(
        browserScreenshot({ provider: "tooltest", url: "https://example.test", path }),
      ).rejects.toThrow("EEXIST");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["an empty payload", "", "tooltest returned an empty screenshot"],
    ["an empty data URL", "data:image/png;base64,", "tooltest returned an empty screenshot"],
    [
      "a hosted URL",
      "https://images.example.test/shot.png",
      "tooltest returned a screenshot that is not base64 image data",
    ],
  ])("fails on %s instead of reporting a screenshot", async (_case, data, message) => {
    process.env.TOOLTEST_API_KEY = "test";
    screenshot.mockResolvedValue({ data, mimeType: "image/png" });

    await expect(
      browserScreenshot({ provider: "tooltest", url: "https://example.test" }),
    ).rejects.toThrow(message);
  });

  it("asks for path when the screenshot is too large to return", async () => {
    process.env.TOOLTEST_API_KEY = "test";
    const large = Buffer.concat([PNG_BYTES, Buffer.alloc(4 * 1024 * 1024)]);
    screenshot.mockResolvedValue({ data: large.toString("base64"), mimeType: "image/png" });

    await expect(
      browserScreenshot({ provider: "tooltest", url: "https://example.test" }),
    ).rejects.toThrow(
      `Screenshot is ${large.length} bytes, too large to return inline. Pass path to save it to a file.`,
    );
  });

  it("writes the PDF to path and returns only the file", async () => {
    process.env.TOOLTEST_API_KEY = "test";
    pdf.mockResolvedValue({
      data: `data:application/pdf;base64,${PDF_BYTES.toString("base64")}`,
      mimeType: "application/pdf",
    });
    const directory = await mkdtemp(join(tmpdir(), "browsers-pdf-"));
    const path = join(directory, "nested", "page.pdf");

    try {
      const result = await browserPdf({ provider: "tooltest", url: "https://example.test", path });

      expect(await readFile(path)).toEqual(PDF_BYTES);
      expect(result.content).toEqual([
        {
          type: "text",
          text: `[provider=tooltest] PDF of https://example.test: ${PDF_BYTES.length} bytes, saved to ${path}.`,
        },
      ]);
      expect(result.details).toEqual({
        url: "https://example.test",
        provider: "tooltest",
        bytes: PDF_BYTES.length,
        path,
      });
      await expect(
        browserPdf({ provider: "tooltest", url: "https://example.test", path }),
      ).rejects.toThrow("EEXIST");
      expect(await readFile(path)).toEqual(PDF_BYTES);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["an empty payload", "", "tooltest returned an empty PDF"],
    [
      "a hosted URL",
      "https://files.example.test/page.pdf",
      "tooltest returned a PDF that is not base64 PDF data",
    ],
    [
      "base64 that is not a PDF",
      PNG_BYTES.toString("base64"),
      "tooltest returned a PDF that does not start with %PDF-",
    ],
  ])("fails on %s instead of writing a file", async (_case, data, message) => {
    process.env.TOOLTEST_API_KEY = "test";
    pdf.mockResolvedValue({ data, mimeType: "application/pdf" });
    const directory = await mkdtemp(join(tmpdir(), "browsers-pdf-"));
    const path = join(directory, "page.pdf");

    try {
      await expect(
        browserPdf({ provider: "tooltest", url: "https://example.test", path }),
      ).rejects.toThrow(message);
      await expect(readFile(path)).rejects.toThrow("ENOENT");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("lists registered providers and reports capabilities consistently", async () => {
    process.env.TOOLTEST_API_KEY = "test";

    const listing = await listBrowserProviders();
    const capabilities = await browserCapabilities({ provider: "tooltest" });

    expect(listing.details.providers).toContainEqual(
      expect.objectContaining({ name: "tooltest", configured: true }),
    );
    expect(capabilities.details).toMatchObject({
      provider: "tooltest",
      capabilities: { scrape: true, statelessScrape: true },
    });
  });
});
