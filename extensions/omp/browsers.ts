import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerOmpTools, type OmpRenderers } from "@agntn/tools/omp";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type { BrowserToolName } from "../../src/tool-contract.ts";
import type * as BrowserTools from "../../dist/tools.d.mts";
import {
  type RenderedToolResult,
  type RenderOptions,
  renderToolCall,
  renderToolResult,
  type StatusTheme,
} from "../shared/tui.ts";

const sourceModulePath = fileURLToPath(new URL("../../src/tools.ts", import.meta.url));

/**
 * Both specifiers stay literal: compiled OMP resolves bare imports only where it sees them.
 *
 * @returns {Promise<typeof BrowserTools>} The tool definitions.
 */
function loadTools(): Promise<typeof BrowserTools> {
  return (
    existsSync(sourceModulePath) ? import("../../src/tools.ts") : import("../../dist/tools.mjs")
  ) as Promise<typeof BrowserTools>;
}

/**
 * Registers the browser tools with OMP. The executors load on the first call.
 *
 * @param pi - OMP extension API.
 * @returns {Promise<void>} Resolves once every tool is registered.
 */
export default async function browsersOmpExtension(pi: ExtensionAPI): Promise<void> {
  const { Text } = pi.pi;
  pi.setLabel("Browsers");
  const { browserTools } = await loadTools();
  const renderers = Object.fromEntries(
    browserTools.map((tool): [string, OmpRenderers] => {
      const name: BrowserToolName = tool.name;
      return [
        name,
        {
          renderCall(
            args: unknown,
            options: Readonly<RenderOptions>,
            theme: Readonly<StatusTheme>,
          ) {
            return new Text(renderToolCall(name, args, options, theme), 0, 0);
          },
          renderResult(
            result: Readonly<RenderedToolResult>,
            options: Readonly<RenderOptions>,
            theme: Readonly<StatusTheme>,
          ) {
            return new Text(
              renderToolResult(name, result, result.isError === true, options, theme),
              0,
              0,
            );
          },
        },
      ];
    }),
  );
  registerOmpTools(pi, browserTools, { Text, renderers });
}
