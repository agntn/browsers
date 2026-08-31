import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { defineCommand } from "citty";
import { consola, LogLevels } from "consola";
import { createMcpServer } from "../mcp";

export default defineCommand({
  meta: {
    name: "mcp",
    description: "Run the browsers MCP server over stdio",
  },
  /** Keeps logs off stdout because that descriptor carries JSON-RPC frames. */
  async run() {
    consola.level = LogLevels.warn;
    await createMcpServer().connect(new StdioServerTransport());
  },
});
