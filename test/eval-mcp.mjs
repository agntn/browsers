import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../dist/cli.mjs", import.meta.url)), "mcp"],
  stderr: "pipe",
});
const client = new Client({ name: "browsers-eval", version: "1.0.0" });

/**
 * Reads text blocks from an MCP result without trusting its compatibility payload.
 *
 * @param {unknown} content - MCP result content.
 * @returns {string[]} Text blocks.
 */
function contentTexts(content) {
  if (!Array.isArray(content)) return [];
  /** @type {string[]} */
  const texts = [];
  for (const part of /** @type {unknown[]} */ (content)) {
    if (
      typeof part === "object" &&
      part !== null &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      texts.push(part.text);
    }
  }
  return texts;
}

try {
  await client.connect(transport);
  const listed = await client.listTools();
  if (listed.tools.length !== 11) {
    throw new Error(`Expected 11 tools, got ${listed.tools.length}`);
  }
  const result = await client.callTool({
    name: "browsers_capabilities",
    arguments: { provider: "playwright" },
  });
  if (result.isError === true) {
    throw new TypeError(JSON.stringify(result.content));
  }
  const [text] = contentTexts(result.content);
  if (!text?.includes("[playwright]")) {
    throw new TypeError(`Unexpected capability result: ${JSON.stringify(result.content)}`);
  }
  console.log(`MCP stdio smoke passed with ${listed.tools.length} tools.`);
} finally {
  await client.close();
}
