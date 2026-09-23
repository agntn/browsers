import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { browserProviderNames } from "../src/tool-contract";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const hook = fileURLToPath(new URL("./record-loads.mjs", import.meta.url));

/** Modules no usage path and no bare import of an entry may pull in. */
const heavy = {
  sdk: "/node_modules/@modelcontextprotocol/",
  typebox: "/node_modules/typebox/",
  ofetch: "/node_modules/ofetch/",
  server: "/src/mcp.ts",
  schemas: "/src/tool-schemas.ts",
};

interface Run {
  status: number | null;
  stdout: string;
  loaded: string[];
}

/**
 * Runs the sources under the load hook and reads back every module the process loaded.
 *
 * @param args - Node arguments after the hook imports.
 * @returns {Run} Exit status, stdout and the recorded module URLs.
 */
function run(args: readonly string[]): Run {
  const child = spawnSync(process.execPath, ["--import", "tsx", "--import", hook, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    input: "",
    timeout: 60_000,
  });
  const line = child.stderr.split("\n").find((entry) => entry.startsWith("@loaded "));
  if (!line) throw new Error(`no @loaded line on stderr:\n${child.stderr}`);
  return {
    status: child.status,
    stdout: child.stdout,
    loaded: JSON.parse(line.slice("@loaded ".length)) as string[],
  };
}

function cli(...args: string[]): Run {
  return run(["src/cli.ts", ...args]);
}

function evaluate(script: string): Run {
  return run(["--input-type=module", "-e", script]);
}

function loadedProviders(loaded: readonly string[]): string[] {
  return browserProviderNames.filter((name) =>
    loaded.some((url) => url.endsWith(`/src/providers/${name}.ts`)),
  );
}

function loadedHeavy(loaded: readonly string[]): string[] {
  return Object.entries(heavy)
    .filter(([, marker]) => loaded.some((url) => url.includes(marker)))
    .map(([name]) => name);
}

describe("CLI usage paths", () => {
  it.each([
    { args: ["--help"], anchor: /USAGE.*browsers scrape\|/ },
    { args: ["-h"], anchor: /USAGE.*browsers scrape\|/ },
    { args: ["--version"], anchor: /^\d+\.\d+\.\d+/ },
    { args: ["scrape", "--help"], anchor: /USAGE.*browsers scrape/ },
    { args: ["mcp", "--help"], anchor: /USAGE.*browsers mcp/ },
  ])("browsers $args loads no provider, no SDK and no TypeBox", ({ args, anchor }) => {
    const result = cli(...args);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(anchor);
    expect(loadedHeavy(result.loaded)).toEqual([]);
    expect(loadedProviders(result.loaded)).toEqual([]);
  });

  it("browsers --version prints the package version", () => {
    expect(cli("--version").stdout.trim()).toBe(pkg.version);
  });

  it("browsers mcp still loads the server and the SDK", () => {
    const result = cli("mcp");

    expect(result.status).toBe(0);
    expect(loadedHeavy(result.loaded)).toEqual(expect.arrayContaining(["sdk", "server"]));
  });
});

describe("package entries", () => {
  it("importing the package loads no provider and no HTTP client", () => {
    const result = evaluate('await import("./src/index.ts")');

    expect(result.status).toBe(0);
    expect(loadedHeavy(result.loaded)).toEqual([]);
    expect(loadedProviders(result.loaded)).toEqual([]);
  });

  it("importing the MCP entry loads the SDK and nothing a call needs", () => {
    const result = evaluate('await import("./src/mcp.ts")');

    expect(result.status).toBe(0);
    expect(loadedHeavy(result.loaded)).toEqual(["sdk", "server"]);
    expect(loadedProviders(result.loaded)).toEqual([]);
  });

  it("importing the executors loads no provider and no HTTP client", () => {
    const result = evaluate('await import("./src/tool-operations.ts")');

    expect(result.status).toBe(0);
    expect(loadedHeavy(result.loaded)).toEqual([]);
    expect(loadedProviders(result.loaded)).toEqual([]);
  });

  it("create() loads the named provider only", () => {
    const result = evaluate(
      'const m = await import("./src/index.ts"); await m.create("steel", { apiKey: "x" });',
    );

    expect(result.status).toBe(0);
    expect(loadedProviders(result.loaded)).toEqual(["steel"]);
    expect(loadedHeavy(result.loaded)).toEqual([]);
  });
});
