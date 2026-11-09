import { readFileSync } from "node:fs";
import { validateInput, wireSchema } from "@agntn/tools";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { describe, expect, it } from "vite-plus/test";
import browsersOmpExtension from "../extensions/omp/browsers";
import { browserToolNames } from "../src/tool-contract";
import { browserTools } from "../src/tools";

class TestText {
  constructor(private readonly text: string) {}

  render(): readonly string[] {
    return this.text.split("\n");
  }
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
  const lines = component.render();
  if (!Array.isArray(lines) || lines.some((line) => typeof line !== "string")) {
    throw new Error("Component returned invalid lines");
  }
  return lines.join("\n");
}

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

interface RegisteredExtension {
  label: string | undefined;
  tools: Map<string, ToolDefinition>;
}

/** OMP's `Type.Unsafe` hands the schema over as is; the core validates inside `execute`. */
const passThroughTypebox = { Type: { Unsafe: (schema: unknown) => schema } };

async function registerExtension(): Promise<RegisteredExtension> {
  const tools = new Map<string, ToolDefinition>();
  let label: string | undefined;
  const api = {
    pi: { Text: TestText },
    typebox: passThroughTypebox,
    setLabel(value: string) {
      label = value;
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };
  await browsersOmpExtension(api as unknown as ExtensionAPI);
  return { label, tools };
}

function requireTool(tools: Readonly<Map<string, ToolDefinition>>, name: string): ToolDefinition {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool;
}

const definitions = new Map(browserTools.map((tool) => [tool.name, tool]));

/**
 * Whether the core takes the arguments the way every adapter checks them before `execute`.
 *
 * @param tool - Tool as OMP registered it.
 * @param value - Arguments from the model.
 * @returns {boolean} Whether they pass the tool schema.
 */
function accepts(tool: ToolDefinition, value: unknown): boolean {
  const definition = definitions.get(tool.name);
  if (!definition) throw new Error(`No definition for ${tool.name}`);
  return validateInput(definition, value).ok;
}

const unusedContext = {} as ExtensionContext;

function contentTexts(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: unknown) =>
    typeof part === "object" && part !== null && "text" in part && typeof part.text === "string"
      ? [part.text]
      : [],
  );
}

