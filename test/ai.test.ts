import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { generateText, isStepCount } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { browsersAiTools } from "../src/ai";
import { register } from "../src/core/registry";
import type { BrowserProvider } from "../src/core/types";
import { createMcpServer } from "../src/mcp";
import { browserTools } from "../src/tools";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const scrape = vi.fn<BrowserProvider["scrape"]>();
const screenshot = vi.fn<BrowserProvider["screenshot"]>();

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

/* A stateless provider that answers scrape and screenshot from the spies above. */
function aiTestProvider(): BrowserProvider {
  return {
    name: () => "aitest",
    capabilities: () => ({
      scrape: true,
      screenshot: true,
      navigate: false,
      evaluate: false,
      sessions: false,
      cdp: false,
      statelessScrape: true,
      statelessScreenshot: true,
      elementScreenshot: false,
      screenshotWaitFor: false,
      crawl: false,
      pdf: false,
      links: false,
      search: false,
      extract: false,
      accessibilityTree: false,
    }),
    createSession: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
    listSessions: vi.fn().mockResolvedValue([]),
    releaseSession: vi.fn(),
    scrape,
    screenshot,
    navigate: vi.fn(),
    evaluate: vi.fn(),
  };
}

/* A model that makes one tool call with the given input, then says it's done. */
function scriptedModel(toolName: string, input: Readonly<Record<string, unknown>>) {
  return new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          { type: "tool-call", toolCallId: "call-0", toolName, input: JSON.stringify(input) },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "done" }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });
}

/* Runs one scripted call and hands back the tool's part and what the model read next. */
async function callThroughModel(toolName: string, input: Readonly<Record<string, unknown>>) {
  const model = scriptedModel(toolName, input);
  const result = await generateText({
    model,
    tools: browsersAiTools,
    stopWhen: isStepCount(2),
    prompt: "read https://example.test",
  });
  const toolMessage = model.doGenerateCalls[1]?.prompt.find((message) => message.role === "tool");
  return { part: result.steps[0]?.content[1], modelSaw: toolMessage?.content[0] };
}

/* The text `browsers mcp` answers the same call with. */
async function mcpText(name: string, args: Readonly<Record<string, unknown>>): Promise<string> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "browsers-ai-test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name, arguments: { ...args } });
    const [block] = result.content as ReadonlyArray<{ type: string; text?: string }>;
    return block?.text ?? "";
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

beforeAll(() => {
  register("aitest", "https://example.test", () => aiTestProvider());
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("@agntn/browsers/ai", () => {
  it("offers every tool MCP, Pi and OMP list, under the same name and in the same order", () => {
    expect(Object.keys(browsersAiTools)).toEqual(browserTools.map((tool) => tool.name));
  });

  it("gives the model the text an MCP client reads, and the app the details beside it", async () => {
    vi.stubEnv("AITEST_API_KEY", "test");
    scrape.mockResolvedValue({ url: "https://example.test", text: "Example Domain" });
    const input = { provider: "aitest", url: "https://example.test" };

    const { part, modelSaw } = await callThroughModel("browsers_scrape", input);
    const text = await mcpText("browsers_scrape", input);

    expect(text).toBe("[provider=aitest] https://example.test\n\nExample Domain");
    expect(part).toMatchObject({
      type: "tool-result",
      toolName: "browsers_scrape",
      output: {
        url: "https://example.test",
        provider: "aitest",
        contentLength: 14,
        text,
      },
    });
    expect(modelSaw).toMatchObject({ type: "tool-result", output: { type: "text", value: text } });
  });

  it("hands the screenshot to the model as an image, not as base64 in the text", async () => {
    vi.stubEnv("AITEST_API_KEY", "test");
    screenshot.mockResolvedValue({ data: PNG_BYTES.toString("base64"), mimeType: "image/png" });

    const { part, modelSaw } = await callThroughModel("browsers_screenshot", {
      provider: "aitest",
      url: "https://example.test",
    });

    expect(part).toMatchObject({
      type: "tool-result",
      output: {
        saved: false,
        bytes: 12,
        images: [{ data: PNG_BYTES.toString("base64"), mimeType: "image/png" }],
      },
    });
    expect(modelSaw).toMatchObject({
      type: "tool-result",
      output: {
        type: "content",
        value: [
          {
            type: "text",
            text: "[provider=aitest] Stateless screenshot of https://example.test: image/png, 12 bytes.",
          },
          {
            type: "file",
            data: { type: "data", data: PNG_BYTES.toString("base64") },
            mediaType: "image/png",
          },
        ],
      },
    });
  });

  it("turns arguments outside the schema into a tool error before any provider runs", async () => {
    const { part } = await callThroughModel("browsers_scrape", {
      provider: "aitest",
      url: "https://example.test",
      maxChars: 200_001,
    });

    expect(part).toMatchObject({ type: "tool-error", toolName: "browsers_scrape" });
    expect(String((part as { error?: unknown }).error)).toContain("maxChars");
    expect(scrape).not.toHaveBeenCalled();
  });

  it("reports a provider failure as a tool error the model can read", async () => {
    vi.stubEnv("AITEST_API_KEY", "test");
    scrape.mockRejectedValue(new Error("upstream said no"));

    const { part } = await callThroughModel("browsers_scrape", {
      provider: "aitest",
      url: "https://example.test",
    });

    expect(part).toMatchObject({ type: "tool-error", toolName: "browsers_scrape" });
    expect(String((part as { error?: unknown }).error)).toContain("upstream said no");
  });
});
