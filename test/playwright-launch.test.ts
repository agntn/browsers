import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { BrowserError } from "../src/core/errors";
import { create } from "../src/core/registry";
import type { BrowserProvider } from "../src/core/types";

const crashingChrome = fileURLToPath(new URL("fixtures/crashing-chrome", import.meta.url));
const chromePath = join(crashingChrome, "google-chrome-stable");
const noBrowsers = mkdtempSync(join(tmpdir(), "browsers-none-"));
const savedBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;

type Launch = (provider: BrowserProvider) => Promise<unknown>;

const launches: ReadonlyArray<readonly [string, Launch]> = [
  ["createSession", async (provider) => provider.createSession()],
  ["scrape", async (provider) => provider.scrape("data:text/html,<p>hi</p>")],
  ["checkAvailability", async (provider) => provider.checkAvailability?.()],
];

/* Runs one launch path and hands back what it threw, which has to be a BrowserError. */
async function launchError(launch: Launch): Promise<BrowserError> {
  const error: unknown = await launch(await create("playwright")).then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BrowserError);
  if (!(error instanceof BrowserError)) throw new Error("launch did not fail");
  return error;
}

describe("playwright launch failures", { timeout: 30_000 }, () => {
  /** playwright-core reads this on its first launch only, so the whole file shares one. */
  beforeAll(() => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = noBrowsers;
  });

  afterAll(() => {
    if (savedBrowsersPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = savedBrowsersPath;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(launches)("%s names a crash by its first stderr lines", async (_name, launch) => {
    vi.stubEnv("PATH", `${crashingChrome}${delimiter}${process.env.PATH ?? ""}`);
    const { message } = await launchError(launch);
    expect(message).toBe(
      `Playwright couldn't start ${chromePath} (SIGTRAP): mkdir: cannot create directory '/nonexistent': Permission denied; chrome_crashpad_handler: --database is required; Try 'chrome_crashpad_handler --help' for more information.`,
    );
  });

  it.each(launches)("%s reports a missing browser with its path", async (_name, launch) => {
    vi.stubEnv("PATH", mkdtempSync(join(tmpdir(), "browsers-path-")));
    const { message } = await launchError(launch);
    expect(message).toMatch(
      new RegExp(
        `^Playwright browser not found at ${noBrowsers}/\\S+\\. Run: npx playwright-core install chromium$`,
      ),
    );
  });
});
