import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  type BrowserToolName,
  browserToolDescriptions,
  browserToolLabels,
} from "../../../src/tool-contract.ts";
import { browserToolSchemas } from "../../../src/tool-schemas.ts";
import type * as BrowserTools from "../../../dist/tool-operations.d.mts";
import {
  type RenderedToolResult,
  type RenderOptions,
  renderToolCall,
  renderToolResult,
  type StatusTheme,
} from "../../shared/tui.ts";

const sourceModuleUrl = new URL("../../../src/tool-operations.ts", import.meta.url);
const distributionModuleUrl = new URL("../../../dist/tool-operations.mjs", import.meta.url);
let toolOperationsPromise: Promise<typeof BrowserTools> | undefined;

/**
 * Returns shared executors from source in a checkout and from dist in a package.
 *
 * @returns {string} Module URL for the current package layout.
 */
export function resolveBrowsersModuleUrl(): string {
  return existsSync(fileURLToPath(sourceModuleUrl))
    ? sourceModuleUrl.href
    : distributionModuleUrl.href;
}

/**
 * Loads and caches the shared browser tool executors.
 *
 * @returns {Promise<typeof BrowserTools>} Shared browser tool module.
 */
function loadToolOperations(): Promise<typeof BrowserTools> {
  toolOperationsPromise ??= import(resolveBrowsersModuleUrl()) as Promise<typeof BrowserTools>;
  return toolOperationsPromise;
}

function statusRenderers(tool: BrowserToolName) {
  return {
    renderCall(args: unknown, theme: Readonly<StatusTheme>, context: Readonly<RenderOptions>) {
      return new Text(renderToolCall(tool, args, context, theme), 0, 0);
    },
    renderResult(
      result: Readonly<RenderedToolResult>,
      options: Readonly<RenderOptions>,
      theme: Readonly<StatusTheme>,
      context?: Readonly<{ isError?: boolean }>,
    ) {
      return new Text(
        renderToolResult(tool, result, context?.isError === true, options, theme),
        0,
        0,
      );
    },
  };
}

/**
 * Registers browser tools with Pi.
 *
 * @param pi - Pi extension API.
 * @returns {void} Nothing.
 */
