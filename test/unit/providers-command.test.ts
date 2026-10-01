import { runCommand } from "citty";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { AuthError } from "../../src/core/errors";
import { register } from "../../src/core/registry";
import type { BrowserProvider } from "../../src/core/types";
import providersCommand from "../../src/commands/providers";

vi.mock(import("../../src/core/registry"), async (importOriginal) => ({
  ...(await importOriginal()),
  providers: () => ["checkup", "checkdown", "checkcrash"],
}));

function checkProvider(name: string, checkAvailability: () => Promise<void>): BrowserProvider {
  return {
    name: () => name,
    capabilities: () => ({
      scrape: false,
      screenshot: false,
      navigate: false,
      evaluate: false,
      sessions: false,
      cdp: false,
      statelessScrape: false,
      statelessScreenshot: false,
      crawl: false,
      pdf: false,
      links: false,
      search: false,
      extract: false,
    }),
    createSession: vi.fn(),
    getSession: vi.fn(),
    listSessions: vi.fn(),
    releaseSession: vi.fn(),
    scrape: vi.fn(),
    screenshot: vi.fn(),
    navigate: vi.fn(),
    evaluate: vi.fn(),
    checkAvailability,
  };
}

beforeAll(() => {
  register("checkup", "https://up.test", () => checkProvider("checkup", () => Promise.resolve()));
  register("checkdown", "https://down.test", () =>
    checkProvider("checkdown", () =>
      Promise.reject(
        new AuthError("Authentication failed for checkdown: Unauthorized", "checkdown"),
      ),
    ),
  );
  register("checkcrash", "https://crash.test", () =>
    checkProvider("checkcrash", () =>
      Promise.reject(new Error("browserType.launch: Executable doesn't exist\n╔═══╗")),
    ),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("providers --check", () => {
  it("prints why a provider failed, one line per provider", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runCommand(providersCommand, { rawArgs: ["--check"] });

    expect(log.mock.calls).toEqual([
      ["✓ checkup"],
      ["✗ checkdown (Authentication failed for checkdown: Unauthorized)"],
      ["✗ checkcrash (browserType.launch: Executable doesn't exist)"],
    ]);
  });
});
