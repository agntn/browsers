import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DEFAULT_SCRAPE_MAX_CHARS, MAX_SCRAPE_MAX_CHARS } from "./tool-contract";
import { BrowserError } from "./core/errors";
import { create, providers } from "./core/registry";
import { createProvider } from "./core/resolve";
import type { ProviderCapabilities, ScreenshotResult } from "./core/types";
import {
  imageMimeType,
  scrapeWithSessionWhenNeeded,
  screenshotWithSessionWhenNeeded,
} from "./core/utils";

export type { ProviderCapabilities } from "./core/types";

/** An image shown to the model, as base64 with its MIME type. */
export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

/** Text and images shown to the model plus structured details retained by agent harnesses. */
export interface ToolResult<Details> {
  content: Array<{ type: "text"; text: string } | ImageContent>;
  details: Details;
  isError?: boolean;
}

/** Arguments accepted by the browser scrape tool. */
export interface BrowserScrapeParams {
  url: string;
  provider?: string;
  browser?: string;
  waitFor?: string;
  maxChars?: number;
}

/** Arguments accepted by the browser session tool. */
export interface BrowserSessionParams {
  provider?: string;
  browser?: string;
  region?: string;
}

/** Arguments accepted by the browser release tool. */
export interface BrowserReleaseParams {
  sessionId: string;
  provider?: string;
  browser?: string;
}

/** Arguments accepted by the browser screenshot tool. */
export interface BrowserScreenshotParams {
  url: string;
  provider?: string;
  browser?: string;
  format?: string;
  fullPage?: boolean;
  path?: string;
}

/** Arguments accepted by the browser extraction tool. */
export interface BrowserExtractParams {
  url: string;
  provider?: string;
  browser?: string;
  prompt: string;
  schema?: Readonly<Record<string, unknown>>;
}

/** Arguments accepted by the browser crawl tool. */
export interface BrowserCrawlParams {
  url: string;
  provider?: string;
  browser?: string;
  maxPages?: number;
}

/** Arguments accepted by the browser PDF tool. */
export interface BrowserPdfParams {
  url: string;
  path: string;
  provider?: string;
  browser?: string;
}

/** Arguments accepted by tools that take a URL and optional provider. */
export interface BrowserUrlParams {
  url: string;
  provider?: string;
  browser?: string;
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
  const { name, provider } = await createProvider(params.provider, params.browser);
  const result = await scrapeWithSessionWhenNeeded(provider, params.url, {
    waitFor: params.waitFor,
    maxChars,
  });
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
  const { name, provider } = await createProvider(params.provider, params.browser);
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
  const { name, provider } = await createProvider(params.provider, params.browser);
  await provider.releaseSession(params.sessionId);
  return {
    content: content(`[provider=${name}] Session ${sanitizeField(params.sessionId)} released.`),
    details: { released: true },
  };
}

/**
 * Describes one registered provider, or marks it unconfigured when it cannot be built.
 *
 * @param name - Provider name.
 * @returns {Promise<BrowserProviderStatus>} Configuration state and capability flags.
 */
async function providerStatus(name: string): Promise<BrowserProviderStatus> {
  try {
    const provider = await create(name);
    return { name, configured: true, capabilities: { ...provider.capabilities() } };
  } catch {
    return { name, configured: false, capabilities: {} };
  }
}

/**
 * Lists registered providers, configuration state, and capabilities.
 *
 * Every provider module loads here, because the capability flags live on the instances.
 *
 * @returns {Promise<ToolResult<{ providers: BrowserProviderStatus[] }>>} Provider discovery rows.
 */
export async function listBrowserProviders(): Promise<
  ToolResult<{ providers: BrowserProviderStatus[] }>
> {
  const rows = await Promise.all(providers().map(providerStatus));
  const lines = rows.map((row) => {
    const tags = Object.entries(row.capabilities)
      .filter(([, supported]) => supported)
      .map(([capability]) => capability)
      .join(" ");
    return `${row.configured ? "●" : "○"} ${row.name}  ${tags}`;
  });
  return { content: content(lines.join("\n")), details: { providers: rows } };
}

/** Screenshot metadata kept by agent harnesses; the image itself is never repeated here. */
export interface BrowserScreenshotDetails {
  url: string;
  provider: string;
  mimeType: string;
  bytes: number;
  saved: boolean;
  path?: string;
}

/**
 * Base64 length above which a screenshot is not inlined. Model APIs refuse
 * larger images (Anthropic caps one image at 5 MB), so a bigger capture has
 * to go to a file.
 */
const MAX_INLINE_IMAGE_CHARS = 5 * 1024 * 1024;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Takes a stateless screenshot or manages a temporary provider session.
 *
 * Without `path` the image comes back as an image content block. With `path`
 * it is written to that file, which must not exist yet, and only the path
 * comes back.
 *
 * @param params - Screenshot arguments.
 * @returns {Promise<ToolResult<BrowserScreenshotDetails>>} The image or the saved file, with metadata.
 */
export async function browserScreenshot(
  params: Readonly<BrowserScreenshotParams>,
): Promise<ToolResult<BrowserScreenshotDetails>> {
  const { name, provider } = await createProvider(params.provider, params.browser);
  const result = await screenshotWithSessionWhenNeeded(provider, {
    url: params.url,
    fullPage: params.fullPage,
    format: screenshotFormat(params.format),
  });
  const image = screenshotImage(result, name);
  const mode = provider.capabilities().statelessScreenshot ? "Stateless screenshot" : "Screenshot";
  const summary = `[provider=${name}] ${mode} of ${sanitizeField(params.url)}: ${image.mimeType}, ${image.bytes.length} bytes`;
  const details = {
    url: params.url,
    provider: name,
    mimeType: image.mimeType,
    bytes: image.bytes.length,
  };

  if (params.path !== undefined) {
    const path = await writeNewFile(params.path, image.data);
    return {
      content: content(`${summary}, saved to ${sanitizeField(path)}.`),
      details: { ...details, saved: true, path },
    };
  }

  if (image.data.length > MAX_INLINE_IMAGE_CHARS) {
    throw new BrowserError(
      `Screenshot is ${image.bytes.length} bytes, too large to return inline. Pass path to save it to a file.`,
    );
  }
  return {
    content: [
      { type: "text", text: `${summary}.` },
      { type: "image", data: image.data, mimeType: image.mimeType },
    ],
    details: { ...details, saved: false },
  };
}

