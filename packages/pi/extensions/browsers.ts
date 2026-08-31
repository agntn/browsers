import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type * as BrowsersPackage from "@agntn/browsers";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const builtinProviders = [
  "steel",
  "browserbase",
  "kernel",
  "browserless",
  "hyperbrowser",
  "anchor",
  "cloudflare",
  "playwright",
] as const;
const sourceModuleUrl = new URL("../../../src/index.ts", import.meta.url);
const distributionModuleUrl = new URL("../../../dist/index.mjs", import.meta.url);
let browsersModulePromise: Promise<typeof BrowsersPackage> | undefined;
const DEFAULT_SCRAPE_MAX_CHARS = 20_000;
const MAX_SCRAPE_MAX_CHARS = 200_000;

/**
 * Return live source in a checkout, otherwise the built distribution module.
 *
 * @returns {string} Module URL for the current package layout.
 */
export function resolveBrowsersModuleUrl(): string {
  return existsSync(fileURLToPath(sourceModuleUrl))
    ? sourceModuleUrl.href
    : distributionModuleUrl.href;
}

/**
 * Load and cache the browser library for the current package layout.
 *
 * @returns {Promise<typeof BrowsersPackage>} Browser library module.
 */
function loadBrowsers(): Promise<typeof BrowsersPackage> {
  browsersModulePromise ??= import(resolveBrowsersModuleUrl()) as Promise<typeof BrowsersPackage>;
  return browsersModulePromise;
}

/**
 * Resolve and validate the scrape output limit.
 *
 * @param {number} [value] Requested character limit.
 * @returns {number} Effective character limit.
 */
function resolveScrapeMaxChars(value?: number): number {
  const maxChars = value ?? DEFAULT_SCRAPE_MAX_CHARS;
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > MAX_SCRAPE_MAX_CHARS) {
    throw new RangeError(`maxChars must be an integer between 1 and ${MAX_SCRAPE_MAX_CHARS}.`);
  }
  return maxChars;
}

/**
 * Resolve and create a provider instance.
 *
 * @param {string} [preferred] Preferred provider name.
 * @returns {Promise<{ name: string; provider: BrowsersPackage.BrowserProvider }>} Resolved provider.
 */
async function getProvider(preferred?: string) {
  const browsers = await loadBrowsers();
  const name = browsers.resolveProvider(preferred);
  return { name, provider: browsers.create(name) };
}

// ─── Tools ───────────────────────────────────────────────────────────────

/**
 * Register browser tools with Pi.
 *
 * @param {ExtensionAPI} pi Pi extension API.
 * @returns {void}
 */
