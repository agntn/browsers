import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Static, TSchema } from "typebox";
import type * as TypeBoxValue from "typebox/value";
import { browserToolDescriptions, browserToolLabels, type BrowserToolName } from "./tool-contract";
import { browserToolSchemas } from "./tool-schemas";
import {
  browserCapabilities,
  browserCrawl,
  browserExtract,
  browserLinks,
  browserPdf,
  browserScrape,
  browserSearch,
  browserSession,
  browserScreenshot,
  errorMessage,
  listBrowserProviders,
  releaseBrowserSession,
  type ToolResult,
} from "./tool-operations";
import { version } from "./version";

interface ToolDefinition {
  name: BrowserToolName;
  title: string;
  description: string;
  inputSchema: TSchema;
  annotations: Tool["annotations"];
  execute(
    args: Readonly<Record<string, unknown>>,
  ): ToolResult<unknown> | Promise<ToolResult<unknown>>;
}

const LIVE_READ: Tool["annotations"] = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const LOCAL_READ: Tool["annotations"] = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const CREATE_SESSION: Tool["annotations"] = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const RELEASE_SESSION: Tool["annotations"] = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

/**
 * Binds one executor to the schema MCP validates before dispatch.
 *
 * @param name - Tool name.
 * @param inputSchema - Tool argument schema.
 * @param annotations - MCP behavior annotations.
 * @param execute - Schema-bound executor.
 * @returns {ToolDefinition} Uniform tool definition.
 */
function defineTool<S extends TSchema>(
  name: BrowserToolName,
  inputSchema: S,
  annotations: Tool["annotations"],
  execute: (args: Static<S>) => ToolResult<unknown> | Promise<ToolResult<unknown>>,
): ToolDefinition {
  return {
    name,
    title: browserToolLabels[name],
    description: browserToolDescriptions[name],
    inputSchema,
    annotations,
    /**
     * SAFETY: MCP validates the same schema immediately before this adapter runs.
     *
     * @param args - Validated argument object.
     * @returns {ToolResult<unknown> | Promise<ToolResult<unknown>>} Shared executor result.
     */
    execute: (args) => execute(args as Static<S>),
  };
}

const tools: readonly ToolDefinition[] = [
  defineTool("browsers_scrape", browserToolSchemas.browsers_scrape, LIVE_READ, browserScrape),
  defineTool(
    "browsers_session",
    browserToolSchemas.browsers_session,
    CREATE_SESSION,
    browserSession,
  ),
  defineTool(
    "browsers_release",
    browserToolSchemas.browsers_release,
    RELEASE_SESSION,
    releaseBrowserSession,
  ),
  defineTool(
    "browsers_providers",
    browserToolSchemas.browsers_providers,
    LOCAL_READ,
    listBrowserProviders,
  ),
  defineTool(
    "browsers_screenshot",
    browserToolSchemas.browsers_screenshot,
    LIVE_READ,
    browserScreenshot,
  ),
  defineTool("browsers_extract", browserToolSchemas.browsers_extract, LIVE_READ, browserExtract),
  defineTool("browsers_crawl", browserToolSchemas.browsers_crawl, LIVE_READ, browserCrawl),
  defineTool("browsers_pdf", browserToolSchemas.browsers_pdf, LIVE_READ, browserPdf),
  defineTool("browsers_links", browserToolSchemas.browsers_links, LIVE_READ, browserLinks),
  defineTool("browsers_search", browserToolSchemas.browsers_search, LIVE_READ, browserSearch),
  defineTool(
    "browsers_capabilities",
    browserToolSchemas.browsers_capabilities,
    LOCAL_READ,
    browserCapabilities,
  ),
];

function validationError(
  Value: Readonly<Pick<typeof TypeBoxValue.Value, "Errors">>,
  schema: TSchema,
  value: unknown,
): string {
  const first = Value.Errors(schema, value)[0];
  if (!first) return "Invalid arguments";
  return `Invalid arguments at ${first.instancePath || "/"}: ${first.message}`;
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text: errorMessage(text) }], isError: true };
}

function toCallToolResult(result: ToolResult<unknown>): CallToolResult {
  return {
    content: result.content,
    ...(result.isError === undefined ? {} : { isError: result.isError }),
  };
}

/**
 * Creates an unconnected MCP server exposing all browser tools.
 *
 * @returns {Server} Unconnected MCP server.
 */
export function createMcpServer(): Server {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const server = new Server({ name: "browsers", version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool): Tool => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema as Tool["inputSchema"],
      annotations: tool.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolsByName.get(request.params.name as BrowserToolName);
    if (!tool) {
      return errorResult(`Unknown browsers tool: ${JSON.stringify(request.params.name)}`);
    }

    const args = request.params.arguments ?? {};
    const { Value } = await import("typebox/value");
    if (!Value.Check(tool.inputSchema, args)) {
      return errorResult(validationError(Value, tool.inputSchema, args));
    }

    try {
      return toCallToolResult(await tool.execute(args));
    } catch (error) {
      return errorResult(`${tool.name} failed: ${errorMessage(error)}`);
    }
  });

  return server;
}
