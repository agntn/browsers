/** Built-in browser provider keys in registry order. */
export const browserProviderNames = [
  "steel",
  "browserbase",
  "kernel",
  "browserless",
  "hyperbrowser",
  "anchor",
  "cloudflare",
  "playwright",
] as const;

/** Browser tool names shared by every agent surface. */
export const browserToolNames = [
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
] as const;

export type BrowserToolName = (typeof browserToolNames)[number];

/** Default browser scrape output ceiling exposed by agent tools. */
export const DEFAULT_SCRAPE_MAX_CHARS = 20_000;

/** Largest browser scrape output ceiling accepted by agent tools. */
export const MAX_SCRAPE_MAX_CHARS = 200_000;

/** Human-facing labels for each browser tool. */
export const browserToolLabels: Readonly<Record<BrowserToolName, string>> = {
  browsers_scrape: "Browser Scrape",
  browsers_session: "Browser Session",
  browsers_release: "Browser Release",
  browsers_providers: "Browser Providers",
  browsers_screenshot: "Browser Screenshot",
  browsers_extract: "Browser Extract",
  browsers_crawl: "Browser Crawl",
  browsers_pdf: "Browser PDF",
  browsers_links: "Browser Links",
  browsers_search: "Browser Search",
  browsers_capabilities: "Browser Capabilities",
};

/** Model-facing descriptions shared by Pi, OMP, and MCP. */
export const browserToolDescriptions: Readonly<Record<BrowserToolName, string>> = {
  browsers_scrape:
    "Read-only/open-world network fetch: scrape content from a URL using a cloud browser provider. Returns rendered HTML/markdown/text after JavaScript execution. Use when a URL needs a real browser to render (JS-heavy SPAs, sites with bot protection, dynamic content). This tool does not accept a session ID. Providers that need a session open and release one internally.",
  browsers_session:
    "Create a cloud browser session. Returns an opaque session ID. Only browsers_release accepts this ID; no other tool can drive the session.",
  browsers_release:
    "Release/destroy a cloud browser session. Always release sessions when done to avoid billing.",
  browsers_providers:
    "Read-only/idempotent local/env status: list browser-as-a-service providers and which ones are currently configured via environment variables.",
  browsers_screenshot:
    "Take a screenshot of a URL using a cloud browser provider. Cloudflare and Browserless capture without passing a session. Other providers open a temporary session inside this tool. This tool does not accept a session ID.",
  browsers_extract:
    "Extract structured data from a URL using AI. Cloudflare returns synchronous results. Hyperbrowser returns an async job ID.",
  browsers_crawl:
    "Crawl a website following links. Cloudflare and Hyperbrowser support async crawl jobs. Returns pages with markdown/HTML content.",
  browsers_pdf:
    "Generate a PDF from a URL. Cloudflare and Browserless support stateless PDF generation.",
  browsers_links:
    "Extract all links from a webpage. Cloudflare and Playwright support stateless link extraction.",
  browsers_search: "Web search via browser provider. Hyperbrowser supports native web search.",
  browsers_capabilities:
    "Read-only: report which library operations a browser provider supports, including scrape, screenshot, navigate, evaluate, sessions, CDP, and stateless modes. Navigate and evaluate flags describe the provider API, not extra tools.",
};
