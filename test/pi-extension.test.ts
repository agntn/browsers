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

interface Renderable {
  render(...args: readonly unknown[]): unknown;
}

function isRenderable(value: unknown): value is Renderable {
  return (
    typeof value === "object" &&
    value !== null &&
    "render" in value &&
    typeof value.render === "function"
  );
}

function renderComponent(component: unknown): string {
  if (!isRenderable(component)) throw new Error("Renderer did not return a component");
  const lines = component.render(160);
  if (!Array.isArray(lines) || lines.some((line) => typeof line !== "string")) {
    throw new Error("Component returned invalid lines");
  }
  return lines.join("\n").trimEnd();
}

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

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

  it("does not tell the model to drive a session it cannot use", () => {
    const session = registerTools().get("browsers_session");
    const capabilities = registerTools().get("browsers_capabilities");
    const sessionCopy = [session?.promptSnippet, ...(session?.promptGuidelines ?? [])].join(" ");
    const capabilitiesCopy = (capabilities?.promptGuidelines ?? []).join(" ");

    expect(sessionCopy).not.toMatch(/full browser automation/);
    expect(sessionCopy).not.toMatch(/navigate, click, type, evaluate JS/);
    expect(capabilitiesCopy).not.toMatch(/no REST navigate\/evaluate/);
  });

  it("registers custom call and result renderers for every tool", () => {
    for (const tool of registerTools().values()) {
      expect(typeof tool.renderCall).toBe("function");
      expect(typeof tool.renderResult).toBe("function");
    }
  });

  it("adapts Pi call state and error context to the shared renderer", () => {
    const tool = registerTools().get("browsers_links");
    if (!tool?.renderCall || !tool.renderResult) throw new Error("Missing browser link renderers");

    const call: unknown = Reflect.apply(tool.renderCall, tool, [
      { url: "https://example.test" },
      plainTheme,
      { executionStarted: true, isPartial: true },
    ]);
    const result: unknown = Reflect.apply(tool.renderResult, tool, [
      { content: [{ type: "text", text: "Link extraction failed" }] },
      { expanded: false, isPartial: false },
      plainTheme,
      { isError: true },
    ]);

    expect(renderComponent(call)).toBe("◌ 🔗 Browser Links https://example.test");
    expect(renderComponent(result)).toBe("✗ Link extraction failed (failed)");
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
        browser: { const: "kitesurf" },
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
