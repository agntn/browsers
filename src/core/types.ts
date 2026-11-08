/** Browser session handle returned by providers. */
export interface BrowserSession {
  id: string;
  cdpUrl?: string;
  provider: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/** Cloudflare Browser Run engine that callers can opt into. */
export type CloudflareBrowser = "kitesurf";

/** Options for session creation. */
export interface CreateSessionOptions {
  region?: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
  profileId?: string;
  timeout?: number;
  proxy?: { server: string; username?: string; password?: string };
  stealth?: boolean;
  captchaSolving?: boolean;
  extra?: Record<string, unknown>;
}

export interface ScrapeResult {
  url: string;
  title?: string;
  html?: string;
  cleanedHtml?: string;
  markdown?: string;
  text?: string;
  statusCode?: number;
  links?: string[];
  screenshot?: string;
  metadata?: Record<string, unknown>;
}

/** Cancellation for one provider call. */
export interface AbortOptions {
  /** Stops the call's requests and temporary browser, and its job where the vendor allows. */
  signal?: AbortSignal;
}

export interface ScrapeOptions extends AbortOptions {
  formats?: ("html" | "markdown" | "text" | "cleanedHtml")[];
  waitFor?: string;
  waitForNetworkIdle?: boolean;
  screenshot?: boolean;
  maxChars?: number;
  timeout?: number;
  script?: string;
  headers?: Record<string, string>;
}

export interface ScreenshotOptions {
  url?: string;
  selector?: string;
  /** CSS selector to wait for after the page loads, so the shot shows the state it marks. */
  waitFor?: string;
  format?: "png" | "jpeg" | "webp";
  quality?: number;
  fullPage?: boolean;
  encoding?: "base64" | "url";
  viewport?: { width: number; height: number };
}

export interface ScreenshotResult {
  data: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface EvaluateResult {
  value: unknown;
  logs?: string[];
}

export interface CrawlResult {
  pages: CrawlPage[];
  totalFound: number;
  jobId?: string;
  status?: "completed" | "running" | "failed";
}

export interface CrawlPage {
  url: string;
  title?: string;
  html?: string;
  markdown?: string;
  text?: string;
  statusCode?: number;
  links?: string[];
  depth?: number;
}

export interface CrawlOptions extends AbortOptions {
  maxDepth?: number;
  maxPages?: number;
  sameDomain?: boolean;
  formats?: ("html" | "markdown" | "text")[];
  waitFor?: string;
  timeout?: number;
}

/** Aborting `signal` stops the wait, never the job: its ID already belongs to the caller. */
export type ResumeCrawlOptions = Pick<CrawlOptions, "timeout" | "signal">;

export interface PdfResult {
  data: string;
  mimeType: string;
}

export interface PdfOptions {
  format?: "A4" | "Letter" | "Legal";
  landscape?: boolean;
  printBackground?: boolean;
  css?: string;
  timeout?: number;
}

export interface WebSearchResult {
  url: string;
  title: string;
  snippet: string;
  score?: number;
  publishedDate?: string;
}

export interface WebSearchOptions extends AbortOptions {
  maxResults?: number;
  includeDomains?: string[];
}

export interface ExtractResult {
  url: string;
  data: unknown;
  markdown?: string;
  usage?: { input?: number; output?: number };
}

export interface ExtractOptions extends AbortOptions {
  schema?: Record<string, unknown>;
  prompt?: string;
  timeout?: number;
}

export interface LinksResult {
  url: string;
  links: LinkItem[];
}

export interface LinkItem {
  href: string;
  text?: string;
  rel?: string;
}

/**
 * One node of a page's accessibility tree, as Chromium serializes it. Besides the role and
 * name a node carries only the states that apply to it, such as `checked`, `disabled`,
 * `level` or `valuemax`.
 */
export interface AccessibilityNode {
  readonly role: string;
  readonly name?: string;
  readonly value?: string | number;
  readonly description?: string;
  readonly children?: readonly AccessibilityNode[];
  readonly [property: string]: unknown;
}

export interface AccessibilityTreeOptions extends AbortOptions {
  /** CSS selector of the element whose subtree to read instead of the whole page. */
  root?: string;
  /**
   * Drop generic and presentational nodes. Cloudflare drops them by default for the whole page
   * and keeps them under `root`; with `root` and true it returns no tree for a root element
   * that is such a node itself.
   */
  interestingOnly?: boolean;
}

export interface AccessibilityTreeResult {
  url: string;
  title?: string;
  statusCode?: number;
  /** The tree, or null when `root` gives none: it matches no element, or the options dropped it. */
  tree: AccessibilityNode | null;
}

/** Declares which optional operations a provider supports. */
export interface ProviderCapabilities {
  scrape: boolean;
  screenshot: boolean;
  navigate: boolean;
  evaluate: boolean;
  sessions: boolean;
  cdp: boolean;
  statelessScrape: boolean;
  statelessScreenshot: boolean;
  /** Screenshot can capture the one element `selector` names. Missing means it cannot. */
  elementScreenshot?: boolean;
  /** Screenshot can wait for the `waitFor` selector before the shot. Missing means it cannot. */
  screenshotWaitFor?: boolean;
  /** Scrape can wait for the `waitFor` selector before reading. Missing means it cannot. */
  scrapeWaitFor?: boolean;
  crawl: boolean;
  pdf: boolean;
  links: boolean;
  search: boolean;
  extract: boolean;
  /** Reads a page's accessibility tree. Missing means it cannot. */
  accessibilityTree?: boolean;
}

export interface BrowserProvider {
  name(): string;

