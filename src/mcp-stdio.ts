import {
  serveStdio as serveEras,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";
import { createMcpServer } from "./mcp.ts";

/**
 * Serves 2025 and 2026 clients on stdio, with a fresh server per connection.
 *
 * @returns {StdioServerHandle} What closes the connection.
 */
export function serveStdio(): StdioServerHandle {
  return serveEras(() => createMcpServer());
}
