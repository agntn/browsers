import { spawnSync } from "node:child_process";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { isRefusal, normalizeSessionWords } from "../src/cli-commands";
import { InvalidInputError } from "../src/core/errors";
import { systemChromium } from "./chromium";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the CLI from source with no provider keys, so every provider call stops at its key check.
 *
 * @param args - Words after `browsers`.
 * @returns {Run} Exit status and both streams.
 */
function browsers(...args: string[]): Run {
  const child = spawnSync(process.execPath, ["src/cli.ts", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: "/nonexistent" },
    input: "",
    timeout: 60_000,
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

describe("normalizeSessionWords", () => {
  it.each([
    [
      ["session", "create", "-p", "steel"],
      ["session", "-p", "steel"],
    ],
    [
      ["session", "release", "abc", "-p", "steel"],
      ["release", "abc", "-p", "steel"],
    ],
    [
      ["session", "list", "-p", "steel"],
      ["sessions", "-p", "steel"],
    ],
    [
      ["session", "-p", "steel"],
      ["session", "-p", "steel"],
    ],
    [
      ["session", "toString"],
      ["session", "toString"],
    ],
    [
      ["scrape", "list"],
      ["scrape", "list"],
    ],
    [[], []],
  ])("reads %j as %j", (line, expected) => {
    expect(normalizeSessionWords(line)).toEqual(expected);
  });
});

describe("isRefusal", () => {
  it("takes a path that already exists as a refusal, not a crash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "browsers-refusal-"));
    try {
      const file = join(dir, "shot.png");
      await (await open(file, "wx")).close();
      const failure: unknown = await open(file, "wx").then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(isRefusal(failure)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the stack trace of anything else", () => {
    expect(isRefusal(new InvalidInputError("no"))).toBe(true);
    expect(isRefusal(new TypeError("bug"))).toBe(false);
    expect(isRefusal("text")).toBe(false);
  });
});

describe("browsers CLI", () => {
  it("scrapes a URL given in place of a command", () => {
    const run = browsers("https://example.com", "-p", "steel");

    expect(run.status).toBe(1);
    expect(run.stderr.trim()).toBe("Missing API key for steel. Set STEEL_API_KEY");
  });

  it("still takes session list", () => {
    const run = browsers("session", "list", "-p", "steel");

    expect(run.status).toBe(1);
    expect(run.stderr.trim()).toBe("Missing API key for steel. Set STEEL_API_KEY");
  });

  it("names the flag a schema bound refuses", () => {
    const run = browsers("links", "https://example.com", "--limit", "1.5");

    expect(run.status).toBe(1);
    expect(run.stderr.trim()).toBe("Invalid arguments at --limit: must be integer");
  });

  it("prints the capabilities of a provider without a key", () => {
    const run = browsers("capabilities", "playwright");

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("[playwright]");
  });

  it("prints details as JSON on --json", () => {
    const run = browsers("providers", "--json");

    expect(run.status).toBe(0);
    const details = JSON.parse(run.stdout) as { providers: Array<{ name: string }> };
    expect(details.providers.map((row) => row.name)).toContain("playwright");
  });
});

/* A cold Chrome launch on a CI runner takes longer than the vitest defaults. */
describe("browsers session", { timeout: 60_000 }, () => {
  let profiles: string;

  beforeAll(async () => {
    profiles = await mkdtemp(join(tmpdir(), "browsers-cli-session-"));
  });

  afterAll(async () => {
    await rm(profiles, { recursive: true, force: true });
  });

  it.each(["playwright", "lightpanda"])(
    "prints a %s session, closes it and exits",
    async (provider) => {
      const child = spawnSync(process.execPath, ["src/cli.ts", "session", "-p", provider], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          HOME: profiles,
          TMPDIR: profiles,
          BROWSERS_TEST_LIGHTPANDA_CHROME: systemChromium() ?? chromium.executablePath(),
          BROWSERS_TEST_LIGHTPANDA_PROFILE: profiles,
        },
        input: "",
        timeout: 30_000,
      });
      const id = /Session created: (\S+)/.exec(child.stdout)?.[1];

      /* Playwright exits 0 on the timeout SIGTERM, so only `error` gives a hang away. */
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(0);
      expect(id).toBeDefined();
      expect(child.stderr).toBe(
        `[provider=${provider}] Session ${id} released: it lived in this process.\n`,
      );
      /* Chrome may take a moment to leave after the CLI exits; a leaked one stays. */
      await expect
        .poll(() => spawnSync("pgrep", ["-f", profiles]).status, { timeout: 10_000 })
        .toBe(1);
    },
  );
});
