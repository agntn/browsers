import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp";

const openConnections: Array<{ close(): Promise<void> }> = [];

function contentTexts(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: unknown) =>
    typeof part === "object" && part !== null && "text" in part && typeof part.text === "string"
      ? [part.text]
      : [],
  );
}

async function connectTestClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "browsers-test", version: "1.0.0" });
  openConnections.push(client, server);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

afterEach(async () => {
  await Promise.all(openConnections.splice(0).map((connection) => connection.close()));
});

describe("browsers MCP server", () => {
  it("advertises the complete Pi tool surface", async () => {
    const client = await connectTestClient();

    const response = await client.listTools();

    expect(response.tools.map((tool) => tool.name)).toEqual([
      "browsers_scrape",
      "browsers_session",
      "browsers_release",
      "browsers_providers",
      "browsers_screenshot",
      "browsers_extract",
      "browsers_crawl",
      "browsers_pdf",
      "browsers_links",
      "browsers_search",
      "browsers_capabilities",
    ]);
    expect(
      response.tools.find((tool) => tool.name === "browsers_scrape")?.inputSchema,
    ).toMatchObject({
      type: "object",
      required: ["url"],
      properties: {
        browser: { const: "kitesurf" },
        maxChars: { type: "integer", minimum: 1, maximum: 200_000 },
      },
    });
    expect(
      response.tools.find((tool) => tool.name === "browsers_release")?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(
      response.tools.find((tool) => tool.name === "browsers_screenshot")?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
  });

  it("executes local capability discovery", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "browsers_capabilities",
      arguments: { provider: "playwright" },
    });

    expect(response.isError).not.toBe(true);
    expect(contentTexts(response.content)[0]).toContain("[playwright]");
  });

  it("rejects arguments outside the shared contract", async () => {
    const client = await connectTestClient();

    const invalidLimit = await client.callTool({
      name: "browsers_scrape",
      arguments: { url: "https://example.test", maxChars: 200_001 },
    });
    const invalidBrowser = await client.callTool({
      name: "browsers_scrape",
      arguments: { url: "https://example.test", browser: "chromium" },
    });

    expect(invalidLimit.isError).toBe(true);
    expect(contentTexts(invalidLimit.content)[0]).toContain("Invalid arguments");
    expect(invalidBrowser.isError).toBe(true);
    expect(contentTexts(invalidBrowser.content)[0]).toContain("Invalid arguments");
  });

  it("rejects prototype property names as unknown tools", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({ name: "toString", arguments: {} });

    expect(response.isError).toBe(true);
    expect(response.content).toEqual([{ type: "text", text: 'Unknown browsers tool: "toString"' }]);
  });

  it("keeps control bytes in a tool name from forging error lines", async () => {
    const client = await connectTestClient();
    const escape = String.fromCodePoint(27);

    const response = await client.callTool({
      name: `missing\nforged${escape}[31m`,
      arguments: {},
    });

    expect(response.isError).toBe(true);
    const [part] = response.content as Array<{ text: string }>;
    expect(part?.text).not.toContain("\n");
    expect(part?.text).not.toContain(escape);
  });
});
