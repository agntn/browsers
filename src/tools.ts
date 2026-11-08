/**
 * The browser tools, declared once for MCP, Pi, OMP, the AI SDK and the CLI. Executors load on
 * the first call. `Type` comes from `@agntn/tools`, never a bare `typebox`: OMP rewrites that
 * import to its own facade, and validation then accepts any value.
 */

import {
  defineTool,
  type TInteger,
  type TOptional,
  type TString,
  type ToolDefinition,
  Type,
} from "@agntn/tools";
import {
  browserProviderNames,
  browserToolDescriptions,
  browserToolLabels,
  DEFAULT_LINKS_LIMIT,
  DEFAULT_SCRAPE_MAX_CHARS,
  MAX_LINKS_LIMIT,
  MAX_SCRAPE_MAX_CHARS,
  MAX_SEARCH_RESULTS,
} from "./tool-contract.ts";

type ToolOperations = typeof import("./tool-operations.ts");

let operations: Promise<ToolOperations> | undefined;

/**
 * Loads the executors once. A failed load isn't cached, so a broken `dist` doesn't stick.
 *
 * @returns {Promise<ToolOperations>} The executors.
 */
export function loadOperations(): Promise<ToolOperations> {
  operations ??= import("./tool-operations.ts").catch((error: unknown) => {
    operations = undefined;
    throw error;
  });
  return operations;
}

/**
 * The `provider` argument of a tool that only some providers implement.
 *
 * @param names - Providers that implement the tool.
 * @returns {TOptional<TString>} The optional schema.
 */
function providerOf(...names: readonly string[]): TOptional<TString> {
  return Type.Optional(Type.String({ description: `Provider. One of: ${names.join(", ")}.` }));
}

const provider = Type.Optional(
  Type.String({
    description: `Provider name. One of: ${browserProviderNames.join(", ")}. Auto-detected from env.`,
  }),
);

const browser = Type.Optional(
  Type.Literal("kitesurf", {
    description: "Use Cloudflare's Kitesurf engine instead of the default Chromium browser.",
  }),
);

/** Every tool with a `provider` argument takes `-p` for it on the command line. */
const shortProvider = { provider: "p" } as const;

/**
 * The output ceiling of a tool that returns page text.
 *
 * @param what - What the characters are counted in, ending the first sentence.
 * @returns {TOptional<TInteger>} The optional schema.
 */
const maxChars = (what: string): TOptional<TInteger> =>
  Type.Optional(
    Type.Integer({
      description: `Maximum ${what}. Defaults to ${DEFAULT_SCRAPE_MAX_CHARS}; accepted range: 1-${MAX_SCRAPE_MAX_CHARS}.`,
      minimum: 1,
      maximum: MAX_SCRAPE_MAX_CHARS,
    }),
  );

export const scrapeTool = defineTool({
  name: "browsers_scrape",
  title: browserToolLabels.browsers_scrape,
  description: browserToolDescriptions.browsers_scrape,
  snippet: "Scrape a URL with a cloud browser provider when the page needs JS rendering.",
  guidelines: [
    "Use browsers_scrape when a URL needs a real browser to render (SPA, bot-protected, dynamic).",
    "For simple HTML pages prefer web_read (cheaper, faster).",
    "Do not call browsers_session first. Providers that need a session open one inside this tool.",
    "Pass waitFor to wait for a CSS selector before extraction.",
  ],
  effect: "read",
  idempotent: false,
  openWorld: true,
  input: Type.Object(
    {
      url: Type.String({ description: "URL to scrape" }),
      provider,
      browser,
      waitFor: Type.Optional(
        Type.String({
          minLength: 1,
          description:
            "CSS selector to wait for before reading the page, for content that renders after load. Kernel, Browserless, Cloudflare, Playwright and Lightpanda only.",
        }),
      ),
      maxChars: maxChars("page content characters to return"),
    },
    { additionalProperties: false },
  ),
  cli: {
    description: "Scrape content from a URL using a browser provider.",
    positional: ["url"],
    short: shortProvider,
  },
  execute: async (input, { signal }) => (await loadOperations()).browserScrape(input, { signal }),
});

