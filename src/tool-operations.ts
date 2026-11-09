import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_LINKS_LIMIT,
  DEFAULT_SCRAPE_MAX_CHARS,
  MAX_LINKS_LIMIT,
  MAX_SCRAPE_MAX_CHARS,
  MAX_SEARCH_RESULTS,
} from "./tool-contract.ts";
import { hasCloudflareCredentials } from "./core/cloudflare.ts";
import { BrowserError, InvalidInputError } from "./core/errors.ts";
import { create, providers } from "./core/registry.ts";
import {
  createCapableProvider,
  createCrawl,
  createProvider,
  createScreenshotProvider,
  scrapeCapabilities,
} from "./core/resolve.ts";
import type {
  AbortOptions,
  AccessibilityNode,
  AccessibilityTreeResult,
  CrawlPage,
  ProviderCapabilities,
  ScreenshotResult,
  WebMcpTool,
} from "./core/types.ts";
import {
  imageMimeType,
  scrapeWithSessionWhenNeeded,
  screenshotWithSessionWhenNeeded,
} from "./core/utils.ts";

export type { ProviderCapabilities } from "./core/types.ts";

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
  browser?: string;
  format?: string;
  fullPage?: boolean;
  selector?: string;
  waitFor?: string;
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
  url?: string;
  jobId?: string;
  provider?: string;
  browser?: string;
  maxPages?: number;
  maxChars?: number;
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

/** Arguments accepted by the browser links tool. */
export interface BrowserLinksParams extends BrowserUrlParams {
  limit?: number;
  offset?: number;
}

/** Arguments accepted by the browser accessibility tool. */
export interface BrowserAccessibilityParams extends BrowserUrlParams {
  root?: string;
  interestingOnly?: boolean;
  maxChars?: number;
}

/** Arguments accepted by the browser WebMCP tools tool. */
export interface BrowserWebMcpToolsParams extends BrowserUrlParams {
  maxChars?: number;
}

/** Arguments accepted by the browser WebMCP call tool. */
export interface BrowserWebMcpCallParams extends BrowserUrlParams {
  tool: string;
  input?: Readonly<Record<string, unknown>>;
  maxChars?: number;
}

/** Arguments accepted by the browser search tool. */
export interface BrowserSearchParams {
  query: string;
  maxResults?: number;
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

/** Controls, line separators and format marks like bidi; Persian and emoji keep ZWNJ and ZWJ. */
const UNSAFE_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}[\p{Cf}--[\u200C\u200D]]]/gv;

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
  return value.replaceAll(UNSAFE_CHARACTERS, " ").replaceAll(/ +/g, " ").trim();
}

/**
 * Cuts text to `maxChars` at the last `at` (a line break by default) and says how much went.
 *
 * @param text - Whole text.
 * @param limit - Characters to keep at most, and the separator to cut at.
 * @returns {{ body: string; truncation: string }} The kept text and its truncation note, if any.
 */
function cutAt(
  text: string,
  limit: Readonly<{ maxChars: number; at?: string }>,
): { body: string; truncation: string } {
  const { maxChars, at = "\n" } = limit;
  if (text.length <= maxChars) return { body: text, truncation: "" };
  const cut = text.lastIndexOf(at, maxChars);
  const body = text.slice(0, cut > 0 ? cut : maxChars);
  return {
    body,
    truncation: `\n\n[truncated ${text.length - body.length} of ${text.length} characters]`,
  };
}

function resolveMaxChars(value?: number): number {
  const maxChars = value ?? DEFAULT_SCRAPE_MAX_CHARS;
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > MAX_SCRAPE_MAX_CHARS) {
    throw new InvalidInputError(
      `maxChars must be an integer between 1 and ${MAX_SCRAPE_MAX_CHARS}.`,
    );
  }
  return maxChars;
}

function resolveLinksLimit(value?: number): number {
  const limit = value ?? DEFAULT_LINKS_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LINKS_LIMIT) {
    throw new InvalidInputError(`limit must be an integer between 1 and ${MAX_LINKS_LIMIT}.`);
  }
  return limit;
}

