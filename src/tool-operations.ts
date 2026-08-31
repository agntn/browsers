import "./providers/index";
import { DEFAULT_SCRAPE_MAX_CHARS, MAX_SCRAPE_MAX_CHARS } from "./tool-contract";
import { create, providers } from "./core/registry";
import { resolveProvider } from "./core/resolve";
import type { BrowserProvider, ProviderCapabilities } from "./core/types";

export type { ProviderCapabilities } from "./core/types";

/** Text shown to the model plus structured details retained by agent harnesses. */
export interface ToolResult<Details> {
  content: Array<{ type: "text"; text: string }>;
  details: Details;
  isError?: boolean;
}

/** Arguments accepted by the browser scrape tool. */
export interface BrowserScrapeParams {
  url: string;
  provider?: string;
  waitFor?: string;
  maxChars?: number;
}

/** Arguments accepted by the browser session tool. */
export interface BrowserSessionParams {
  provider?: string;
  region?: string;
}

/** Arguments accepted by the browser release tool. */
export interface BrowserReleaseParams {
  sessionId: string;
  provider?: string;
}

/** Arguments accepted by the browser screenshot tool. */
export interface BrowserScreenshotParams {
  url: string;
  provider?: string;
  format?: string;
  fullPage?: boolean;
}

/** Arguments accepted by the browser extraction tool. */
export interface BrowserExtractParams {
  url: string;
  provider?: string;
  prompt: string;
  schema?: Readonly<Record<string, unknown>>;
}

/** Arguments accepted by the browser crawl tool. */
export interface BrowserCrawlParams {
  url: string;
  provider?: string;
  maxPages?: number;
}

/** Arguments accepted by tools that take a URL and optional provider. */
export interface BrowserUrlParams {
  url: string;
  provider?: string;
}

/** Arguments accepted by the browser search tool. */
export interface BrowserSearchParams {
  query: string;
}

/** Arguments accepted by provider capability discovery. */
export interface BrowserCapabilitiesParams {
  provider: string;
}

/** Public details for one session, excluding provider connection credentials. */
export interface BrowserSessionDetails {
  session: { id: string; provider: string; createdAt: number };
}

/** Public details for a scrape result. */
export interface BrowserScrapeDetails {
  url: string;
  provider: string;
  contentLength: number;
}

/** One provider row exposed by discovery surfaces. */
export interface BrowserProviderStatus {
  name: string;
  configured: boolean;
  capabilities: Record<string, boolean>;
}

export { DEFAULT_SCRAPE_MAX_CHARS, MAX_SCRAPE_MAX_CHARS };

/* oxlint-disable-next-line no-control-regex */
const UNSAFE_CONTROLS = /[\u0000-\u001F\u007F-\u009F]/gu;

function content(text: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text }];
}

/**
 * Reduces an external or caller supplied value to one terminal safe line.
 *
 * @param value - Untrusted field value.
 * @returns {string} A terminal safe single-line value.
 */
export function sanitizeField(value: string): string {
  return value.replace(UNSAFE_CONTROLS, " ").replaceAll(/ +/g, " ").trim();
}

/**
 * Reduces an unknown failure to one terminal safe line.
 *
 * @param error - Unknown failure value.
 * @returns {string} A terminal safe error message.
 */
export function errorMessage(error: unknown): string {
  return sanitizeField(error instanceof Error ? error.message : String(error));
}

function getProvider(preferred?: string): { name: string; provider: BrowserProvider } {
  const name = resolveProvider(preferred);
  return { name, provider: create(name) };
}

function resolveScrapeMaxChars(value?: number): number {
  const maxChars = value ?? DEFAULT_SCRAPE_MAX_CHARS;
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > MAX_SCRAPE_MAX_CHARS) {
    throw new RangeError(`maxChars must be an integer between 1 and ${MAX_SCRAPE_MAX_CHARS}.`);
  }
  return maxChars;
}

/**
 * Scrapes one URL and bounds the normalized text returned to the model.
 *
 * @param params - Scrape arguments.
 * @returns {Promise<ToolResult<BrowserScrapeDetails>>} Bounded page content and scrape metadata.
 */
export async function browserScrape(
  params: Readonly<BrowserScrapeParams>,
): Promise<ToolResult<BrowserScrapeDetails>> {
  const maxChars = resolveScrapeMaxChars(params.maxChars);
  const { name, provider } = getProvider(params.provider);
  const result = await provider.scrape(params.url, { waitFor: params.waitFor, maxChars });
  const rawContent = result.text || result.markdown || result.html || "No content extracted";
  const body = rawContent.slice(0, maxChars);
  const truncation =
    rawContent.length > maxChars
      ? `\n\n[truncated ${rawContent.length - maxChars} of ${rawContent.length} characters]`
      : "";
  const url = sanitizeField(params.url);
  return {
    content: content(`[provider=${name}] ${url}\n\n${body}${truncation}`),
    details: { url: params.url, provider: name, contentLength: rawContent.length },
  };
}