export const sessionTool = defineTool({
  name: "browsers_session",
  title: browserToolLabels.browsers_session,
  description: browserToolDescriptions.browsers_session,
  snippet: "Create a cloud browser session. Only browsers_release can use the returned ID.",
  guidelines: [
    "Agent tools cannot navigate, click, type, or evaluate in a session you created.",
    "Use browsers_scrape or browsers_screenshot instead; they open a temporary session when needed.",
    "Pass the returned ID only to browsers_release.",
  ],
  effect: "write",
  openWorld: true,
  input: Type.Object(
    {
      provider,
      browser,
      region: Type.Optional(
        Type.String({ description: "Preferred region (e.g. us-east-1, eu-west-1)" }),
      ),
    },
    { additionalProperties: false },
  ),
  cli: {
    description: "Create a cloud browser session.",
    short: { ...shortProvider, region: "r" },
  },
  execute: async (input) => (await loadOperations()).browserSession(input),
});

export const releaseTool = defineTool({
  name: "browsers_release",
  title: browserToolLabels.browsers_release,
  description: browserToolDescriptions.browsers_release,
  snippet: "Release a cloud browser session.",
  guidelines: [
    "Always release sessions after use to avoid unnecessary billing.",
    "Use the same provider that created the session.",
  ],
  effect: "destructive",
  openWorld: true,
  input: Type.Object(
    {
      sessionId: Type.String({ description: "Session ID to release" }),
      provider,
      browser,
    },
    { additionalProperties: false },
  ),
  cli: {
    description: "Release a cloud browser session.",
    positional: ["sessionId"],
    plain: ["sessionId"],
    short: shortProvider,
  },
  execute: async (input) => (await loadOperations()).releaseBrowserSession(input),
});

export const providersTool = defineTool({
  name: "browsers_providers",
  title: browserToolLabels.browsers_providers,
  description: browserToolDescriptions.browsers_providers,
  snippet: "List configured browser providers.",
  guidelines: ["Use browsers_providers to check which browser providers have API keys configured."],
  effect: "read",
  openWorld: false,
  input: Type.Object({}, { additionalProperties: false }),
  cli: { description: "List browser providers and which ones are configured." },
  execute: async () => (await loadOperations()).listBrowserProviders(),
});

export const screenshotTool = defineTool({
  name: "browsers_screenshot",
  title: browserToolLabels.browsers_screenshot,
  description: browserToolDescriptions.browsers_screenshot,
  snippet: "Take a screenshot of a URL with a cloud browser.",
  guidelines: [
    "Use browsers_screenshot when the user needs a visual capture of a webpage.",
    "Cloudflare, Browserless and Hyperbrowser work statelessly (no session needed).",
    "Other providers open a temporary session inside this tool, capture, and release it.",
    "Pass waitFor with a CSS selector when the page builds its state after load, so the shot doesn't catch it halfway.",
  ],
  /** Writes a new file to `path`, when one is given, and never overwrites one. */
  effect: "write",
  openWorld: true,
  input: Type.Object(
    {
      url: Type.String({ description: "URL to screenshot" }),
      provider,
      browser,
      format: Type.Optional(
        Type.String({ description: "Image format: png, jpeg, webp. Default: png." }),
      ),
      fullPage: Type.Optional(Type.Boolean({ description: "Capture full page. Default: true." })),
      selector: Type.Optional(
        Type.String({
          minLength: 1,
          description:
            "CSS selector of the element to capture instead of the page; the first match wins. Cloudflare, Browserless and Playwright only.",
        }),
      ),
      waitFor: Type.Optional(
        Type.String({
          minLength: 1,
          description:
            "CSS selector to wait for before the shot, for pages that render their state after load. Cloudflare, Browserless and Playwright only.",
        }),
      ),
      path: Type.Optional(
        Type.String({
          description:
            "File to write the image to instead of returning it. A relative path resolves against the working directory of the process running the tool. The file must not exist yet.",
        }),
      ),
    },
    { additionalProperties: false },
  ),
  cli: {
    description: "Take a screenshot of a URL using a browser provider.",
    positional: ["url"],
    short: { ...shortProvider, path: "o", format: "f", selector: "s" },
  },
  execute: async (input) => (await loadOperations()).browserScreenshot(input),
});

