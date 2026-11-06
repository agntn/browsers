import { spawnSync } from "node:child_process";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { isRefusal, normalizeSessionWords } from "../src/cli-commands";
import { InvalidInputError } from "../src/core/errors";

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
