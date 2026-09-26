import { defineCommand } from "citty";
import { consola, LogLevels } from "consola";

/**
 * The `browsers mcp` command.
 *
 * citty resolves every subcommand to print `--help`, so the SDK and the server module are
 * imported inside `run()` and load only when the server starts.
 */
export default defineCommand({
  meta: {
    name: "mcp",
    description: "Run the browsers MCP server over stdio",
  },
  /** Keeps logs off stdout because that descriptor carries JSON-RPC frames. */
  async run() {
    const [{ StdioServerTransport }, { createMcpServer }] = await Promise.all([
      import("@modelcontextprotocol/sdk/server/stdio.js"),
      import("../mcp.ts"),
    ]);
    consola.level = LogLevels.warn;
    await createMcpServer().connect(new StdioServerTransport());
  },
});
