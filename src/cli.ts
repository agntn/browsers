#!/usr/bin/env node

/** Browsers CLI: a command per browser tool, `sessions`, and `mcp`, which serves the tools. */
import { existsSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "@agntn/tools/cli";
import { isRefusal, normalizeSessionWords, sessionsCommand } from "./cli-commands.ts";
import type { serveStdio } from "./mcp-stdio.ts";
import { browserTools } from "./tools.ts";
import { version } from "./version.ts";

/** The same file from `src/cli.ts` and `dist/cli.mjs`; the npm package ships only `dist`. */
const sourceStdio = new URL("../src/mcp-stdio.ts", import.meta.url);
const sourceStdioPath = fileURLToPath(sourceStdio);

/**
 * Narrows the module a runtime URL import returned, which TypeScript types as `any`.
 *
 * @param value - The imported module namespace.
 * @returns {value is { serveStdio: typeof serveStdio }} Whether it exports the server.
 */
function isStdioModule(value: unknown): value is { serveStdio: typeof serveStdio } {
  return typeof value === "object" && value !== null && "serveStdio" in value;
}

/**
 * In a checkout the server runs from `src/`, so a change needs a restart, not `pnpm build`.
 * `node_modules`, a Node without type stripping and `BROWSERS_DIST=1` keep the bundle.
 *
 * @returns {Promise<typeof serveStdio>} What starts the stdio server.
 */
async function loadServer(): Promise<typeof serveStdio> {
  const fromSource =
    !import.meta.url.endsWith(".ts") &&
    process.env.BROWSERS_DIST !== "1" &&
    Boolean(process.features.typescript) &&
    !sourceStdioPath.includes(`${sep}node_modules${sep}`) &&
    existsSync(sourceStdioPath);
  if (!fromSource) return (await import("./mcp-stdio.ts")).serveStdio;
  const module: unknown = await import(sourceStdio.href);
  if (!isStdioModule(module)) throw new TypeError(`${sourceStdioPath} has no serveStdio`);
  return module.serveStdio;
}

/**
 * `mcp` alone or with option terminators starts the server; `mcp --help` stays with `runCli`.
 *
 * @param args - Every argument after the bin.
 * @returns {boolean} Whether the line starts the stdio server.
 */
function servesStdio(args: readonly string[]): boolean {
  const [command, ...rest] = args;
  return command === "mcp" && rest.every((word) => word === "--");
}

const argv = process.argv.slice(2);
if (servesStdio(argv)) {
  (await loadServer())();
} else {
  await runCli(
    {
      name: "browsers",
      version,
      description: "Unified browser-as-a-service provider for agents and CLI",
      tools: browserTools,
      commands: [sessionsCommand],
      fallback: "scrape",
      mcp: true,
      expected: isRefusal,
    },
    normalizeSessionWords(argv),
  );
}
