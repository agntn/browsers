import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { browserToolDescriptions, browserToolLabels } from "../../../src/tool-contract.ts";
import { browserToolSchemas } from "../../../src/tool-schemas.ts";
import type * as BrowserTools from "../../../dist/tool-operations.d.mts";

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
      "Steel and Cloudflare have stateless scrape (no session needed). Kernel requires a session.",
      "Pass waitFor to wait for a CSS selector before extraction.",
    ],
    parameters: browserToolSchemas.browsers_scrape,
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("browsers_scrape"))} ${theme.fg("dim", args.url)} ${theme.fg("muted", `provider=${args.provider ?? "auto"}`)}`,
        0,
        0,
      );
    },
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
    promptSnippet: "Create a cloud browser session for full browser automation.",
    promptGuidelines: [
      "Use browsers_session when you need full browser control (navigate, click, type, evaluate JS).",
      "For simple scrape/screenshot, use browsers_scrape instead (no session needed).",
      "Always release sessions when done with browsers_release.",
    ],
    parameters: browserToolSchemas.browsers_session,
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("browsers_session"))} ${theme.fg("muted", `provider=${args.provider ?? "auto"} region=${args.region ?? "default"}`)}`,
        0,
        0,
      );
    },
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
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("browsers_release"))} ${theme.fg("dim", args.sessionId)}`,
        0,
        0,
      );
    },
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
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("browsers_providers")), 0, 0);
    },
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
      "Cloudflare and Browserless work statelessly (no session needed).",
      "Other providers create a temporary session, navigate, screenshot, and release.",
    ],
    parameters: browserToolSchemas.browsers_screenshot,
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("browsers_screenshot"))} ${theme.fg("dim", args.url)} ${theme.fg("muted", `provider=${args.provider ?? "auto"}`)}`,
        0,
        0,
      );
    },
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
      "Cloudflare returns results synchronously. Hyperbrowser returns a jobId for async processing.",
      "Pass a prompt describing what to extract.",
    ],
    parameters: browserToolSchemas.browsers_extract,
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("browsers_extract"))} ${theme.fg("dim", args.url)} ${theme.fg("muted", `provider=${args.provider ?? "auto"}`)}`,
        0,
        0,
      );
    },
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
      "Both cloudflare and hyperbrowser return async job IDs. Results may need polling.",
      "Pass maxPages to limit the crawl scope.",
    ],
    parameters: browserToolSchemas.browsers_crawl,
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("browsers_crawl"))} ${theme.fg("dim", args.url)}`,
        0,
        0,
      );
    },
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
    promptSnippet: "Generate a PDF from a URL.",
    promptGuidelines: [
      "Use browsers_pdf when the user needs a PDF of a webpage.",
      "Cloudflare and Browserless work statelessly (no session needed).",
    ],
    parameters: browserToolSchemas.browsers_pdf,
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("browsers_pdf"))} ${theme.fg("dim", args.url)}`,
        0,
        0,
      );
    },
    async execute(
      _toolCallId,
      params,
    ): Promise<AgentToolResult<{ url: string; provider: string; pdfLength: number }>> {
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
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("browsers_links"))} ${theme.fg("dim", args.url)}`,
        0,
        0,
      );
    },
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
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("browsers_search"))} ${theme.fg("dim", args.query)}`,
        0,
        0,
      );
    },
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
      "Some providers support stateless operations (no session needed): cloudflare, browserless for both scrape and screenshot.",
      "Some providers only support CDP (no REST navigate/evaluate): browserbase, hyperbrowser, anchor.",
    ],
    parameters: browserToolSchemas.browsers_capabilities,
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("browsers_capabilities"))} ${theme.fg("dim", args.provider)}`,
        0,
        0,
      );
    },
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