describe("browsers OMP extension", () => {
  it("ships one exact OMP entry and the MCP export", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      files: string[];
      exports: Record<string, unknown>;
      omp: { extensions: string[] };
    };

    expect(manifest.omp.extensions).toEqual(["./extensions/omp/browsers.ts"]);
    expect(manifest.exports).toHaveProperty("./mcp");
    expect(manifest.files).not.toContain("src/tool-schemas.ts");
    expect(manifest.files).toEqual(
      expect.arrayContaining(["dist", "extensions/omp", "extensions/pi", "src/tool-contract.ts"]),
    );
  });

  it("registers the complete browser tool surface with exact approvals", async () => {
    const { label, tools } = await registerExtension();

    expect(label).toBe("Browsers");
    expect([...tools.keys()]).toEqual([
      "browsers_scrape",
      "browsers_session",
      "browsers_release",
      "browsers_providers",
      "browsers_screenshot",
      "browsers_extract",
      "browsers_crawl",
      "browsers_pdf",
      "browsers_links",
      "browsers_accessibility",
      "browsers_webmcp_tools",
      "browsers_webmcp_call",
      "browsers_search",
      "browsers_capabilities",
    ]);
    /** Tools that leave something behind, a file, a session or a page tool's work, ask first. */
    const writes = [
      "browsers_session",
      "browsers_release",
      "browsers_screenshot",
      "browsers_pdf",
      "browsers_webmcp_call",
    ];
    for (const name of tools.keys()) {
      expect(requireTool(tools, name).approval).toBe(writes.includes(name) ? "write" : "read");
    }
  });

  it("registers custom call and result renderers for every tool", async () => {
    for (const tool of (await registerExtension()).tools.values()) {
      expect(typeof tool.renderCall).toBe("function");
      expect(typeof tool.renderResult).toBe("function");
    }
  });

  it("adapts OMP spinner and result error state to the shared renderer", async () => {
    const tool = requireTool((await registerExtension()).tools, "browsers_links");
    if (!tool.renderCall || !tool.renderResult) throw new Error("Missing browser link renderers");

    const call: unknown = Reflect.apply(tool.renderCall, tool, [
      { url: "https://example.test" },
      { isPartial: true, spinnerFrame: 2 },
      plainTheme,
    ]);
    const result: unknown = Reflect.apply(tool.renderResult, tool, [
      { content: [{ type: "text", text: "Link extraction failed" }], isError: true },
      { expanded: false, isPartial: false },
      plainTheme,
    ]);

    expect(renderComponent(call)).toBe("⠹ 🔗 Browser Links https://example.test");
    expect(renderComponent(result)).toBe("✗ Link extraction failed (failed)");
  });

  it("hands OMP the schema MCP lists and refuses what it refuses", async () => {
    const { tools } = await registerExtension();
    const samples: Record<(typeof browserToolNames)[number], { valid: unknown; invalid: unknown }> =
      {
        browsers_scrape: {
          valid: { url: "https://example.test", browser: "kitesurf" },
          invalid: {},
        },
        browsers_session: { valid: { region: "eu-west-1" }, invalid: { browser: "kitesurf" } },
        browsers_release: {
          valid: { sessionId: "session-1" },
          invalid: { sessionId: "session-1", browser: "kitesurf" },
        },
        browsers_providers: { valid: {}, invalid: { extra: true } },
        browsers_screenshot: {
          valid: { url: "https://example.test", browser: "kitesurf" },
          invalid: {},
        },
        browsers_extract: {
          valid: {
            url: "https://example.test",
            browser: "kitesurf",
            prompt: "Extract title",
            schema: { type: "object" },
          },
          invalid: { url: "https://example.test" },
        },
        browsers_crawl: {
          valid: { url: "https://example.test", browser: "kitesurf", maxPages: 10, maxChars: 500 },
          invalid: { url: "https://example.test", maxChars: 200_001 },
        },
        browsers_pdf: {
          valid: { url: "https://example.test", browser: "kitesurf", path: "page.pdf" },
          invalid: { url: "https://example.test" },
        },
        browsers_links: {
          valid: { url: "https://example.test", browser: "kitesurf" },
          invalid: {},
        },
        browsers_accessibility: {
          valid: {
            url: "https://example.test",
            browser: "kitesurf",
            root: "form",
            interestingOnly: false,
            maxChars: 500,
          },
          invalid: { url: "https://example.test", root: "" },
        },
        browsers_webmcp_tools: {
          valid: { url: "https://example.test", browser: "kitesurf", maxChars: 500 },
          invalid: { url: "https://example.test", maxChars: 0 },
        },
        browsers_webmcp_call: {
          valid: {
            url: "https://example.test",
            tool: "search",
            input: { query: "dns" },
            browser: "kitesurf",
            maxChars: 500,
          },
          invalid: { url: "https://example.test", tool: "" },
        },
        browsers_search: {
          valid: { query: "browser agents", maxResults: 3 },
          invalid: { query: "browser agents", maxResults: 11 },
        },
        browsers_capabilities: { valid: { provider: "playwright" }, invalid: {} },
      };

    for (const name of browserToolNames) {
      const ompTool = requireTool(tools, name);
      const definition = definitions.get(name);
      if (!definition) throw new Error(`No definition for ${name}`);
      expect(ompTool.parameters).toEqual(wireSchema(definition));
      expect(accepts(ompTool, samples[name].valid)).toBe(true);
      expect(accepts(ompTool, samples[name].invalid)).toBe(false);
      expect(accepts(ompTool, { ...(samples[name].valid as object), extra: true })).toBe(false);
    }
  });

  it("declares the scrape contract enforced by the shared executor", async () => {
    const tool = requireTool((await registerExtension()).tools, "browsers_scrape");

    expect(accepts(tool, { url: "https://example.test" })).toBe(true);
    expect(accepts(tool, { url: "https://example.test", browser: "kitesurf" })).toBe(true);
    expect(accepts(tool, { url: "https://example.test", browser: "chromium" })).toBe(false);
    expect(accepts(tool, { url: "https://example.test", maxChars: 200_000 })).toBe(true);
    expect(accepts(tool, { url: "https://example.test", maxChars: 200_001 })).toBe(false);
    expect(accepts(tool, { url: "https://example.test", maxChars: 10.5 })).toBe(false);
  });

  it("declares the search contract enforced by the shared executor", async () => {
    const tool = requireTool((await registerExtension()).tools, "browsers_search");

    expect(accepts(tool, { query: "browser agents" })).toBe(true);
    expect(accepts(tool, { query: "browser agents", maxResults: 1 })).toBe(true);
    expect(accepts(tool, { query: "browser agents", maxResults: 10 })).toBe(true);
    expect(accepts(tool, { query: "browser agents", maxResults: 0 })).toBe(false);
    expect(accepts(tool, { query: "browser agents", maxResults: 11 })).toBe(false);
    expect(accepts(tool, { query: "browser agents", maxResults: 2.5 })).toBe(false);
  });

  it("takes a crawl job ID in place of the starting URL", async () => {
    const tool = requireTool((await registerExtension()).tools, "browsers_crawl");

    expect(accepts(tool, { jobId: "job-1", provider: "cloudflare" })).toBe(true);
    expect(accepts(tool, { jobId: "", provider: "cloudflare" })).toBe(false);
  });

  it("executes capability discovery through the shared operations module", async () => {
    const tool = requireTool((await registerExtension()).tools, "browsers_capabilities");

    const result = await tool.execute(
      "test",
      { provider: "playwright" },
      undefined,
      undefined,
      unusedContext,
    );

    expect(contentTexts(result.content)[0]).toContain("[playwright]");
    expect(result.details).toMatchObject({ provider: "playwright" });
  });

  it("refuses bad arguments inside execute, where the core validates", async () => {
    const tool = requireTool((await registerExtension()).tools, "browsers_search");

    await expect(
      tool.execute("test", { query: "x", maxResults: 11 }, undefined, undefined, unusedContext),
    ).rejects.toThrow(/Invalid arguments at \/maxResults/);
  });
});
