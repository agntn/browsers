import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerPiTools, type PiRenderers } from "@agntn/tools/pi";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { BrowserToolName } from "../../src/tool-contract.ts";
import type * as BrowserTools from "../../dist/tools.d.mts";
import {
  type RenderedToolResult,
  type RenderOptions,
  renderToolCall,
  renderToolResult,
  type StatusTheme,
} from "../shared/tui.ts";

const sourceModuleUrl = new URL("../../src/tools.ts", import.meta.url);
const distributionModuleUrl = new URL("../../dist/tools.mjs", import.meta.url);

/**
 * Returns the tool definitions from source in a checkout and from dist in a package.
 *
 * @returns {string} Module URL for the current package layout.
 */
export function resolveBrowsersModuleUrl(): string {
  return existsSync(fileURLToPath(sourceModuleUrl))
    ? sourceModuleUrl.href
    : distributionModuleUrl.href;
}

/**
 * The call line and the result block of one tool, drawn by the shared terminal renderer.
 *
 * @param tool - Tool name.
 * @returns {PiRenderers} Pi renderers for the tool.
 */
function statusRenderers(tool: BrowserToolName): PiRenderers {
  return {
    renderCall(args: unknown, theme: Readonly<StatusTheme>, context: Readonly<RenderOptions>) {
      return new Text(renderToolCall(tool, args, context, theme), 0, 0);
    },
    renderResult(
      result: Readonly<RenderedToolResult>,
      options: Readonly<RenderOptions>,
      theme: Readonly<StatusTheme>,
      context?: Readonly<{ isError?: boolean }>,
    ) {
      return new Text(
        renderToolResult(tool, result, context?.isError === true, options, theme),
        0,
        0,
      );
    },
  };
}

/**
 * Registers the browser tools with Pi. The executors load on the first call.
 *
 * @param pi - Pi extension API.
 * @returns {Promise<void>} Resolves once every tool is registered.
 */
export default async function browsersExtension(pi: ExtensionAPI): Promise<void> {
  const { browserTools } = (await import(resolveBrowsersModuleUrl())) as typeof BrowserTools;
  const renderers = Object.fromEntries(
    browserTools.map((tool): [string, PiRenderers] => [tool.name, statusRenderers(tool.name)]),
  );
  registerPiTools(pi, browserTools, { renderers });
}
