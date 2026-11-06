import { createMcpServer as createToolServer, type McpServerInfo } from "@agntn/tools/mcp";
import { browserTools } from "./tools.ts";
import { version } from "./version.ts";

/** How `browsers mcp` introduces itself on `initialize`. */
export const serverInfo = { name: "browsers", version } satisfies McpServerInfo;

/**
 * Creates an unconnected MCP server; the executors load on the first `tools/call`.
 *
 * @returns {ReturnType<typeof createToolServer>} Unconnected MCP server from SDK 2.
 */
export function createMcpServer(): ReturnType<typeof createToolServer> {
  return createToolServer(serverInfo, browserTools);
}