function screenshotFormat(format?: string): "png" | "jpeg" | "webp" | undefined {
  if (format === undefined || format === "png" || format === "jpeg" || format === "webp") {
    return format;
  }
  throw new Error(`Unsupported screenshot format: ${JSON.stringify(format)}`);
}

/**
 * Decodes a provider screenshot, a data URL or bare base64, into image bytes.
 *
 * @param result - Screenshot returned by the provider.
 * @param provider - Provider name for error messages.
 * @returns {{ data: string; mimeType: string; bytes: Buffer }} Base64, MIME type read from the bytes, and the bytes.
 */
function screenshotImage(
  result: Readonly<ScreenshotResult>,
  provider: string,
): { data: string; mimeType: string; bytes: Buffer } {
  const { bytes, mimeType: declared } = decodeProviderFile(
    result.data,
    provider,
    "screenshot",
    "image data",
  );
  const mimeType = imageMimeType(bytes, declared || result.mimeType);
  return { data: bytes.toString("base64"), mimeType, bytes };
}

/**
 * Decodes a file a provider returned as a data URL or bare base64.
 *
 * @param data - Data URL or base64 payload.
 * @param provider - Provider name for error messages.
 * @param file - What the file is, for error messages.
 * @param contents - What the payload should hold, for error messages.
 * @returns {{ data: string; bytes: Buffer; mimeType?: string }} The base64 payload, its bytes, and the MIME type the data URL declared.
 */
function decodeProviderFile(
  data: string,
  provider: string,
  file: string,
  contents: string,
): { data: string; bytes: Buffer; mimeType?: string } {
  const header = /^data:([^;,]*)(?:;[^,]*)?,/.exec(data);
  const payload = (header ? data.slice(header[0].length) : data).replaceAll(/\s/g, "");
  if (payload.length === 0) {
    throw new BrowserError(`${provider} returned an empty ${file}`);
  }
  if (!BASE64.test(payload)) {
    throw new BrowserError(`${provider} returned a ${file} that is not base64 ${contents}`);
  }
  return {
    data: payload,
    bytes: Buffer.from(payload, "base64"),
    mimeType: header?.[1] || undefined,
  };
}

/**
 * Writes base64 data to a file that must not exist yet, creating its directory.
 *
 * @param file - Path as the caller gave it, relative to the working directory.
 * @param data - File contents as base64.
 * @returns {Promise<string>} The absolute path written.
 */
async function writeNewFile(file: string, data: string): Promise<string> {
  const path = resolve(file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data, { encoding: "base64", flag: "wx" });
  return path;
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
  const { name, provider } = await createProvider(params.provider, params.browser, "extract");
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
  const { name, provider } = await createProvider(params.provider, params.browser, "crawl");
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

/** PDF metadata kept by agent harnesses; the document itself stays in the file. */
export interface BrowserPdfDetails {
  url: string;
  provider: string;
  bytes: number;
  path: string;
}

const PDF_SIGNATURE = Buffer.from("%PDF-");

/**
 * Generates a PDF through a capable provider and writes it to `path`, which
 * must not exist yet. Only the path comes back, since a PDF cannot be shown
 * to the model inline.
 *
 * @param params - PDF arguments.
 * @returns {Promise<ToolResult<BrowserPdfDetails>>} The saved file with its size.
 */
export async function browserPdf(
  params: Readonly<BrowserPdfParams>,
): Promise<ToolResult<BrowserPdfDetails>> {
  const { name, provider } = await createProvider(params.provider, params.browser, "pdf");
  const result = await provider.pdf(params.url);
  const { data, bytes } = decodeProviderFile(result.data, name, "PDF", "PDF data");
  if (!bytes.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
    throw new BrowserError(`${name} returned a PDF that does not start with %PDF-`);
  }
  const path = await writeNewFile(params.path, data);
  return {
    content: content(
      `[provider=${name}] PDF of ${sanitizeField(params.url)}: ${bytes.length} bytes, saved to ${sanitizeField(path)}.`,
    ),
    details: { url: params.url, provider: name, bytes: bytes.length, path },
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
  const { name, provider } = await createProvider(params.provider, params.browser, "links");
  const result = await provider.links(params.url);
  const links = [...new Set(result.links.map((link) => sanitizeField(link.href)))];
  return {
    content: content(`[provider=${name}] ${links.length} links:\n${links.join("\n")}`),
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
  const { name, provider } = await createProvider("hyperbrowser", undefined, "search");
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
 * @returns {Promise<ToolResult<{ provider: string; capabilities: ProviderCapabilities }>>} Provider capability flags.
 */
export async function browserCapabilities(
  params: Readonly<BrowserCapabilitiesParams>,
): Promise<ToolResult<{ provider: string; capabilities: ProviderCapabilities }>> {
  const { name, provider } = await createProvider(params.provider);
  const capabilities = provider.capabilities();
  const lines = Object.entries(capabilities).map(
    ([key, supported]) => `  ${key}: ${supported ? "✓" : "✗"}`,
  );
  return {
    content: content(`[${name}]\n${lines.join("\n")}`),
    details: { provider: name, capabilities },
  };
}
