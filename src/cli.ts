#!/usr/bin/env node

import { existsSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "citty";
import { normalizeMainArgs } from "./cli-args.ts";
import type McpCommand from "./commands/mcp.ts";
import { version } from "./version.ts";

/** The same file from `src/cli.ts` and `dist/cli.mjs`; the npm package does not ship it. */
const sourceMcpCommand = new URL("../src/commands/mcp.ts", import.meta.url);
const sourceMcpCommandPath = fileURLToPath(sourceMcpCommand);

/**
 * Narrows the module a runtime URL import returned, which TypeScript types as `any`.
 *
 * @param value - The imported module namespace.
 * @returns {value is { default: typeof McpCommand }} Whether it exports a default command.
 */
function isCommandModule(value: unknown): value is { default: typeof McpCommand } {
  return typeof value === "object" && value !== null && "default" in value;
}

/**
 * Loads the MCP command. A built bin inside a checkout runs the live source, as the Pi and
 * OMP extensions do, so a local server needs a restart after a change instead of `pnpm build`.
 * Node strips types by default only from 22.18 and never under `node_modules`, so an older
 * Node and a git install that ships `src` keep the bundle. `BROWSERS_DIST=1` keeps it
 * everywhere, for tests of the built output.
 *
 * @returns {Promise<typeof McpCommand>} The citty command that starts the stdio server.
 */
async function loadMcpCommand(): Promise<typeof McpCommand> {
  const fromSource =
    !import.meta.url.endsWith(".ts") &&
    process.env.BROWSERS_DIST !== "1" &&
    Boolean(process.features.typescript) &&
    !sourceMcpCommandPath.includes(`${sep}node_modules${sep}`) &&
    existsSync(sourceMcpCommandPath);
  if (!fromSource) return (await import("./commands/mcp.ts")).default;
  const module: unknown = await import(sourceMcpCommand.href);
  if (!isCommandModule(module)) {
    throw new TypeError(`${sourceMcpCommandPath} has no default command`);
  }
  return module.default;
}

const main = defineCommand({
  meta: {
    name: "browsers",
    version,
    description: "Unified browser-as-a-service provider for agents and CLI",
  },
  subCommands: {
    scrape: () => import("./commands/scrape.ts").then((m) => m.default),
    screenshot: () => import("./commands/screenshot.ts").then((m) => m.default),
    crawl: () => import("./commands/crawl.ts").then((m) => m.default),
    pdf: () => import("./commands/pdf.ts").then((m) => m.default),
    links: () => import("./commands/links.ts").then((m) => m.default),
    search: () => import("./commands/search.ts").then((m) => m.default),
    extract: () => import("./commands/extract.ts").then((m) => m.default),
    session: () => import("./commands/session.ts").then((m) => m.default),
    providers: () => import("./commands/providers.ts").then((m) => m.default),
    mcp: loadMcpCommand,
  },
});

await runMain(main, { rawArgs: normalizeMainArgs(process.argv.slice(2)) });
