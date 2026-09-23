import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Static, TSchema } from "typebox";
import type { Errors } from "typebox/value";
import { lazy } from "./core/lazy";
import { browserToolDescriptions, browserToolLabels, type BrowserToolName } from "./tool-contract";
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

/** Writes a new file when `path` is set and never overwrites one. */
const CAPTURE: Tool["annotations"] = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
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

/**
 * The tool table and its `tools/list` payload, built on the first `tools/list` of the process.
 *
 * The schemas need TypeBox, so importing them here keeps it out of `initialize`.
 */
const tools = /* @__PURE__ */ lazy(async () => {
  const { browserToolSchemas: schemas } = await import("./tool-schemas");
  const definitions: readonly ToolDefinition[] = [
    defineTool("browsers_scrape", schemas.browsers_scrape, LIVE_READ, browserScrape),
    defineTool("browsers_session", schemas.browsers_session, CREATE_SESSION, browserSession),
    defineTool(
      "browsers_release",
      schemas.browsers_release,
      RELEASE_SESSION,
      releaseBrowserSession,
    ),
    defineTool("browsers_providers", schemas.browsers_providers, LOCAL_READ, listBrowserProviders),
    defineTool("browsers_screenshot", schemas.browsers_screenshot, CAPTURE, browserScreenshot),
    defineTool("browsers_extract", schemas.browsers_extract, LIVE_READ, browserExtract),
    defineTool("browsers_crawl", schemas.browsers_crawl, LIVE_READ, browserCrawl),
    defineTool("browsers_pdf", schemas.browsers_pdf, LIVE_READ, browserPdf),
    defineTool("browsers_links", schemas.browsers_links, LIVE_READ, browserLinks),
    defineTool("browsers_search", schemas.browsers_search, LIVE_READ, browserSearch),
    defineTool(
      "browsers_capabilities",
      schemas.browsers_capabilities,
      LOCAL_READ,
      browserCapabilities,
    ),
  ];
  return {
    byName: new Map(definitions.map((tool) => [tool.name, tool])),
    listed: definitions.map((tool): Tool => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema as Tool["inputSchema"],
      annotations: tool.annotations,
    })),
  };
});

/** The validator, loaded on the first `tools/call`; only these two functions are needed. */
const validator = /* @__PURE__ */ lazy(async () => {
  const { Check, Errors } = await import("typebox/value");
  return { Check, Errors };
});

function validationError(errors: typeof Errors, schema: TSchema, value: unknown): string {
  const first = errors(schema, value)[0];
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
 * Construction touches only the SDK. The schemas load with the first `tools/list` and the
 * validator with the first `tools/call`, so the process answers `initialize` before parsing
 * either.
 *
 * @returns {Server} Unconnected MCP server.
 */
export function createMcpServer(): Server {
  const server = new Server({ name: "browsers", version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: (await tools()).listed,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = (await tools()).byName.get(request.params.name as BrowserToolName);
    if (!tool) {
      return errorResult(`Unknown browsers tool: ${JSON.stringify(request.params.name)}`);
    }

    const args = request.params.arguments ?? {};
    const { Check, Errors } = await validator();
    if (!Check(tool.inputSchema, args)) {
      return errorResult(validationError(Errors, tool.inputSchema, args));
    }

    try {
      return toCallToolResult(await tool.execute(args));
    } catch (error) {
      return errorResult(`${tool.name} failed: ${errorMessage(error)}`);
    }
  });

  return server;
}
