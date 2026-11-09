import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { BrowserError, InvalidInputError } from "../src/core/errors";
import { CdpSocket, WebMcpPage } from "../src/core/webmcp";
import { launch, type Running, systemChromium } from "./chromium";

/* A page with WebMCP tools: some at parse time, one 1.5s after load, and four that go wrong. */
const TOOLS_PAGE = `<!doctype html><title>Shop</title><script>
const tool = (name, execute, extra = {}) =>
  document.modelContext.registerTool({ name, description: name + " tool", execute, ...extra });
tool("search", async ({ query }) => ({ content: [{ type: "text", text: "results for " + query }] }), {
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  annotations: { readOnlyHint: true, untrustedContentHint: true },
});
tool("plain", async () => "just a string");
tool("boom", async () => { throw new Error("no seats left"); });
tool("refuse", async () => ({ isError: true, content: [{ type: "text", text: "bad query" }] }));
tool("confirm", () => new Promise(() => {}));
addEventListener("load", () => setTimeout(() => tool("late", async () => "late answer"), 1500));
</script>`;

let site: Server;
let base: string;
let scratch: string;
let browser: Running;

/* Opens one page of the test site in a fresh tab of the shared browser. */
async function open(path: string): Promise<{ page: WebMcpPage; socket: CdpSocket }> {
  const socket = await CdpSocket.open(browser.socket);
  const page = await WebMcpPage.open(socket, { url: `${base}${path}`, provider: "chromium" });
  return { page, socket };
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "browsers-webmcp-"));
  site = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(req.url === "/tools" ? TOOLS_PAGE : "<!doctype html><title>Plain</title><p>No tools");
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  /* Stable Chrome hides document.modelContext behind this flag; Browser Run's has it on. */
  browser = await launch(systemChromium() ?? chromium.executablePath(), [
    "--headless=new",
    "--no-sandbox",
    "--no-first-run",
    "--enable-experimental-web-platform-features",
    `--user-data-dir=${join(scratch, "chromium")}`,
    "--remote-debugging-port=0",
    "about:blank",
  ]);
}, 100_000);

afterAll(async () => {
  await browser.stop();
  await new Promise((resolve) => site.close(resolve));
  await rm(scratch, { recursive: true, force: true, maxRetries: 5 });
});

describe("WebMCP over CDP", () => {
  it("lists tools registered after load, with the page's hints and no frame details", async () => {
    const { page, socket } = await open("/tools");
    try {
      const tools = await page.tools();

      expect(tools.map((tool) => tool.name)).toEqual([
        "search",
        "plain",
        "boom",
        "refuse",
        "confirm",
        "late",
      ]);
      expect(tools[0]).toEqual({
        name: "search",
        description: "search tool",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        annotations: { readOnly: true, untrustedContent: true, consequential: false },
      });
    } finally {
      socket.close();
    }
  }, 30_000);

  it("answers with the text parts of an MCP result and the parsed output", async () => {
    const { page, socket } = await open("/tools");
    try {
      const result = await page.call("search", { query: "dns" });

      expect(result).toEqual({
        output: { content: [{ type: "text", text: "results for dns" }] },
        text: "results for dns",
      });
      expect(await page.call("plain", {})).toEqual({
        output: "just a string",
        text: "just a string",
      });
    } finally {
      socket.close();
    }
  }, 30_000);

  it("waits for a tool the page registers after load", async () => {
    const { page, socket } = await open("/tools");
    try {
      expect((await page.call("late", {})).text).toBe("late answer");
    } finally {
      socket.close();
    }
  }, 30_000);

  it("names the reason a tool threw or reported an error", async () => {
    const { page, socket } = await open("/tools");
    try {
      await expect(page.call("boom", {})).rejects.toBeInstanceOf(BrowserError);
      await expect(page.call("boom", {})).rejects.toThrow(
        /Page tool "boom" failed: .*no seats left/,
      );
      await expect(page.call("refuse", {})).rejects.toThrow(
        'Page tool "refuse" reported an error: bad query',
      );
    } finally {
      socket.close();
    }
  }, 30_000);

  it("refuses a tool the page lacks and lists the ones it has", async () => {
    const { page, socket } = await open("/tools");
    try {
      const failure = await page.call("checkout", {}).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(InvalidInputError);
      expect(String(failure)).toContain(
        `${base}/tools has no WebMCP tool "checkout". It has 6: "search", "plain", "boom", "refuse", "confirm", "late".`,
      );
    } finally {
      socket.close();
    }
  }, 30_000);

  it("gives up on a tool that never answers as soon as the socket closes", async () => {
    const { page, socket } = await open("/tools");
    const started = Date.now();
    setTimeout(() => socket.close(), 4_000);

    await expect(page.call("confirm", {})).rejects.toThrow(
      "The browser closed the CDP connection.",
    );
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);

  it("finds no tools on a page that registers none", async () => {
    const { page, socket } = await open("/plain");
    try {
      expect(await page.tools()).toEqual([]);
    } finally {
      socket.close();
    }
  }, 30_000);

  it("fails a command once the browser socket closes", async () => {
    const socket = await CdpSocket.open(browser.socket);
    socket.close();

    await expect(socket.send({ method: "Browser.getVersion" })).rejects.toThrow(BrowserError);
  });
});