export const extractTool = defineTool({
  name: "browsers_extract",
  title: browserToolLabels.browsers_extract,
  description: browserToolDescriptions.browsers_extract,
  snippet: "Extract structured data from a URL with AI.",
  guidelines: [
    "Use browsers_extract when the user needs structured data from a webpage (product info, pricing, articles).",
    "Hyperbrowser waits up to two minutes for its extract job; one still running after that returns its job ID.",
    "Pass a prompt describing what to extract.",
  ],
  effect: "read",
  idempotent: false,
  openWorld: true,
  input: Type.Object(
    {
      url: Type.String({ description: "URL to extract data from" }),
      provider: providerOf("cloudflare", "hyperbrowser"),
      browser,
      prompt: Type.String({
        description: "What to extract (e.g. 'Extract product name, price, and description')",
      }),
      schema: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "JSON schema that constrains the extracted result",
        }),
      ),
    },
    { additionalProperties: false },
  ),
  cli: { positional: ["url"], short: shortProvider },
  execute: async (input, { signal }) => (await loadOperations()).browserExtract(input, { signal }),
});

export const crawlTool = defineTool({
  name: "browsers_crawl",
  title: browserToolLabels.browsers_crawl,
  description: browserToolDescriptions.browsers_crawl,
  snippet: "Crawl a website and extract content from multiple pages.",
  guidelines: [
    "Use browsers_crawl when the user needs content from multiple pages of a website.",
    "Cloudflare and Hyperbrowser wait up to two minutes for the crawl job; one still running after that returns its job ID and no pages.",
    "When a crawl returns a running job ID, call browsers_crawl with that jobId and the same provider and browser, without url, instead of starting the crawl again.",
    "Pass maxPages to limit the crawl scope and maxChars to bound the returned content.",
  ],
  effect: "read",
  idempotent: false,
  openWorld: true,
  input: Type.Object(
    {
      url: Type.Optional(
        Type.String({ description: "Starting URL. Required unless jobId is passed." }),
      ),
      jobId: Type.Optional(
        Type.String({
          minLength: 1,
          description:
            "Job ID an earlier crawl returned. Waits for that job again instead of starting a crawl; pass it without url and with the provider and browser that returned it.",
        }),
      ),
      provider: providerOf("cloudflare", "hyperbrowser", "playwright"),
      browser,
      maxPages: Type.Optional(
        Type.Number({ description: "Max pages a new crawl reads. Default: 10." }),
      ),
      maxChars: maxChars("page content characters to return across all pages"),
    },
    { additionalProperties: false },
  ),
  cli: { positional: ["url"], short: shortProvider },
  execute: async (input, { signal }) => (await loadOperations()).browserCrawl(input, { signal }),
});

export const pdfTool = defineTool({
  name: "browsers_pdf",
  title: browserToolLabels.browsers_pdf,
  description: browserToolDescriptions.browsers_pdf,
  snippet: "Save a PDF of a URL to a file.",
  guidelines: [
    "Use browsers_pdf when the user needs a PDF of a webpage.",
    "Cloudflare, Browserless and Playwright work statelessly (no session needed).",
  ],
  /** Writes a new file and never overwrites one. */
  effect: "write",
  openWorld: true,
  input: Type.Object(
    {
      url: Type.String({ description: "URL to convert to PDF" }),
      provider: providerOf("cloudflare", "browserless", "playwright"),
      browser,
      path: Type.String({
        description:
          "File to write the PDF to. A relative path resolves against the working directory of the process running the tool. The file must not exist yet.",
      }),
    },
    { additionalProperties: false },
  ),
  cli: { positional: ["url"], short: { ...shortProvider, path: "o" } },
  execute: async (input) => (await loadOperations()).browserPdf(input),
});

export const linksTool = defineTool({
  name: "browsers_links",
  title: browserToolLabels.browsers_links,
  description: browserToolDescriptions.browsers_links,
  snippet: "Extract links from a webpage.",
  guidelines: [
    "Use browsers_links when the user needs the links of a page. It returns the first page of them with the total; pass the next offset it reports to read the rest.",
    "Cloudflare, Playwright and Lightpanda support this currently.",
  ],
  effect: "read",
  idempotent: false,
  openWorld: true,
  input: Type.Object(
    {
      url: Type.String({ description: "URL to extract links from" }),
      provider: providerOf("cloudflare", "playwright", "lightpanda", "attach"),
      browser,
      limit: Type.Optional(
        Type.Integer({
          description: `Maximum links to return. Defaults to ${DEFAULT_LINKS_LIMIT}; accepted range: 1-${MAX_LINKS_LIMIT}.`,
          minimum: 1,
          maximum: MAX_LINKS_LIMIT,
        }),
      ),
      offset: Type.Optional(
        Type.Integer({
          description:
            "Number of links to skip, from the next offset a previous call reported. Default: 0.",
          minimum: 0,
        }),
      ),
    },
    { additionalProperties: false },
  ),
  cli: { positional: ["url"], short: shortProvider },
  execute: async (input, { signal }) => (await loadOperations()).browserLinks(input, { signal }),
});