function resolveSearchMaxResults(value?: number): number {
  const maxResults = value ?? MAX_SEARCH_RESULTS;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_SEARCH_RESULTS) {
    throw new InvalidInputError(
      `maxResults must be an integer between 1 and ${MAX_SEARCH_RESULTS}.`,
    );
  }
  return maxResults;
}

function resolveLinksOffset(value?: number): number {
  const offset = value ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new InvalidInputError("offset must be a non-negative integer.");
  }
  return offset;
}

/**
 * Scrapes one URL and bounds the normalized text returned to the model.
 *
 * @param params - Scrape arguments.
 * @param options - Cancellation, which also releases a temporary session.
 * @returns {Promise<ToolResult<BrowserScrapeDetails>>} Bounded page content and scrape metadata.
 */
export async function browserScrape(
  params: Readonly<BrowserScrapeParams>,
  options?: Readonly<AbortOptions>,
): Promise<ToolResult<BrowserScrapeDetails>> {
  const maxChars = resolveMaxChars(params.maxChars);
  const { name, provider } = await createCapableProvider(
    params.provider,
    params.browser,
    scrapeCapabilities(params),
  );
  const result = await scrapeWithSessionWhenNeeded(provider, params.url, {
    formats: ["markdown"],
    waitFor: params.waitFor,
    maxChars,
    signal: options?.signal,
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
  const { name, provider } = await createCapableProvider(params.provider, undefined, "sessions");
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
  const { name, provider } = await createProvider(params.provider);
  await provider.releaseSession(params.sessionId);
  return {
    content: content(`[provider=${name}] Session ${sanitizeField(params.sessionId)} released.`),
    details: { released: true },
  };
}

/** Public details for the active sessions of one provider. */
export interface BrowserSessionsDetails {
  sessions: Array<BrowserSessionDetails["session"]>;
}

/**
 * Lists the active sessions of one provider, by ID only: a CDP URL carries the connection token.
 *
 * @param params - Provider to ask.
 * @returns {Promise<ToolResult<BrowserSessionsDetails>>} One line per session.
 */
export async function listBrowserSessions(
  params: Readonly<BrowserSessionParams>,
): Promise<ToolResult<BrowserSessionsDetails>> {
  const { name, provider } = await createProvider(params.provider);
  const sessions = (await provider.listSessions()).map((session) => ({
    id: session.id,
    provider: session.provider,
    createdAt: session.createdAt,
  }));
  const lines =
    sessions.length === 0
      ? [`[provider=${name}] No active sessions.`]
      : [
          `[provider=${name}] ${sessions.length} active session${sessions.length === 1 ? "" : "s"}:`,
          ...sessions.map((session) => sanitizeField(session.id)),
        ];
  return { content: content(lines.join("\n")), details: { sessions } };
}

/**
 * Describes one registered provider, or marks it unconfigured when it cannot be built. Cloudflare
 * builds without credentials, so it gets the lookup a request would make.
 *
 * @param name - Provider name.
 * @returns {Promise<BrowserProviderStatus>} Configuration state and capability flags.
 */
async function providerStatus(name: string): Promise<BrowserProviderStatus> {
  try {
    const provider = await create(name);
    if (name === "cloudflare" && !(await hasCloudflareCredentials())) {
      return { name, configured: false, capabilities: {} };
    }
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
  if (params.selector !== undefined && params.fullPage === true) {
    throw new InvalidInputError("Pass selector or fullPage, not both.");
  }
  const { name, provider } = await createScreenshotProvider(params.provider, params.browser, {
    selector: params.selector,
    waitFor: params.waitFor,
  });
  const result = await screenshotWithSessionWhenNeeded(provider, {
    url: params.url,
    fullPage: params.selector === undefined ? (params.fullPage ?? true) : params.fullPage,
    selector: params.selector,
    waitFor: params.waitFor,
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
  throw new InvalidInputError(`Unsupported screenshot format: ${JSON.stringify(format)}`);
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
 * @param options - Cancellation.
 * @returns {Promise<ToolResult<{ url: string; provider: string; data: unknown }>>} Extracted data and provider metadata.
 */
export async function browserExtract(
  params: Readonly<BrowserExtractParams>,
  options?: Readonly<AbortOptions>,
): Promise<ToolResult<{ url: string; provider: string; data: unknown }>> {
  const { name, provider } = await createProvider(params.provider, params.browser, "extract");
  const result = await provider.extract(params.url, {
    prompt: params.prompt,
    schema: params.schema ? { ...params.schema } : undefined,
    signal: options?.signal,
  });
  return {
    content: content(
      `[provider=${name}] ${sanitizeField(params.url)}\n\n${JSON.stringify(result.data, null, 2)}`,
    ),
    details: { url: params.url, provider: name, data: result.data },
  };
}

type CrawlPageContent = Readonly<Pick<CrawlPage, "url" | "title" | "text" | "markdown" | "html">>;

/**
 * Lays out crawled pages as a header each, with content cut to one shared budget.
 *
 * @param pages - Pages in crawl order.
 * @param maxChars - Content characters allowed across all pages.
 * @returns {string[]} Output lines, ending with a truncation note when content was cut.
 */
function crawlPageLines(pages: readonly CrawlPageContent[], maxChars: number): string[] {
  const lines: string[] = [];
  let budget = maxChars;
  let total = 0;
  for (const page of pages) {
    const pageContent = page.text || page.markdown || page.html || "";
    const title = page.title ? ` (${sanitizeField(page.title)})` : "";
    const body = pageContent.slice(0, budget);
    budget -= body.length;
    total += pageContent.length;
    lines.push("", `--- ${sanitizeField(page.url)}${title}`);
    if (body) lines.push(body);
  }
  if (total > maxChars) {
    lines.push("", `[truncated ${total - maxChars} of ${total} page content characters]`);
  }
  return lines;
}

/**
 * Crawls a site through a capable provider and returns each page it read.
 *
 * With `jobId` instead of `url` it waits for the crawl job an earlier call
 * returned, without starting another. Every page gets a header with its URL and
 * title. Page content shares one `maxChars` budget in crawl order, so later
 * pages may keep only the header.
 *
 * @param params - Crawl arguments.
 * @param options - Cancellation. It stops a crawl this call started where the provider can.
 * @returns {Promise<ToolResult<{ jobId?: string; pages: number }>>} Page content, crawl job identity and page count.
 */
export async function browserCrawl(
  params: Readonly<BrowserCrawlParams>,
  options?: Readonly<AbortOptions>,
): Promise<ToolResult<{ jobId?: string; pages: number }>> {
  const maxChars = resolveMaxChars(params.maxChars);
  const { name, read } = await createCrawl(params, params.provider, params.browser);
  const result = await read({ maxPages: params.maxPages ?? 10, signal: options?.signal });
  const lines = [`[provider=${name}] Crawled ${result.pages.length} pages.`];
  if (result.jobId) {
    lines.push(`Job ID: ${sanitizeField(result.jobId)} (status: ${result.status})`);
    if (result.status === "running") {
      const target = params.browser
        ? `jobId, provider ${name} and browser ${sanitizeField(params.browser)}`
        : `jobId and provider ${name}`;
      lines.push(
        `The job is still running. Call browsers_crawl with this ${target} to wait for it again.`,
      );
    }
  }
  lines.push(...crawlPageLines(result.pages, maxChars));
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

/** One page of links kept by agent harnesses. */
export interface BrowserLinksDetails {
  url: string;
  /** Links on this page of the result, in page order. */
  links: string[];
  /** Unique links the page has. */
  total: number;
  offset: number;
  /** Offset of the next page, present while links remain. */
  nextOffset?: number;
}

/**
 * Reads the unique links of one page through a capable provider, in order of first appearance.
 *
 * @param params - Link extraction arguments.
 * @param options - Cancellation.
 * @returns {Promise<{ provider: string; links: string[] }>} The provider used and every unique link.
 */
export async function readLinks(
  params: Readonly<BrowserUrlParams>,
  options?: Readonly<AbortOptions>,
): Promise<{ provider: string; links: string[] }> {
  const { name, provider } = await createProvider(params.provider, params.browser, "links");
  const result = await provider.links(params.url, undefined, { signal: options?.signal });
  return {
    provider: name,
    links: [...new Set(result.links.map((link) => sanitizeField(link.href)))],
  };
}

/**
 * Extracts one bounded page of links from a page through a capable provider.
 *
 * @param params - Link extraction arguments with the page bounds.
 * @param options - Cancellation.
 * @returns {Promise<ToolResult<BrowserLinksDetails>>} Links from `offset`, the total and the next offset.
 */
export async function browserLinks(
  params: Readonly<BrowserLinksParams>,
  options?: Readonly<AbortOptions>,
): Promise<ToolResult<BrowserLinksDetails>> {
  const limit = resolveLinksLimit(params.limit);
  const offset = resolveLinksOffset(params.offset);
  const { provider, links: all } = await readLinks(params, options);
  const total = all.length;
  const links = all.slice(offset, offset + limit);
  const end = offset + links.length;
  const nextOffset = end < total ? end : undefined;
  let text: string;
  if (offset === 0 && nextOffset === undefined) {
    text = `[provider=${provider}] ${total} links:\n${links.join("\n")}`;
  } else if (links.length === 0) {
    text = `[provider=${provider}] No links at offset ${offset}; the page has ${total}.`;
  } else {
    text = `[provider=${provider}] Links ${offset + 1}-${end} of ${total}:\n${links.join("\n")}`;
    if (nextOffset !== undefined) {
      text += `\n\n[${total - end} more links; call again with offset ${nextOffset}]`;
    }
  }
  return {
    content: content(text),
    details: {
      url: params.url,
      links,
      total,
      offset,
      ...(nextOffset === undefined ? {} : { nextOffset }),
    },
  };
}

/** Accessibility tree metadata kept by agent harnesses; the tree itself stays in the text. */
export interface BrowserAccessibilityDetails {
  url: string;
  provider: string;
  title?: string;
  statusCode?: number;
  /** Lines of the whole outline, one per node. */
  nodes: number;
  /** Characters of the whole outline, before `maxChars` cut it. */
  contentLength: number;
}

const TEXT_ROLE = "StaticText";

let graphemes: Intl.Segmenter | undefined;

/**
 * Tells whether a node is bare text: a `StaticText` with nothing but its name.
 *
 * @param node - Tree node.
 * @returns {boolean} Whether the node holds only text.
 */
function isBareText(node: AccessibilityNode): boolean {
  return (
    node.role === TEXT_ROLE && Object.keys(node).every((key) => key === "role" || key === "name")
  );
}

/**
 * Tells whether a node's name is at most one grapheme.
 *
 * @param node - Tree node, or none before the first child.
 * @returns {boolean} Whether the name is empty or a single character.
 */
function isOneCharacter(node: AccessibilityNode | undefined): boolean {
  const name = node?.name ?? "";
  if (name.length <= 1) return true;
  graphemes ??= new Intl.Segmenter();
  const segments = graphemes.segment(name)[Symbol.iterator]();
  segments.next();
  return segments.next().done === true;
}

/**
 * Tells whether bare text continues the bare text before it on one line. The tree marks no
 * element boundary, so this goes by shape: a single character continues a run of them,
 * punctuation or a space continues any text, and longer text continues after a lone space or
 * when it starts with one, as Chromium splits some sentences into words. A word right after a
 * run stays apart, since example.com starts its next paragraph there.
 *
 * @param previous - Bare text node before, as the tree gives it.
 * @param child - Bare text node that follows.
 * @returns {boolean} Whether the two belong on one line.
 */
function continuesText(previous: AccessibilityNode | undefined, child: AccessibilityNode): boolean {
  if (isOneCharacter(child)) {
    return isOneCharacter(previous) || !/[\p{L}\p{N}]/u.test(child.name ?? "");
  }
  return /^\s?$/u.test(previous?.name ?? "") || /^\s/u.test(child.name ?? "");
}

/**
 * Joins bare text that Chromium split apart and drops bare text with nothing to read. Chromium
 * splits some text into one node per character (example.com gives about 800) and some into
 * words, while text of separate elements stays apart, since joining it would glue words together.
 *
 * @param children - Child nodes in page order.
 * @returns {AccessibilityNode[]} The children with those runs joined.
 */
function joinSplitText(children: readonly AccessibilityNode[]): AccessibilityNode[] {
  const joined: AccessibilityNode[] = [];
  let previous: AccessibilityNode | undefined;
  for (const child of children) {
    const last = joined.at(-1);
    if (
      last !== undefined &&
      isBareText(last) &&
      isBareText(child) &&
      continuesText(previous, child)
    ) {
      joined[joined.length - 1] = {
        role: TEXT_ROLE,
        name: `${last.name ?? ""}${child.name ?? ""}`,
      };
    } else {
      joined.push(child);
    }
    previous = child;
  }
  return joined.filter((child) => !isBareText(child) || sanitizeField(child.name ?? "") !== "");
}

/**
 * Lists the children an outline shows: split text joined, and a lone text child dropped when
 * it only repeats its parent's name, as the text of a link or heading does.
 *
 * @param node - Parent node.
 * @returns {AccessibilityNode[]} Children to write under the node.
 */
function outlineChildren(node: AccessibilityNode): AccessibilityNode[] {
  const children = joinSplitText(node.children ?? []);
  const [only] = children;
  const repeatsName =
    children.length === 1 &&
    only !== undefined &&
    isBareText(only) &&
    sanitizeField(only.name ?? "") === sanitizeField(node.name ?? "");
  return repeatsName ? [] : children;
}

function quoted(value: string): string {
  return JSON.stringify(sanitizeField(value));
}

function outlineProperty(key: string, value: unknown): string {
  const name = sanitizeField(key);
  if (value === true) return name;
  return `${name}=${typeof value === "string" ? quoted(value) : JSON.stringify(value)}`;
}

function outlineLine(node: AccessibilityNode, depth: number): string {
  const parts = [`${"  ".repeat(depth)}- ${sanitizeField(node.role)}`];
  if (node.name) parts.push(quoted(node.name));
  for (const [key, value] of Object.entries(node)) {
    if (key !== "role" && key !== "name" && key !== "children" && value !== undefined) {
      parts.push(outlineProperty(key, value));
    }
  }
  return parts.join(" ");
}

function outlineLines(node: AccessibilityNode, depth: number): string[] {
  return [
    outlineLine(node, depth),
    ...outlineChildren(node).flatMap((child) => outlineLines(child, depth + 1)),
  ];
}

/**
 * Writes an accessibility tree as an indented outline, one node per line: role, quoted name,
 * then the node's states (`checked=false`, `level=2`, `focused`). Text that only repeats its
 * parent's name is left out, and text split into characters or words is joined.
 *
 * @param tree - Root of the tree.
 * @returns {string[]} Outline lines in page order.
 */
export function accessibilityOutline(tree: AccessibilityNode): string[] {
  return outlineLines(tree, 0);
}

/**
 * Reads the accessibility tree of one page through a capable provider.
 *
 * @param params - Page, subtree and provider arguments.
 * @param options - Cancellation.
 * @returns {Promise<{ provider: string; result: AccessibilityTreeResult; tree: AccessibilityNode }>} The provider used, its result and the tree.
 * @throws {InvalidInputError} When `root` gives no tree.
 */
export async function readAccessibilityTree(
  params: Readonly<Omit<BrowserAccessibilityParams, "maxChars">>,
  options?: Readonly<AbortOptions>,
): Promise<{ provider: string; result: AccessibilityTreeResult; tree: AccessibilityNode }> {
  const { name, provider } = await createProvider(
    params.provider,
    params.browser,
    "accessibilityTree",
  );
  const result = await provider.accessibilityTree(params.url, {
    root: params.root,
    interestingOnly: params.interestingOnly,
    signal: options?.signal,
  });
  if (result.tree === null) {
    const url = sanitizeField(params.url);
    if (params.root === undefined) {
      throw new BrowserError(`${name} returned no accessibility tree for ${url}.`);
    }
    // Cloudflare answers null for a root that exists when interestingOnly drops the root itself.
    throw new InvalidInputError(
      params.interestingOnly === true
        ? `root ${quoted(params.root)} gave no tree on ${url}: it matches no element, or interestingOnly dropped that element, as it does a form. Leave interestingOnly out to read the whole subtree.`
        : `root ${quoted(params.root)} matches no element on ${url}. Pass another selector or leave root out to read the whole page.`,
    );
  }
  return { provider: name, result, tree: result.tree };
}

/**
 * Reads a page's accessibility tree and returns it as an outline bounded by `maxChars`, cut at
 * a line break where one fits.
 *
 * @param params - Accessibility tree arguments.
 * @param options - Cancellation.
 * @returns {Promise<ToolResult<BrowserAccessibilityDetails>>} The outline and page metadata.
 */
export async function browserAccessibility(
  params: Readonly<BrowserAccessibilityParams>,
  options?: Readonly<AbortOptions>,
): Promise<ToolResult<BrowserAccessibilityDetails>> {
  const maxChars = resolveMaxChars(params.maxChars);
  const { provider, result, tree } = await readAccessibilityTree(params, options);
  const lines = accessibilityOutline(tree);
  const outline = lines.join("\n");
  const { body, truncation } = cutAt(outline, { maxChars });
  const page = [
    result.statusCode === undefined ? undefined : `status ${result.statusCode}`,
    result.title ? quoted(result.title) : undefined,
  ].filter((part) => part !== undefined);
  const header = `[provider=${provider}] ${sanitizeField(params.url)}${page.length > 0 ? ` (${page.join(", ")})` : ""}: ${lines.length} nodes`;
  return {
    content: content(`${header}\n\n${body}${truncation}`),
    details: {
      url: params.url,
      provider,
      ...(result.title ? { title: result.title } : {}),
      ...(result.statusCode === undefined ? {} : { statusCode: result.statusCode }),
      nodes: lines.length,
      contentLength: outline.length,
    },
  };
}

/** Page tools and their hints, kept by agent harnesses; the text carries the same list. */
export interface BrowserWebMcpToolsDetails {
  url: string;
  provider: string;
  tools: WebMcpTool[];
  /** Characters of the whole listing, before `maxChars` cut it. */
  contentLength: number;
}

/** What one page tool returned, kept by agent harnesses; the text carries its text parts. */
export interface BrowserWebMcpCallDetails {
  url: string;
  provider: string;
  tool: string;
  output: unknown;
  /** Characters of the whole answer text, before `maxChars` cut it. */
  contentLength: number;
}

/** The hints a listing names, in the order it names them. */
const WEBMCP_HINTS = [
  ["readOnly", "read-only"],
  ["untrustedContent", "untrusted content"],
  ["consequential", "consequential"],
] as const;

/**
 * One tool as lines of name and hints, description and schema, each field from the page cleaned.
 *
 * @param tool - A page tool.
 * @returns {string[]} The block's lines.
 */
function webmcpToolLines(tool: Readonly<WebMcpTool>): string[] {
  const hints = WEBMCP_HINTS.filter(([key]) => tool.annotations?.[key] === true).map(
    ([, label]) => label,
  );
  const head = `${sanitizeField(tool.name)}${hints.length > 0 ? ` (${hints.join(", ")})` : ""}`;
  const description = sanitizeField(tool.description);
  const schema = tool.inputSchema ? sanitizeField(JSON.stringify(tool.inputSchema)) : "";
  return [
    head,
    ...(description ? [`  ${description}`] : []),
    ...(schema ? [`  input: ${schema}`] : []),
  ];
}

/**
 * Lists the WebMCP tools one page registers, bounded by `maxChars` between two tools.
 *
 * @param params - Page and provider arguments.
 * @param options - Cancellation.
 * @returns {Promise<ToolResult<BrowserWebMcpToolsDetails>>} The listing and the tools.
 */
export async function browserWebMcpTools(
  params: Readonly<BrowserWebMcpToolsParams>,
  options?: Readonly<AbortOptions>,
): Promise<ToolResult<BrowserWebMcpToolsDetails>> {
  const maxChars = resolveMaxChars(params.maxChars);
  const { name, provider } = await createProvider(params.provider, params.browser, "webmcpTools");
  const { tools } = await provider.webmcpTools(params.url, { signal: options?.signal });
  const listing = tools.map((tool) => webmcpToolLines(tool).join("\n")).join("\n\n");
  const { body, truncation } = cutAt(listing, { maxChars, at: "\n\n" });
  const url = sanitizeField(params.url);
  const header =
    tools.length === 0
      ? `[provider=${name}] ${url}: no WebMCP tools. The page registered none once it loaded.`
      : `[provider=${name}] ${url}: ${tools.length} WebMCP tools`;
  return {
    content: content(tools.length === 0 ? header : `${header}\n\n${body}${truncation}`),
    details: { url: params.url, provider: name, tools, contentLength: listing.length },
  };
}

/**
 * Checks that `input` is a JSON object, the only shape a page tool takes.
 *
 * @param input - The caller's `input`.
 * @returns {Readonly<Record<string, unknown>>} The input, `{}` when left out.
 * @throws {InvalidInputError} For an array, `null` or a primitive.
 */
function webmcpInput(input: unknown): Readonly<Record<string, unknown>> {
  if (input === undefined) return {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new InvalidInputError("input must be a JSON object of the tool's arguments.");
  }
  return input as Readonly<Record<string, unknown>>;
}

/**
 * Runs one page tool and returns its cleaned answer, bounded by `maxChars`.
 *
 * @param params - Page, tool, input and provider arguments.
 * @param options - Cancellation.
 * @returns {Promise<ToolResult<BrowserWebMcpCallDetails>>} The answer and the raw output.
 */
export async function browserWebMcpCall(
  params: Readonly<BrowserWebMcpCallParams>,
  options?: Readonly<AbortOptions>,
): Promise<ToolResult<BrowserWebMcpCallDetails>> {
  const maxChars = resolveMaxChars(params.maxChars);
  const input = webmcpInput(params.input);
  const { name, provider } = await createProvider(params.provider, params.browser, "webmcpCall");
  const result = await provider.webmcpCall(params.url, {
    tool: params.tool,
    input,
    signal: options?.signal,
  });
  const { sanitizeText } = await import("@agntn/tools");
  const text = sanitizeText(result.text);
  const { body, truncation } = cutAt(text, { maxChars });
  const header = `[provider=${name}] ${sanitizeField(params.url)} ${sanitizeField(params.tool)}:`;
  return {
    content: content(`${header}\n\n${body || "(the tool returned no text)"}${truncation}`),
    details: {
      url: params.url,
      provider: name,
      tool: params.tool,
      output: result.output,
      contentLength: text.length,
    },
  };
}

/**
 * Searches the web through Hyperbrowser.
 *
 * @param params - Search arguments.
 * @param options - Cancellation.
 * @returns {Promise<ToolResult<{ results: Array<{ url: string; title: string; snippet: string }> }>>} Normalized search results.
 */
export async function browserSearch(
  params: Readonly<BrowserSearchParams>,
  options?: Readonly<AbortOptions>,
): Promise<ToolResult<{ results: Array<{ url: string; title: string; snippet: string }> }>> {
  const maxResults = resolveSearchMaxResults(params.maxResults);
  const { name, provider } = await createProvider("hyperbrowser", undefined, "search");
  const results = await provider.search(params.query, { maxResults, signal: options?.signal });
  const rows = results.slice(0, maxResults).map((result) => ({
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