export default function browsersExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "browsers_scrape",
    label: "Browser Scrape",
    description:
      "Read-only/open-world network fetch: scrape content from a URL using a cloud browser provider. Returns rendered HTML/markdown/text after JavaScript execution. Use when a URL needs a real browser to render (JS-heavy SPAs, sites with bot protection, dynamic content). Capabilities per provider: steel (stateless scrape, CDP navigate/evaluate), browserbase (stateless scrape, CDP only), kernel (session-based Playwright), browserless (stateless scrape+screenshot, CDP), hyperbrowser (stateless scrape, CDP only), anchor (stateless scrape, CDP only), cloudflare (stateless scrape+screenshot, CDP).",
    promptSnippet: "Scrape a URL with a cloud browser provider when the page needs JS rendering.",
    promptGuidelines: [
      "Use browsers_scrape when a URL needs a real browser to render (SPA, bot-protected, dynamic).",
      "For simple HTML pages prefer web_read (cheaper, faster).",
      "Steel and Cloudflare have stateless scrape (no session needed). Kernel requires a session.",
      "Pass waitFor to wait for a CSS selector before extraction.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to scrape" }),
      provider: Type.Optional(
        Type.String({
          description: `Provider name. One of: ${builtinProviders.join(", ")}. Auto-detected from env.`,
        }),
      ),
      waitFor: Type.Optional(
        Type.String({ description: "CSS selector to wait for before extraction" }),
      ),
      maxChars: Type.Optional(
        Type.Integer({
          description: `Maximum page content characters to return. Defaults to ${DEFAULT_SCRAPE_MAX_CHARS}; accepted range: 1-${MAX_SCRAPE_MAX_CHARS}.`,
          minimum: 1,
          maximum: MAX_SCRAPE_MAX_CHARS,
        }),
      ),
    }),
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
    ): Promise<AgentToolResult<{ url: string; provider: string; contentLength: number }>> {
      const { name, provider } = await getProvider(params.provider);
      const maxChars = resolveScrapeMaxChars(params.maxChars);
      const result = await provider.scrape(params.url, {
        waitFor: params.waitFor,
        maxChars,
      });
      const rawContent = result.text || result.markdown || result.html || "No content extracted";
      const content = rawContent.slice(0, maxChars);
      const truncation =
        rawContent.length > maxChars
          ? `\n\n[truncated ${rawContent.length - maxChars} of ${rawContent.length} characters]`
          : "";
      return {
        content: [
          { type: "text", text: `[provider=${name}] ${params.url}\n\n${content}${truncation}` },
        ],
        details: { url: params.url, provider: name, contentLength: rawContent.length },
      };
    },
  });

  pi.registerTool({
    name: "browsers_session",
    label: "Browser Session",
    description:
      "Create a new cloud browser session. Returns an opaque session ID for later operations.",
    promptSnippet: "Create a cloud browser session for full browser automation.",
    promptGuidelines: [
      "Use browsers_session when you need full browser control (navigate, click, type, evaluate JS).",
      "For simple scrape/screenshot, use browsers_scrape instead (no session needed).",
      "Always release sessions when done with browsers_release.",
    ],
    parameters: Type.Object({
      provider: Type.Optional(
        Type.String({ description: "Provider name (auto-detected from env)" }),
      ),
      region: Type.Optional(
        Type.String({ description: "Preferred region (e.g. us-east-1, eu-west-1)" }),
      ),
    }),
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
    ): Promise<AgentToolResult<{ session: { id: string; provider: string; createdAt: number } }>> {
      const { name, provider } = await getProvider(params.provider);
      const session = await provider.createSession({ region: params.region });
      return {
        content: [{ type: "text", text: `[provider=${name}] Session created: ${session.id}` }],
        details: {
          session: { id: session.id, provider: session.provider, createdAt: session.createdAt },
        },
      };
    },
  });

  pi.registerTool({
    name: "browsers_release",
    label: "Browser Release",
    description:
      "Release/destroy a cloud browser session. Always release sessions when done to avoid billing.",
    promptSnippet: "Release a cloud browser session.",
    promptGuidelines: [
      "Always release sessions after use to avoid unnecessary billing.",
      "Use the same provider that created the session.",
    ],
    parameters: Type.Object({
      sessionId: Type.String({ description: "Session ID to release" }),
      provider: Type.Optional(
        Type.String({ description: "Provider name (auto-detected from env)" }),
      ),
    }),
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("browsers_release"))} ${theme.fg("dim", args.sessionId)}`,
        0,
        0,
      );
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<{ released: boolean }>> {
      const { name, provider } = await getProvider(params.provider);
      await provider.releaseSession(params.sessionId);
      return {
        content: [
          { type: "text", text: `[provider=${name}] Session ${params.sessionId} released.` },
        ],
        details: { released: true },
      };
    },
  });

  pi.registerTool({
    name: "browsers_providers",
    label: "Browser Providers",
    description:
      "Read-only/idempotent local/env status: list browser-as-a-service providers and which ones are currently configured via environment variables.",
    promptSnippet: "List configured browser providers.",
    promptGuidelines: [
      "Use browsers_providers to check which browser providers have API keys configured.",
    ],
    parameters: Type.Object({}),
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("browsers_providers")), 0, 0);
    },
    async execute(): Promise<
      AgentToolResult<{
        providers: { name: string; configured: boolean; capabilities: Record<string, unknown> }[];
      }>
    > {
      const browsers = await loadBrowsers();
      const rows = builtinProviders.map((name) => {
        let configured = false;
        let capabilities: Record<string, boolean> = {};
        try {
          const provider = browsers.create(name);
          configured = true;
          capabilities = { ...provider.capabilities() };
        } catch {
          // Not configured (missing API key) — still report name
        }
        return { name, configured, capabilities };
      });

      const lines = rows.map((r) => {
        const c = r.capabilities;
        const tags = Object.entries(c)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(" ");
        return `${r.configured ? "●" : "○"} ${r.name}  ${tags}`;
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { providers: rows },
      };
    },
  });

  pi.registerTool({
    name: "browsers_screenshot",
    label: "Browser Screenshot",
    description:
      "Take a screenshot of a URL using a cloud browser provider. Stateless mode (no session needed): cloudflare, browserless. Session-based: steel, browserbase, kernel, hyperbrowser, anchor. For providers without navigate support (browserbase, hyperbrowser, anchor, cloudflare), the screenshot captures the URL directly.",
    promptSnippet: "Take a screenshot of a URL with a cloud browser.",
    promptGuidelines: [
      "Use browsers_screenshot when the user needs a visual capture of a webpage.",
      "Cloudflare and Browserless work statelessly (no session needed).",
      "Other providers create a temporary session, navigate, screenshot, and release.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to screenshot" }),
      provider: Type.Optional(
        Type.String({
          description: `Provider name. One of: ${builtinProviders.join(", ")}. Auto-detected from env.`,
        }),
      ),
      format: Type.Optional(
        Type.String({ description: "Image format: png, jpeg, webp. Default: png." }),
      ),
      fullPage: Type.Optional(Type.Boolean({ description: "Capture full page. Default: true." })),
    }),
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
      const { name, provider } = await getProvider(params.provider);
      const caps = { ...provider.capabilities() };

      if (caps.statelessScreenshot) {
        // Stateless: no session needed
        const result = await provider.screenshot({
          url: params.url,
          fullPage: params.fullPage,
          format: params.format as "png" | "jpeg" | "webp",
        });
        return {
          content: [
            {
              type: "text",
              text: `[provider=${name}] Stateless screenshot of ${params.url}. Data length: ${result.data.length} chars.`,
            },
          ],
          details: { url: params.url, provider: name, saved: false },
        };
      }

      // Session-based: create, navigate, screenshot, release
      const session = await provider.createSession();
      try {
        if (caps.navigate) {
          await provider.navigate(params.url, session).catch(() => {});
        }
        const result = await provider.screenshot(
          {
            url: params.url,
            fullPage: params.fullPage,
            format: params.format as "png" | "jpeg" | "webp",
          },
          session,
        );
        return {
          content: [
            {
              type: "text",
              text: `[provider=${name}] Screenshot of ${params.url}. Data length: ${result.data.length} chars.`,
            },
          ],
          details: { url: params.url, provider: name, saved: false },
        };
      } finally {
        await provider.releaseSession(session.id).catch(() => {});
      }
    },
  });

  pi.registerTool({
    name: "browsers_extract",
    label: "Browser Extract",
    description:
      "Extract structured data from a URL using AI. Cloudflare returns synchronous results. Hyperbrowser returns an async job ID.",
    promptSnippet: "Extract structured data from a URL with AI.",
    promptGuidelines: [
      "Use browsers_extract when the user needs structured data from a webpage (product info, pricing, articles).",
      "Cloudflare returns results synchronously. Hyperbrowser returns a jobId for async processing.",
      "Pass a prompt describing what to extract.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to extract data from" }),
      provider: Type.Optional(
        Type.String({ description: `Provider. One of: cloudflare, hyperbrowser.` }),
      ),
      prompt: Type.String({
        description: "What to extract (e.g. 'Extract product name, price, and description')",
      }),
    }),
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
      const { name, provider } = await getProvider(params.provider);
      if (!provider.extract) throw new Error(`Provider ${name} does not support extract.`);
      const result = await provider.extract(params.url, { prompt: params.prompt });
      return {
        content: [
          {
            type: "text",
            text: `[provider=${name}] ${params.url}\n\n${JSON.stringify(result.data, null, 2)}`,
          },
        ],
        details: { url: params.url, provider: name, data: result.data },
      };
    },
  });

  pi.registerTool({
    name: "browsers_crawl",
    label: "Browser Crawl",
    description:
      "Crawl a website following links. Cloudflare and Hyperbrowser support async crawl jobs. Returns pages with markdown/HTML content.",
    promptSnippet: "Crawl a website and extract content from multiple pages.",
    promptGuidelines: [
      "Use browsers_crawl when the user needs content from multiple pages of a website.",
      "Both cloudflare and hyperbrowser return async job IDs. Results may need polling.",
      "Pass maxPages to limit the crawl scope.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "Starting URL" }),
      provider: Type.Optional(
        Type.String({ description: `Provider. One of: cloudflare, hyperbrowser, playwright.` }),
      ),
      maxPages: Type.Optional(Type.Number({ description: "Max pages to crawl. Default: 10." })),
    }),
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
      const { name, provider } = await getProvider(params.provider);
      if (!provider.crawl) throw new Error(`Provider ${name} does not support crawl.`);
      const result = await provider.crawl(params.url, { maxPages: params.maxPages ?? 10 });
      const lines = [`[provider=${name}] Crawled ${result.pages.length} pages.`];
      if (result.jobId) lines.push(`Job ID: ${result.jobId} (status: ${result.status})`);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { jobId: result.jobId, pages: result.pages.length },
      };
    },
  });

  pi.registerTool({
    name: "browsers_pdf",
    label: "Browser PDF",
    description:
      "Generate a PDF from a URL. Cloudflare and Browserless support stateless PDF generation.",
    promptSnippet: "Generate a PDF from a URL.",
    promptGuidelines: [
      "Use browsers_pdf when the user needs a PDF of a webpage.",
      "Cloudflare and Browserless work statelessly (no session needed).",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to convert to PDF" }),
      provider: Type.Optional(
        Type.String({ description: `Provider. One of: cloudflare, browserless, playwright.` }),
      ),
    }),
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
      const { name, provider } = await getProvider(params.provider);
      if (!provider.pdf) throw new Error(`Provider ${name} does not support PDF generation.`);
      const result = await provider.pdf(params.url);
      return {
        content: [
          { type: "text", text: `[provider=${name}] PDF generated: ${result.data.length} chars.` },
        ],
        details: { url: params.url, provider: name, pdfLength: result.data.length },
      };
    },
  });

  pi.registerTool({
    name: "browsers_links",
    label: "Browser Links",
    description:
      "Extract all links from a webpage. Cloudflare and Playwright support stateless link extraction.",
    promptSnippet: "Extract links from a webpage.",
    promptGuidelines: [
      "Use browsers_links when the user needs all links from a page.",
      "Cloudflare and Playwright support this currently.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to extract links from" }),
      provider: Type.Optional(
        Type.String({ description: `Provider. One of: ${builtinProviders.join(", ")}.` }),
      ),
    }),
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("browsers_links"))} ${theme.fg("dim", args.url)}`,
        0,
        0,
      );
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<{ url: string; links: string[] }>> {
      const { name, provider } = await getProvider(params.provider);
      if (!provider.links) throw new Error(`Provider ${name} does not support link extraction.`);
      const result = await provider.links(params.url);
      const links = result.links.map((l) => l.href);
      return {
        content: [
          { type: "text", text: `[provider=${name}] ${links.length} links:\n${links.join("\n")}` },
        ],
        details: { url: params.url, links },
      };
    },
  });

  pi.registerTool({
    name: "browsers_search",
    label: "Browser Search",
    description: "Web search via browser provider. Hyperbrowser supports native web search.",
    promptSnippet: "Search the web via browser provider.",
    promptGuidelines: [
      "Use browsers_search when the user needs web search results.",
      "Hyperbrowser supports native web search.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),
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
      AgentToolResult<{ results: Array<{ url: string; title: string; snippet: string }> }>
    > {
      const { name, provider } = await getProvider("hyperbrowser");
      if (!provider.search) throw new Error(`Provider ${name} does not support web search.`);
      const results = await provider.search(params.query);
      const lines = results.map((r) => `${r.title}\n  ${r.url}\n  ${r.snippet}`);
      return {
        content: [
          {
            type: "text",
            text: `[provider=${name}] ${results.length} results:\n\n${lines.join("\n\n")}`,
          },
        ],
        details: { results },
      };
    },
  });

  pi.registerTool({
    name: "browsers_capabilities",
    label: "Browser Capabilities",
    description:
      "Read-only: check what operations a specific browser provider supports (scrape, screenshot, navigate, evaluate, sessions, CDP, stateless modes).",
    promptSnippet: "Check capabilities of a browser provider before using it.",
    promptGuidelines: [
      "Use browsers_capabilities before browsers_scrape/browsers_screenshot to check if the provider supports the operation.",
      "Some providers support stateless operations (no session needed): cloudflare, browserless for both scrape and screenshot.",
      "Some providers only support CDP (no REST navigate/evaluate): browserbase, hyperbrowser, anchor.",
    ],
    parameters: Type.Object({
      provider: Type.String({ description: "Provider name to check" }),
    }),
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
    ): Promise<AgentToolResult<{ provider: string; capabilities: Record<string, unknown> }>> {
      const { name, provider } = await getProvider(params.provider);
      const caps = { ...provider.capabilities() };
      const lines = Object.entries(caps).map(([k, v]) => `  ${k}: ${v ? "✓" : "✗"}`);
      return {
        content: [{ type: "text", text: `[${name}]\n${lines.join("\n")}` }],
        details: { provider: name, capabilities: caps },
      };
    },
  });
}
