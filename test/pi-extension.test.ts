import { fileURLToPath } from "node:url";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import browsersExtension, { resolveBrowsersModuleUrl } from "../packages/pi/extensions/browsers";

const browsersMock = vi.hoisted(() => ({
  create: vi.fn(),
  resolveProvider: vi.fn(),
}));

vi.mock("../src/index", () => browsersMock);

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

function requireTool(tools: Map<string, ToolDefinition>, name: string): ExecutableTool {
  const tool = tools.get(name);
  expect(tool).toBeDefined();
  return tool as ExecutableTool;
}

describe("browsers Pi extension", () => {
  it("loads current source instead of a potentially stale build", () => {
    expect(fileURLToPath(resolveBrowsersModuleUrl())).toBe(
      fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    );
  });

  it("stores scraped page content only once in the tool result", async () => {
    const sentinel = "SENTINEL_PAGE_BODY";
    const provider = {
      scrape: vi.fn().mockResolvedValue({
        url: "https://example.test",
        text: sentinel,
      }),
    };
    browsersMock.resolveProvider.mockReturnValue("steel");
    browsersMock.create.mockReturnValue(provider);

    const result = await requireTool(registerTools(), "browsers_scrape").execute(
      "test",
      { provider: "steel", url: "https://example.test" },
      undefined,
      undefined,
      {} as ExtensionContext,
    );

    expect(result.content).toEqual([
      {
        type: "text",
        text: `[provider=steel] https://example.test\n\n${sentinel}`,
      },
    ]);
    expect(result.details).toEqual({
      url: "https://example.test",
      provider: "steel",
      contentLength: sentinel.length,
    });
    expect(JSON.stringify(result).split(sentinel)).toHaveLength(2);
  });

  it("bounds scraped content after provider normalization", async () => {
    const provider = {
      scrape: vi.fn().mockResolvedValue({
        url: "https://example.test",
        html: "abcdefgh",
      }),
    };
    browsersMock.resolveProvider.mockReturnValue("cloudflare");
    browsersMock.create.mockReturnValue(provider);

    const result = await requireTool(registerTools(), "browsers_scrape").execute(
      "test",
      { provider: "cloudflare", url: "https://example.test", maxChars: 5 },
      undefined,
      undefined,
      {} as ExtensionContext,
    );

    expect(provider.scrape).toHaveBeenCalledWith("https://example.test", {
      waitFor: undefined,
      maxChars: 5,
    });
    expect(result.content).toEqual([
      {
        type: "text",
        text: "[provider=cloudflare] https://example.test\n\nabcde\n\n[truncated 3 of 8 characters]",
      },
    ]);
    expect(result.details).toEqual({
      url: "https://example.test",
      provider: "cloudflare",
      contentLength: 8,
    });
  });

  it("registers and applies a bounded default for scrape output", async () => {
    const provider = {
      scrape: vi.fn().mockResolvedValue({
        url: "https://example.test",
        text: "x".repeat(20_001),
      }),
    };
    browsersMock.resolveProvider.mockReturnValue("steel");
    browsersMock.create.mockReturnValue(provider);

    const tools = registerTools();
    expect(tools.get("browsers_scrape")?.parameters).toMatchObject({
      properties: {
        maxChars: {
          type: "integer",
          minimum: 1,
          maximum: 200_000,
        },
      },
    });

    const result = await requireTool(tools, "browsers_scrape").execute(
      "test",
      { provider: "steel", url: "https://example.test" },
      undefined,
      undefined,
      {} as ExtensionContext,
    );

    expect(provider.scrape).toHaveBeenCalledWith("https://example.test", {
      waitFor: undefined,
      maxChars: 20_000,
    });
    expect(result.content[0]).toEqual({
      type: "text",
      text: `[provider=steel] https://example.test\n\n${"x".repeat(20_000)}\n\n[truncated 1 of 20001 characters]`,
    });
  });

  it("rejects scrape limits outside the registered range before I/O", async () => {
    const provider = { scrape: vi.fn() };
    browsersMock.resolveProvider.mockReturnValue("steel");
    browsersMock.create.mockReturnValue(provider);

    await expect(
      requireTool(registerTools(), "browsers_scrape").execute(
        "test",
        { provider: "steel", url: "https://example.test", maxChars: 200_001 },
        undefined,
        undefined,
        {} as ExtensionContext,
      ),
    ).rejects.toThrow("maxChars must be an integer between 1 and 200000.");
    expect(provider.scrape).not.toHaveBeenCalled();
  });

  it("keeps session connection credentials out of tool output", async () => {
    const secretUrl = "wss://connect.example.test?token=secret&signingKey=jwt";
    const provider = {
      createSession: vi.fn().mockResolvedValue({
        id: "session-1",
        provider: "steel",
        cdpUrl: secretUrl,
        createdAt: 1_000,
        metadata: {
          liveUrl: "https://live.example.test?token=secret",
          token: "raw-provider-token",
        },
      }),
    };
    browsersMock.resolveProvider.mockReturnValue("steel");
    browsersMock.create.mockReturnValue(provider);

    const result = await requireTool(registerTools(), "browsers_session").execute(
      "test",
      { provider: "steel" },
      undefined,
      undefined,
      {} as ExtensionContext,
    );

    expect(result.content).toEqual([
      { type: "text", text: "[provider=steel] Session created: session-1" },
    ]);
    expect(result.details).toEqual({
      session: { id: "session-1", provider: "steel", createdAt: 1_000 },
    });
    expect(JSON.stringify(result)).not.toContain(secretUrl);
    expect(JSON.stringify(result)).not.toContain("raw-provider-token");
  });
});
