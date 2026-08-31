/** Browser session handle returned by providers. */
export interface BrowserSession {
  id: string;
  cdpUrl?: string;
  provider: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

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

export interface ScrapeOptions {
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
  format?: "png" | "jpeg" | "webp";
  quality?: number;
  fullPage?: boolean;
  encoding?: "base64" | "url";
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

export interface CrawlOptions {
  maxDepth?: number;
  maxPages?: number;
  sameDomain?: boolean;
  formats?: ("html" | "markdown" | "text")[];
  waitFor?: string;
  timeout?: number;
}

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

export interface WebSearchOptions {
  maxResults?: number;
  includeDomains?: string[];
}

export interface ExtractResult {
  url: string;
  data: unknown;
  markdown?: string;
  usage?: { input?: number; output?: number };
}

export interface ExtractOptions {
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
  crawl: boolean;
  pdf: boolean;
  links: boolean;
  search: boolean;
  extract: boolean;
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
  pdf?(url: string, options?: PdfOptions, session?: BrowserSession): Promise<PdfResult>;
  search?(query: string, options?: WebSearchOptions): Promise<WebSearchResult[]>;
  extract?(url: string, options?: ExtractOptions, session?: BrowserSession): Promise<ExtractResult>;
  links?(url: string, session?: BrowserSession): Promise<LinksResult>;

  getCdpUrl?(session: BrowserSession): string | undefined;
  isAvailable?(): Promise<boolean>;
}

export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
}

export type BrowserProviderFactory = (config: ProviderConfig) => BrowserProvider;

export interface ClientOptions {
  maxRetries?: number;
  baseDelay?: number;
  timeout?: number;
  userAgent?: string;
}
