import { fileURLToPath } from "node:url";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import browsersExtension, { resolveBrowsersModuleUrl } from "../packages/pi/extensions/browsers";

const browserToolsMock = vi.hoisted(() => ({
  browserScrape: vi.fn(),
  browserSession: vi.fn(),
  releaseBrowserSession: vi.fn(),
  listBrowserProviders: vi.fn(),
  browserScreenshot: vi.fn(),
  browserExtract: vi.fn(),
  browserCrawl: vi.fn(),
  browserPdf: vi.fn(),
  browserLinks: vi.fn(),
  browserSearch: vi.fn(),
  browserCapabilities: vi.fn(),
}));

vi.mock("../src/tool-operations", () => browserToolsMock);

type ExecutableTool = {
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: ExtensionContext,
  ) => Promise<AgentToolResult<unknown>>;
};

function registerTools(): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>();
  const api = {
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };
  browsersExtension(api as unknown as ExtensionAPI);
  return tools;
}

function requireTool(tools: Readonly<Map<string, ToolDefinition>>, name: string): ExecutableTool {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool as ExecutableTool;
}

async function executeTool(
  tools: Readonly<Map<string, ToolDefinition>>,
  name: string,
  params: Record<string, unknown>,
): Promise<AgentToolResult<unknown>> {
  return requireTool(tools, name).execute(
    "test",
    params,
    undefined,
    undefined,
    {} as ExtensionContext,
  );
}

describe("browsers Pi extension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads current shared operations instead of a potentially stale build", () => {
    expect(fileURLToPath(resolveBrowsersModuleUrl())).toBe(
      fileURLToPath(new URL("../src/tool-operations.ts", import.meta.url)),
    );
  });

  it("registers the complete browser tool surface", () => {
    expect([...registerTools().keys()]).toEqual([
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
  });

  it("delegates scraping to the shared executor without duplicating content", async () => {
    const result = {
      content: [{ type: "text" as const, text: "[provider=steel] body" }],
      details: { url: "https://example.test", provider: "steel", contentLength: 4 },
    };
    browserToolsMock.browserScrape.mockResolvedValue(result);

    const response = await executeTool(registerTools(), "browsers_scrape", {
      provider: "steel",
      url: "https://example.test",
      maxChars: 5,
    });

    expect(browserToolsMock.browserScrape).toHaveBeenCalledWith({
      provider: "steel",
      url: "https://example.test",
      maxChars: 5,
    });
    expect(response).toEqual(result);
    expect(JSON.stringify(response).split("body")).toHaveLength(2);
  });

  it("keeps the shared scrape bounds in the Pi schema", () => {
    expect(registerTools().get("browsers_scrape")?.parameters).toMatchObject({
      properties: {
        maxChars: {
          type: "integer",
          minimum: 1,
          maximum: 200_000,
        },
      },
    });
  });

  it("forwards extraction schemas to the shared executor", async () => {
    const schema = {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    };
    browserToolsMock.browserExtract.mockResolvedValue({
      content: [{ type: "text", text: "Example" }],
      details: {
        url: "https://example.test",
        provider: "cloudflare",
        data: { title: "Example" },
      },
    });
    const tools = registerTools();

    expect(tools.get("browsers_extract")?.parameters).toMatchObject({
      properties: {
        schema: {
          type: "object",
          patternProperties: { "^.*$": {} },
        },
      },
    });

    await executeTool(tools, "browsers_extract", {
      provider: "cloudflare",
      url: "https://example.test",
      prompt: "Extract the title",
      schema,
    });

    expect(browserToolsMock.browserExtract).toHaveBeenCalledWith({
      provider: "cloudflare",
      url: "https://example.test",
      prompt: "Extract the title",
      schema,
    });
  });

  it("returns the credential-free session result from the shared executor", async () => {
    const result = {
      content: [{ type: "text" as const, text: "[provider=steel] Session created: session-1" }],
      details: {
        session: { id: "session-1", provider: "steel", createdAt: 1_000 },
      },
    };
    browserToolsMock.browserSession.mockResolvedValue(result);

    const response = await executeTool(registerTools(), "browsers_session", {
      provider: "steel",
    });

    expect(response).toEqual(result);
    expect(JSON.stringify(response)).not.toContain("token");
  });
});