export default function browsersExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "browsers_scrape",
    label: browserToolLabels.browsers_scrape,
    description: browserToolDescriptions.browsers_scrape,
    promptSnippet: "Scrape a URL with a cloud browser provider when the page needs JS rendering.",
    promptGuidelines: [
      "Use browsers_scrape when a URL needs a real browser to render (SPA, bot-protected, dynamic).",
      "For simple HTML pages prefer web_read (cheaper, faster).",
      "Do not call browsers_session first. Providers that need a session open one inside this tool.",
      "Pass waitFor to wait for a CSS selector before extraction.",
    ],
    parameters: browserToolSchemas.browsers_scrape,
    ...statusRenderers("browsers_scrape"),
    async execute(
      _toolCallId,
      params,
    ): Promise<AgentToolResult<BrowserTools.BrowserScrapeDetails>> {
      return (await loadToolOperations()).browserScrape(params);
    },
  });

  pi.registerTool({
    name: "browsers_session",
    label: browserToolLabels.browsers_session,
    description: browserToolDescriptions.browsers_session,
    promptSnippet: "Create a cloud browser session. Only browsers_release can use the returned ID.",
    promptGuidelines: [
      "Agent tools cannot navigate, click, type, or evaluate in a session you created.",
      "Use browsers_scrape or browsers_screenshot instead; they open a temporary session when needed.",
      "Pass the returned ID only to browsers_release.",
    ],
    parameters: browserToolSchemas.browsers_session,
    ...statusRenderers("browsers_session"),
    async execute(
      _toolCallId,
      params,
    ): Promise<AgentToolResult<BrowserTools.BrowserSessionDetails>> {
      return (await loadToolOperations()).browserSession(params);
    },
  });

  pi.registerTool({
    name: "browsers_release",
    label: browserToolLabels.browsers_release,
    description: browserToolDescriptions.browsers_release,
    promptSnippet: "Release a cloud browser session.",
    promptGuidelines: [
      "Always release sessions after use to avoid unnecessary billing.",
      "Use the same provider that created the session.",
    ],
    parameters: browserToolSchemas.browsers_release,
    ...statusRenderers("browsers_release"),
    async execute(_toolCallId, params): Promise<AgentToolResult<{ released: boolean }>> {
      return (await loadToolOperations()).releaseBrowserSession(params);
    },
  });

  pi.registerTool({
    name: "browsers_providers",
    label: browserToolLabels.browsers_providers,
    description: browserToolDescriptions.browsers_providers,
    promptSnippet: "List configured browser providers.",
    promptGuidelines: [
      "Use browsers_providers to check which browser providers have API keys configured.",
    ],
    parameters: browserToolSchemas.browsers_providers,
    ...statusRenderers("browsers_providers"),
    async execute(): Promise<AgentToolResult<{ providers: BrowserTools.BrowserProviderStatus[] }>> {
      return (await loadToolOperations()).listBrowserProviders();
    },
  });

  pi.registerTool({
    name: "browsers_screenshot",
    label: browserToolLabels.browsers_screenshot,
    description: browserToolDescriptions.browsers_screenshot,
    promptSnippet: "Take a screenshot of a URL with a cloud browser.",
    promptGuidelines: [
      "Use browsers_screenshot when the user needs a visual capture of a webpage.",
      "Cloudflare, Browserless and Hyperbrowser work statelessly (no session needed).",
      "Other providers open a temporary session inside this tool, capture, and release it.",
    ],
    parameters: browserToolSchemas.browsers_screenshot,
    ...statusRenderers("browsers_screenshot"),
    async execute(
      _toolCallId,
      params,
    ): Promise<AgentToolResult<{ url: string; provider: string; saved: boolean }>> {
      return (await loadToolOperations()).browserScreenshot(params);
    },
  });

  pi.registerTool({
    name: "browsers_extract",
    label: browserToolLabels.browsers_extract,
    description: browserToolDescriptions.browsers_extract,
    promptSnippet: "Extract structured data from a URL with AI.",
    promptGuidelines: [
      "Use browsers_extract when the user needs structured data from a webpage (product info, pricing, articles).",
      "Hyperbrowser waits up to two minutes for its extract job; one still running after that returns its job ID.",
      "Pass a prompt describing what to extract.",
    ],
    parameters: browserToolSchemas.browsers_extract,
    ...statusRenderers("browsers_extract"),
    async execute(
      _toolCallId,
      params,
    ): Promise<AgentToolResult<{ url: string; provider: string; data: unknown }>> {
      return (await loadToolOperations()).browserExtract(params);
    },
  });

  pi.registerTool({
    name: "browsers_crawl",
    label: browserToolLabels.browsers_crawl,
    description: browserToolDescriptions.browsers_crawl,
    promptSnippet: "Crawl a website and extract content from multiple pages.",
    promptGuidelines: [
      "Use browsers_crawl when the user needs content from multiple pages of a website.",
      "Cloudflare and Hyperbrowser wait up to two minutes for the crawl job; one still running after that returns its job ID and no pages.",
      "Pass maxPages to limit the crawl scope and maxChars to bound the returned content.",
    ],
    parameters: browserToolSchemas.browsers_crawl,
    ...statusRenderers("browsers_crawl"),
    async execute(
      _toolCallId,
      params,
    ): Promise<AgentToolResult<{ jobId?: string; pages: number }>> {
      return (await loadToolOperations()).browserCrawl(params);
    },
  });

  pi.registerTool({
    name: "browsers_pdf",
    label: browserToolLabels.browsers_pdf,
    description: browserToolDescriptions.browsers_pdf,
    promptSnippet: "Save a PDF of a URL to a file.",
    promptGuidelines: [
      "Use browsers_pdf when the user needs a PDF of a webpage.",
      "Cloudflare and Browserless work statelessly (no session needed).",
    ],
    parameters: browserToolSchemas.browsers_pdf,
    ...statusRenderers("browsers_pdf"),
    async execute(_toolCallId, params): Promise<AgentToolResult<BrowserTools.BrowserPdfDetails>> {
      return (await loadToolOperations()).browserPdf(params);
    },
  });

  pi.registerTool({
    name: "browsers_links",
    label: browserToolLabels.browsers_links,
    description: browserToolDescriptions.browsers_links,
    promptSnippet: "Extract links from a webpage.",
    promptGuidelines: [
      "Use browsers_links when the user needs all links from a page.",
      "Cloudflare and Playwright support this currently.",
    ],
    parameters: browserToolSchemas.browsers_links,
    ...statusRenderers("browsers_links"),
    async execute(_toolCallId, params): Promise<AgentToolResult<{ url: string; links: string[] }>> {
      return (await loadToolOperations()).browserLinks(params);
    },
  });

  pi.registerTool({
    name: "browsers_search",
    label: browserToolLabels.browsers_search,
    description: browserToolDescriptions.browsers_search,
    promptSnippet: "Search the web via browser provider.",
    promptGuidelines: [
      "Use browsers_search when the user needs web search results.",
      "Hyperbrowser supports native web search.",
    ],
    parameters: browserToolSchemas.browsers_search,
    ...statusRenderers("browsers_search"),
    async execute(
      _toolCallId,
      params,
    ): Promise<
      AgentToolResult<{
        results: Array<{ url: string; title: string; snippet: string }>;
      }>
    > {
      return (await loadToolOperations()).browserSearch(params);
    },
  });

  pi.registerTool({
    name: "browsers_capabilities",
    label: browserToolLabels.browsers_capabilities,
    description: browserToolDescriptions.browsers_capabilities,
    promptSnippet: "Check capabilities of a browser provider before using it.",
    promptGuidelines: [
      "Use browsers_capabilities before browsers_scrape/browsers_screenshot to check if the provider supports the operation.",
      "Some providers support stateless operations (no session needed): cloudflare, browserless and hyperbrowser for both scrape and screenshot.",
      "Navigate and evaluate flags describe the library API. No tool accepts a session ID except browsers_release.",
    ],
    parameters: browserToolSchemas.browsers_capabilities,
    ...statusRenderers("browsers_capabilities"),
    async execute(
      _toolCallId,
      params,
    ): Promise<
      AgentToolResult<{ provider: string; capabilities: BrowserTools.ProviderCapabilities }>
    > {
      return (await loadToolOperations()).browserCapabilities(params);
    },
  });
}
