import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BrowserProvider } from "../../src/core/types";
import { UnsupportedOperationError } from "../../src/core/errors";
import { register } from "../../src/core/registry";
import screenshot from "../../src/commands/screenshot";

const previousApiKey = process.env.SHOTTEST_API_KEY;
const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const PNG_DATA = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
let supportsScreenshot = true;
let statelessScreenshot = false;
let outputDir = "";
const createSession = vi.fn<BrowserProvider["createSession"]>().mockResolvedValue({
  id: "session-1",
  provider: "shottest",
  createdAt: 1_000,
});
const releaseSession = vi.fn<BrowserProvider["releaseSession"]>().mockResolvedValue(undefined);
const providerScreenshot = vi.fn<BrowserProvider["screenshot"]>();

function shotTestProvider(): BrowserProvider {
  return {
    name: () => "shottest",
    capabilities: () => ({
      scrape: false,
      screenshot: supportsScreenshot,
      navigate: false,
      evaluate: false,
      sessions: true,
      cdp: false,
      statelessScrape: false,
      statelessScreenshot,
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
    scrape: vi.fn(),
    screenshot: providerScreenshot,
    navigate: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({ value: undefined }),
  };
}

function output(name: string): string {
  return join(outputDir, name);
}

beforeAll(() => {
  register("shottest", "https://example.test", () => shotTestProvider());
  outputDir = mkdtempSync(join(tmpdir(), "browsers-screenshot-"));
});

afterAll(() => {
  rmSync(outputDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  supportsScreenshot = true;
  statelessScreenshot = false;
  if (previousApiKey === undefined) delete process.env.SHOTTEST_API_KEY;
  else process.env.SHOTTEST_API_KEY = previousApiKey;
});

describe("screenshot command", () => {
  it("gives providers that need a session a temporary session", async () => {
    process.env.SHOTTEST_API_KEY = "test";
    providerScreenshot.mockResolvedValueOnce({ data: PNG_DATA, mimeType: "image/png" });

    await runCommand(screenshot, {
      rawArgs: [
        "https://example.test",
        "--provider",
        "shottest",
        "--output",
        output("session.png"),
        "--width",
        "800",
        "--height",
        "600",
      ],
    });

    expect(createSession).toHaveBeenCalledWith({ viewport: { width: 800, height: 600 } });
    expect(providerScreenshot).toHaveBeenCalledWith(
      {
        url: "https://example.test",
        format: "png",
        fullPage: true,
        viewport: { width: 800, height: 600 },
      },
      expect.objectContaining({ id: "session-1" }),
    );
    expect(releaseSession).toHaveBeenCalledWith("session-1");
    expect(readFileSync(output("session.png"))).toEqual(PNG_BYTES);
  });

  it("screenshots without a session when the provider is stateless", async () => {
    process.env.SHOTTEST_API_KEY = "test";
    statelessScreenshot = true;
    providerScreenshot.mockResolvedValueOnce({ data: PNG_DATA, mimeType: "image/png" });

    await runCommand(screenshot, {
      rawArgs: [
        "https://example.test",
        "--provider",
        "shottest",
        "--output",
        output("bare.png"),
        "--width",
        "800",
        "--height",
        "600",
      ],
    });

    expect(createSession).not.toHaveBeenCalled();
    expect(releaseSession).not.toHaveBeenCalled();
    expect(providerScreenshot).toHaveBeenCalledWith({
      url: "https://example.test",
      format: "png",
      fullPage: true,
      viewport: { width: 800, height: 600 },
    });
    expect(readFileSync(output("bare.png"))).toEqual(PNG_BYTES);
  });

  it("releases the session when the screenshot fails", async () => {
    process.env.SHOTTEST_API_KEY = "test";
    providerScreenshot.mockRejectedValueOnce(new Error("capture failed"));
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await runCommand(screenshot, {
      rawArgs: ["https://example.test", "--provider", "shottest", "--output", output("failed.png")],
    });

    expect(releaseSession).toHaveBeenCalledWith("session-1");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("opens no session for a provider without screenshots", async () => {
    process.env.SHOTTEST_API_KEY = "test";
    supportsScreenshot = false;
    providerScreenshot.mockRejectedValueOnce(
      new UnsupportedOperationError("shottest does not support screenshot via REST", "shottest"),
    );
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await runCommand(screenshot, {
      rawArgs: ["https://example.test", "--provider", "shottest", "--output", output("none.png")],
    });

    expect(createSession).not.toHaveBeenCalled();
    expect(providerScreenshot).toHaveBeenCalledWith({
      url: "https://example.test",
      format: "png",
      fullPage: true,
      viewport: undefined,
    });
    expect(exit).toHaveBeenCalledWith(1);
  });
});