/**
 * Creates one browser session without returning its connection credentials.
 *
 * @param params - Session creation arguments.
 * @returns {Promise<ToolResult<BrowserSessionDetails>>} Public session identity without connection credentials.
 */
export async function browserSession(
  params: Readonly<BrowserSessionParams>,
): Promise<ToolResult<BrowserSessionDetails>> {
  const { name, provider } = getProvider(params.provider);
  const session = await provider.createSession({ region: params.region });
  return {
    content: content(`[provider=${name}] Session created: ${sanitizeField(session.id)}`),
    details: {
      session: { id: session.id, provider: session.provider, createdAt: session.createdAt },
    },
  };
}

/**
 * Releases one browser session.
 *
 * @param params - Session release arguments.
 * @returns {Promise<ToolResult<{ released: boolean }>>} Release confirmation.
 */
export async function releaseBrowserSession(
  params: Readonly<BrowserReleaseParams>,
): Promise<ToolResult<{ released: boolean }>> {
  const { name, provider } = getProvider(params.provider);
  await provider.releaseSession(params.sessionId);
  return {
    content: content(`[provider=${name}] Session ${sanitizeField(params.sessionId)} released.`),
    details: { released: true },
  };
}

/**
 * Lists registered providers, configuration state, and capabilities.
 *
 * @returns {ToolResult<{ providers: BrowserProviderStatus[] }>} Provider discovery rows.
 */
export function listBrowserProviders(): ToolResult<{ providers: BrowserProviderStatus[] }> {
  const rows = providers().map((name): BrowserProviderStatus => {
    try {
      const provider = create(name);
      return { name, configured: true, capabilities: { ...provider.capabilities() } };
    } catch {
      return { name, configured: false, capabilities: {} };
    }
  });
  const lines = rows.map((row) => {
    const tags = Object.entries(row.capabilities)
      .filter(([, supported]) => supported)
      .map(([capability]) => capability)
      .join(" ");
    return `${row.configured ? "●" : "○"} ${row.name}  ${tags}`;
  });
  return { content: content(lines.join("\n")), details: { providers: rows } };
}

/**
 * Takes a stateless screenshot or manages a temporary provider session.
 *
 * @param params - Screenshot arguments.
 * @returns {Promise<ToolResult<{ url: string; provider: string; saved: boolean }>>} Screenshot metadata without duplicating image data.
 */
export async function browserScreenshot(
  params: Readonly<BrowserScreenshotParams>,
): Promise<ToolResult<{ url: string; provider: string; saved: boolean }>> {
  const { name, provider } = getProvider(params.provider);
  const capabilities = provider.capabilities();
  const options = {
    url: params.url,
    fullPage: params.fullPage,
    format: screenshotFormat(params.format),
  };

  if (capabilities.statelessScreenshot) {
    const result = await provider.screenshot(options);
    return screenshotResult(params.url, name, result.data.length, true);
  }

  const session = await provider.createSession();
  try {
    if (capabilities.navigate) {
      await provider.navigate(params.url, session).catch(() => undefined);
    }
    const result = await provider.screenshot(options, session);
    return screenshotResult(params.url, name, result.data.length, false);
  } finally {
    await provider.releaseSession(session.id).catch(() => undefined);
  }
}

function screenshotFormat(format?: string): "png" | "jpeg" | "webp" | undefined {
  if (format === undefined || format === "png" || format === "jpeg" || format === "webp") {
    return format;
  }
  throw new Error(`Unsupported screenshot format: ${JSON.stringify(format)}`);
}

function screenshotResult(
  url: string,
  provider: string,
  dataLength: number,
  stateless: boolean,
): ToolResult<{ url: string; provider: string; saved: boolean }> {
  const mode = stateless ? "Stateless screenshot" : "Screenshot";
  return {
    content: content(
      `[provider=${provider}] ${mode} of ${sanitizeField(url)}. Data length: ${dataLength} chars.`,
    ),
    details: { url, provider, saved: false },
  };
}

/**
 * Extracts structured data from one page through a capable provider.
 *
 * @param params - Extraction arguments.
 * @returns {Promise<ToolResult<{ url: string; provider: string; data: unknown }>>} Extracted data and provider metadata.
 */
