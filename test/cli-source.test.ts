import { spawnSync } from "node:child_process";
import { cpSync, globSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const bin = join(repoRoot, "dist/cli.mjs");
const hook = fileURLToPath(new URL("./record-loads.mjs", import.meta.url));
const sourceRoot = pathToFileURL(join(repoRoot, "src/")).href;
/** The chunk `dist/cli.mjs` imports for `mcp` when it keeps the bundle. */
const bundledCommand = pathToFileURL(join(repoRoot, "dist/_chunks/mcp.mjs")).href;
/** Node 22 before 22.18 strips types only with a flag; the bin keeps the bundle there. */
const stripsTypes = Boolean(process.features.typescript);

interface Run {
  status: number | null;
  stderr: string;
  loaded: string[];
}

/**
 * Runs plain Node, without tsx, under the load hook and reads back every module it loaded.
 *
 * @param args - Node arguments after the hook import.
 * @param env - Extra environment; `BROWSERS_DIST` from the parent is dropped first.
 * @returns {Run} Exit status, stderr and the recorded module URLs.
 */
function run(args: readonly string[], env: Record<string, string> = {}): Run {
  const { BROWSERS_DIST: _inherited, ...environment } = process.env;
  const child = spawnSync(process.execPath, ["--import", hook, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...environment, ...env },
    input: "",
    timeout: 60_000,
  });
  const line = child.stderr.split("\n").find((entry) => entry.startsWith("@loaded "));
  if (!line) throw new Error(`no @loaded line on stderr:\n${child.stderr}`);
  return {
    status: child.status,
    stderr: child.stderr,
    loaded: JSON.parse(line.slice("@loaded ".length)) as string[],
  };
}

describe("source under plain Node", () => {
  it.skipIf(!stripsTypes)("every module in src imports without a loader", () => {
    const modules = globSync("src/**/*.ts", { cwd: repoRoot }).filter(
      (file) => file !== join("src", "cli.ts"),
    );
    const script = modules
      .map((file) => `await import(${JSON.stringify(pathToFileURL(join(repoRoot, file)).href)});`)
      .join("\n");
    const result = run(["--input-type=module", "-e", script]);

    expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED/);
    expect(result.status).toBe(0);
    expect(modules.length).toBeGreaterThan(0);
  });
});

describe("browsers mcp from the built bin", () => {
  it.skipIf(!stripsTypes)("runs the live source in a checkout", () => {
    const live = run([bin, "mcp"]);

    expect(live.status).toBe(0);
    expect(live.loaded).toContain(`${sourceRoot}mcp.ts`);
    expect(live.loaded).not.toContain(bundledCommand);
  });

  it.each([
    { name: "under BROWSERS_DIST=1", args: [bin, "mcp"], env: { BROWSERS_DIST: "1" } },
    {
      name: "on a Node that does not strip types",
      args: ["--no-experimental-strip-types", bin, "mcp"],
      env: {},
    },
  ])("keeps the bundle $name", ({ args, env }) => {
    const bundled = run(args, env);

    expect(bundled.status).toBe(0);
    expect(bundled.loaded).toContain(bundledCommand);
    expect(bundled.loaded.filter((url) => url.startsWith(sourceRoot))).toEqual([]);
  });

  it("keeps the bundle when the package sits under node_modules", () => {
    const cache = join(repoRoot, "node_modules/.cache");
    mkdirSync(cache, { recursive: true });
    const copy = mkdtempSync(join(cache, "browsers-cli-"));
    try {
      for (const entry of ["dist", "src", "package.json"]) {
        cpSync(join(repoRoot, entry), join(copy, entry), { recursive: true });
      }
      const result = run([join(copy, "dist/cli.mjs"), "mcp"]);
      const copiedSource = pathToFileURL(join(copy, "src/")).href;

      expect(result.status).toBe(0);
      expect(result.loaded).toContain(pathToFileURL(join(copy, "dist/_chunks/mcp.mjs")).href);
      expect(result.loaded.filter((url) => url.startsWith(copiedSource))).toEqual([]);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