  /** Return capability flags for this provider. */
  capabilities(): ProviderCapabilities;

  createSession(options?: CreateSessionOptions): Promise<BrowserSession>;
  getSession(sessionId: string): Promise<BrowserSession | null>;
  listSessions(): Promise<BrowserSession[]>;
  releaseSession(sessionId: string): Promise<void>;

  scrape(url: string, options?: ScrapeOptions, session?: BrowserSession): Promise<ScrapeResult>;
  screenshot(options: ScreenshotOptions, session?: BrowserSession): Promise<ScreenshotResult>;
  navigate(url: string, session: BrowserSession): Promise<void>;
  evaluate(script: string, session: BrowserSession): Promise<EvaluateResult>;

  crawl?(url: string, options?: CrawlOptions, session?: BrowserSession): Promise<CrawlResult>;
  /** Wait for a crawl job an earlier `crawl` returned and read its pages, without starting another. */
  resumeCrawl?(jobId: string, options?: ResumeCrawlOptions): Promise<CrawlResult>;
  pdf?(url: string, options?: PdfOptions, session?: BrowserSession): Promise<PdfResult>;
  search?(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]>;
  extract?(url: string, options?: ExtractOptions, session?: BrowserSession): Promise<ExtractResult>;
  links?(
    url: string,
    session?: BrowserSession,
    options?: Readonly<AbortOptions>,
  ): Promise<LinksResult>;
  accessibilityTree?(
    url: string,
    options?: Readonly<AccessibilityTreeOptions>,
    session?: BrowserSession,
  ): Promise<AccessibilityTreeResult>;

  getCdpUrl?(session: BrowserSession): string | undefined;
  /** Resolves when the provider answers with this config, rejects with the error saying why not. */
  checkAvailability?(): Promise<void>;
}

export interface ProviderConfig {
  apiKey?: string;
  accountID?: string;
  baseURL?: string;
  browser?: CloudflareBrowser;
}

export type BrowserProviderFactory = (config: ProviderConfig) => BrowserProvider;

export interface ClientOptions {
  maxRetries?: number;
  baseDelay?: number;
  timeout?: number;
  userAgent?: string;
  /** Says `false` when the body is already the final answer, so asking again is pointless. */
  retryable?: (failure: Readonly<{ status: number; body: string }>) => boolean;
}