export async function browserExtract(
  params: Readonly<BrowserExtractParams>,
): Promise<ToolResult<{ url: string; provider: string; data: unknown }>> {
  const { name, provider } = getProvider(params.provider);
  if (!provider.extract) throw new Error(`Provider ${name} does not support extract.`);
  const result = await provider.extract(params.url, {
    prompt: params.prompt,
    schema: params.schema ? { ...params.schema } : undefined,
  });
  return {
    content: content(
      `[provider=${name}] ${sanitizeField(params.url)}\n\n${JSON.stringify(result.data, null, 2)}`,
    ),
    details: { url: params.url, provider: name, data: result.data },
  };
}

/**
 * Crawls a site through a capable provider.
 *
 * @param params - Crawl arguments.
 * @returns {Promise<ToolResult<{ jobId?: string; pages: number }>>} Crawl job identity and page count.
 */
export async function browserCrawl(
  params: Readonly<BrowserCrawlParams>,
): Promise<ToolResult<{ jobId?: string; pages: number }>> {
  const { name, provider } = getProvider(params.provider);
  if (!provider.crawl) throw new Error(`Provider ${name} does not support crawl.`);
  const result = await provider.crawl(params.url, { maxPages: params.maxPages ?? 10 });
  const lines = [`[provider=${name}] Crawled ${result.pages.length} pages.`];
  if (result.jobId) {
    lines.push(`Job ID: ${sanitizeField(result.jobId)} (status: ${result.status})`);
  }
  return {
    content: content(lines.join("\n")),
    details: { jobId: result.jobId, pages: result.pages.length },
  };
}

/**
 * Generates a PDF through a capable provider.
 *
 * @param params - PDF arguments.
 * @returns {Promise<ToolResult<{ url: string; provider: string; pdfLength: number }>>} PDF metadata without duplicating binary data.
 */
export async function browserPdf(
  params: Readonly<BrowserUrlParams>,
): Promise<ToolResult<{ url: string; provider: string; pdfLength: number }>> {
  const { name, provider } = getProvider(params.provider);
  if (!provider.pdf) throw new Error(`Provider ${name} does not support PDF generation.`);
  const result = await provider.pdf(params.url);
  return {
    content: content(`[provider=${name}] PDF generated: ${result.data.length} chars.`),
    details: { url: params.url, provider: name, pdfLength: result.data.length },
  };
}

/**
 * Extracts links from one page through a capable provider.
 *
 * @param params - Link extraction arguments.
 * @returns {Promise<ToolResult<{ url: string; links: string[] }>>} Extracted links.
 */
export async function browserLinks(
  params: Readonly<BrowserUrlParams>,
): Promise<ToolResult<{ url: string; links: string[] }>> {
  const { name, provider } = getProvider(params.provider);
  if (!provider.links) throw new Error(`Provider ${name} does not support link extraction.`);
  const result = await provider.links(params.url);
  const links = result.links.map((link) => link.href);
  return {
    content: content(
      `[provider=${name}] ${links.length} links:\n${links.map(sanitizeField).join("\n")}`,
    ),
    details: { url: params.url, links },
  };
}

/**
 * Searches the web through Hyperbrowser.
 *
 * @param params - Search arguments.
 * @returns {Promise<ToolResult<{ results: Array<{ url: string; title: string; snippet: string }> }>>} Normalized search results.
 */
export async function browserSearch(
  params: Readonly<BrowserSearchParams>,
): Promise<ToolResult<{ results: Array<{ url: string; title: string; snippet: string }> }>> {
  const { name, provider } = getProvider("hyperbrowser");
  if (!provider.search) throw new Error(`Provider ${name} does not support web search.`);
  const results = await provider.search(params.query);
  const rows = results.map((result) => ({
    url: result.url,
    title: result.title,
    snippet: result.snippet,
  }));
  const lines = rows.map(
    (result) =>
      `${sanitizeField(result.title)}\n  ${sanitizeField(result.url)}\n  ${sanitizeField(result.snippet)}`,
  );
  return {
    content: content(`[provider=${name}] ${rows.length} results:\n\n${lines.join("\n\n")}`),
    details: { results: rows },
  };
}

/**
 * Reports the capability flags of one provider.
 *
 * @param params - Provider lookup arguments.
 * @returns {ToolResult<{ provider: string; capabilities: ProviderCapabilities }>} Provider capability flags.
 */
export function browserCapabilities(
  params: Readonly<BrowserCapabilitiesParams>,
): ToolResult<{ provider: string; capabilities: ProviderCapabilities }> {
  const { name, provider } = getProvider(params.provider);
  const capabilities = provider.capabilities();
  const lines = Object.entries(capabilities).map(
    ([key, supported]) => `  ${key}: ${supported ? "✓" : "✗"}`,
  );
  return {
    content: content(`[${name}]\n${lines.join("\n")}`),
    details: { provider: name, capabilities },
  };
}
