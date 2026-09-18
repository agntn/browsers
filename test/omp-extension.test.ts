import { readFileSync } from "node:fs";
import * as TypeBox from "@oh-my-pi/omptype/typebox";
import { Value } from "typebox/value";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { describe, expect, it } from "vitest";
import browsersOmpExtension from "../packages/omp/extensions/browsers";
import { browserToolNames } from "../src/tool-contract";
import { browserToolSchemas } from "../src/tool-schemas";

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

function registerExtension(): RegisteredExtension {
  const tools = new Map<string, ToolDefinition>();
  let label: string | undefined;
  const api = {
    pi: { Text: TestText },
    typebox: TypeBox,
    setLabel(value: string) {
      label = value;
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };
  browsersOmpExtension(api as unknown as ExtensionAPI);
  return { label, tools };
}

function requireTool(tools: Readonly<Map<string, ToolDefinition>>, name: string): ToolDefinition {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool;
}

function accepts(tool: ToolDefinition, value: unknown): boolean {
  return (tool.parameters as unknown as TypeBox.TSchema).safeParse(value).success;
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

    expect(manifest.omp.extensions).toEqual(["./packages/omp/extensions/browsers.ts"]);
    expect(manifest.exports).toHaveProperty("./mcp");
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        "dist",
        "packages/omp/extensions",
        "packages/pi/extensions",
        "src/tool-contract.ts",
        "src/tool-schemas.ts",
      ]),
    );
  });

  it("registers the complete browser tool surface with exact approvals", () => {
    const { label, tools } = registerExtension();

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
      "browsers_search",
      "browsers_capabilities",
    ]);
    expect(requireTool(tools, "browsers_session").approval).toBe("write");
    expect(requireTool(tools, "browsers_release").approval).toBe("write");
    for (const name of [...tools.keys()].filter(
      (name) => name !== "browsers_session" && name !== "browsers_release",
    )) {
      expect(requireTool(tools, name).approval).toBe("read");
    }
  });

  it("registers custom call and result renderers for every tool", () => {
    for (const tool of registerExtension().tools.values()) {
      expect(typeof tool.renderCall).toBe("function");
      expect(typeof tool.renderResult).toBe("function");
    }
  });

  it("adapts OMP spinner and result error state to the shared renderer", () => {
    const tool = requireTool(registerExtension().tools, "browsers_links");
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

  it("keeps every OMP parameter schema aligned with Pi and MCP", () => {
    const { tools } = registerExtension();
    const samples: Record<(typeof browserToolNames)[number], { valid: unknown; invalid: unknown }> =
      {
        browsers_scrape: {
          valid: { url: "https://example.test", browser: "kitesurf" },
          invalid: {},
        },
        browsers_session: { valid: { browser: "kitesurf" }, invalid: { extra: true } },
        browsers_release: {
          valid: { sessionId: "session-1", browser: "kitesurf" },
          invalid: {},
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
          valid: { url: "https://example.test", browser: "kitesurf", maxPages: 10 },
          invalid: {},
        },
        browsers_pdf: {
          valid: { url: "https://example.test", browser: "kitesurf" },
          invalid: {},
        },
        browsers_links: {
          valid: { url: "https://example.test", browser: "kitesurf" },
          invalid: {},
        },
        browsers_search: { valid: { query: "browser agents" }, invalid: {} },
        browsers_capabilities: { valid: { provider: "playwright" }, invalid: {} },
      };

    for (const name of browserToolNames) {
      const ompTool = requireTool(tools, name);
      const sharedSchema = browserToolSchemas[name];
      expect(accepts(ompTool, samples[name].valid)).toBe(
        Value.Check(sharedSchema, samples[name].valid),
      );
      expect(accepts(ompTool, samples[name].invalid)).toBe(
        Value.Check(sharedSchema, samples[name].invalid),
      );
      expect(accepts(ompTool, { ...(samples[name].valid as object), extra: true })).toBe(false);
      expect(Value.Check(sharedSchema, { ...(samples[name].valid as object), extra: true })).toBe(
        false,
      );
    }
  });

  it("declares the scrape contract enforced by the shared executor", () => {
    const tool = requireTool(registerExtension().tools, "browsers_scrape");

    expect(accepts(tool, { url: "https://example.test" })).toBe(true);
    expect(accepts(tool, { url: "https://example.test", browser: "kitesurf" })).toBe(true);
    expect(accepts(tool, { url: "https://example.test", browser: "chromium" })).toBe(false);
    expect(accepts(tool, { url: "https://example.test", maxChars: 200_000 })).toBe(true);
    expect(accepts(tool, { url: "https://example.test", maxChars: 200_001 })).toBe(false);
    expect(accepts(tool, { url: "https://example.test", maxChars: 10.5 })).toBe(false);
  });

  it("executes capability discovery through the shared operations module", async () => {
    const tool = requireTool(registerExtension().tools, "browsers_capabilities");

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
});