export const accessibilityTool = defineTool({
  name: "browsers_accessibility",
  title: browserToolLabels.browsers_accessibility,
  description: browserToolDescriptions.browsers_accessibility,
  snippet: "Read the accessibility tree of a webpage.",
  guidelines: [
    "Use browsers_accessibility to see which headings, links, buttons and form fields a page has, with their states, before reading its full content with browsers_scrape.",
    "Pass root with a CSS selector to read one form or region instead of the whole page.",
  ],
  effect: "read",
  idempotent: false,
  openWorld: true,
  input: Type.Object(
    {
      url: Type.String({ description: "URL to read the accessibility tree of" }),
      provider: providerOf("cloudflare"),
      browser,
      root: Type.Optional(
        Type.String({
          minLength: 1,
          description:
            "CSS selector of the element whose subtree to read instead of the whole page; the first match wins.",
        }),
      ),
      interestingOnly: Type.Optional(
        Type.Boolean({
          description:
            "Drop generic and presentational nodes. Default: true for the whole page, false under root. True under root gives no tree when the root element is such a node itself, like a form.",
        }),
      ),
      maxChars: maxChars("tree characters to return"),
    },
    { additionalProperties: false },
  ),
  cli: {
    description: "Print the accessibility tree of a URL.",
    positional: ["url"],
    short: shortProvider,
  },
  execute: async (input, { signal }) =>
    (await loadOperations()).browserAccessibility(input, { signal }),
});

export const searchTool = defineTool({
  name: "browsers_search",
  title: browserToolLabels.browsers_search,
  description: browserToolDescriptions.browsers_search,
  snippet: "Search the web via browser provider.",
  guidelines: [
    "Use browsers_search when the user needs web search results.",
    "Hyperbrowser supports native web search.",
  ],
  effect: "read",
  idempotent: false,
  openWorld: true,
  input: Type.Object(
    {
      query: Type.String({ description: "Search query" }),
      maxResults: Type.Optional(
        Type.Integer({
          description: `Maximum results to return. Defaults to ${MAX_SEARCH_RESULTS}; accepted range: 1-${MAX_SEARCH_RESULTS}.`,
          minimum: 1,
          maximum: MAX_SEARCH_RESULTS,
        }),
      ),
    },
    { additionalProperties: false },
  ),
  cli: { rest: "query", short: { maxResults: "n" } },
  execute: async (input, { signal }) => (await loadOperations()).browserSearch(input, { signal }),
});

export const capabilitiesTool = defineTool({
  name: "browsers_capabilities",
  title: browserToolLabels.browsers_capabilities,
  description: browserToolDescriptions.browsers_capabilities,
  snippet: "Check capabilities of a browser provider before using it.",
  guidelines: [
    "Use browsers_capabilities before browsers_scrape/browsers_screenshot to check if the provider supports the operation.",
    "Some providers support stateless operations (no session needed): cloudflare, browserless and hyperbrowser for both scrape and screenshot.",
    "Navigate and evaluate flags describe the library API. No tool accepts a session ID except browsers_release.",
  ],
  effect: "read",
  openWorld: false,
  input: Type.Object(
    { provider: Type.String({ description: "Provider name to check" }) },
    { additionalProperties: false },
  ),
  cli: {
    description: "Report which operations a browser provider supports.",
    positional: ["provider"],
    plain: ["provider"],
  },
  execute: async (input) => (await loadOperations()).browserCapabilities(input),
});

/** Every browser tool in the order MCP lists them, each keeping its literal name for `toAiTools`. */
export const browserTools = [
  scrapeTool,
  sessionTool,
  releaseTool,
  providersTool,
  screenshotTool,
  extractTool,
  crawlTool,
  pdfTool,
  linksTool,
  accessibilityTool,
  searchTool,
  capabilitiesTool,
] as const satisfies readonly ToolDefinition[];
