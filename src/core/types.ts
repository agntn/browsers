/** Browser session handle returned by providers. */
export interface BrowserSession {
  /** Provider-specific session identifier. */
  id: string
  /** CDP WebSocket URL for Puppeteer/Playwright connection. */
  cdpUrl?: string
  /** Provider name that created this session. */
  provider: string
  /** Session creation timestamp. */
  createdAt: number
  /** Provider-specific metadata (region, proxy, fingerprint, etc.). */
  metadata?: Record<string, unknown>
}

/** Options for session creation. */
export interface CreateSessionOptions {
  /** Preferred region (e.g. 'us-east-1', 'eu-west-1'). */
  region?: string
  /** Run headless (default true). */
  headless?: boolean
  /** Browser dimensions. */
  viewport?: { width: number; height: number }
  /** Reuse a persistent profile/cookie set by name. */
  profileId?: string
  /** Timeout in ms for session creation. */
  timeout?: number
  /** Proxy configuration. */
  proxy?: {
    server: string
    username?: string
    password?: string
  }
  /** Enable stealth/anti-bot features. */
  stealth?: boolean
  /** Solve CAPTCHAs automatically if provider supports it. */
  captchaSolving?: boolean
  /** Provider-specific extensions to this options bag. */
  extra?: Record<string, unknown>
}

/** Content extracted from a page. */
export interface ScrapeResult {
  /** Resolved page URL after redirects. */
  url: string
  /** Page title. */
  title?: string
  /** Full HTML. */
  html?: string
  /** Cleaned HTML (scripts/styles removed). */
  cleanedHtml?: string
  /** Markdown conversion of page content. */
  markdown?: string
  /** Plain-text readability extraction. */
  text?: string
  /** HTTP status code of the page load. */
  statusCode?: number
  /** Extracted outbound links. */
  links?: string[]
  /** Screenshot of the page as base64 or URL. */
  screenshot?: string
  /** Provider-specific metadata. */
  metadata?: Record<string, unknown>
}

/** Options for scraping a URL. */
export interface ScrapeOptions {
  /** Content format(s) to return. Default: all available. */
  formats?: ('html' | 'markdown' | 'text' | 'cleanedHtml')[]
  /** Wait for a CSS selector before extraction. */
  waitFor?: string
  /** Wait for network idle before extraction. */
  waitForNetworkIdle?: boolean
  /** Include a screenshot in the result. */
  screenshot?: boolean
  /** Maximum content length in chars. */
  maxChars?: number
  /** Request timeout in ms. */
  timeout?: number
  /** JavaScript to execute before extraction. */
  script?: string
  /** Custom headers for the page request. */
  headers?: Record<string, string>
}

/** Options for taking a screenshot. */
export interface ScreenshotOptions {
  /** CSS selector to screenshot (default: full page). */
  selector?: string
  /** Output format. */
  format?: 'png' | 'jpeg' | 'webp'
  /** JPEG/WebP quality 0-100. */
  quality?: number
  /** Full page (beyond viewport). */
  fullPage?: boolean
  /** Base64 or URL return. */
  encoding?: 'base64' | 'url'
}

/** Result of a screenshot capture. */
export interface ScreenshotResult {
  /** Screenshot as base64 data URL or hosted URL. */
  data: string
  /** MIME type of the screenshot. */
  mimeType: string
  /** Width in pixels. */
  width?: number
  /** Height in pixels. */
  height?: number
}

/** Result of JS evaluation. */
export interface EvaluateResult {
  /** Return value of the script. */
  value: unknown
  /** Console logs captured during execution. */
  logs?: string[]
}

/** A browser-as-a-service provider. */
export interface BrowserProvider {
  /** Unique provider name. */
  name(): string

  /** Create a new browser session. */
  createSession(options?: CreateSessionOptions): Promise<BrowserSession>

  /** Get an existing session by ID. */
  getSession(sessionId: string): Promise<BrowserSession | null>

  /** List active sessions. */
  listSessions(): Promise<BrowserSession[]>

  /** Release/destroy a session. */
  releaseSession(sessionId: string): Promise<void>

  /** Scrape content from a URL (may use session or stateless endpoint). */
  scrape(url: string, options?: ScrapeOptions, session?: BrowserSession): Promise<ScrapeResult>

  /** Take a screenshot (session required for most providers). */
  screenshot(options: ScreenshotOptions, session: BrowserSession): Promise<ScreenshotResult>

  /** Navigate session to URL. */
  navigate(url: string, session: BrowserSession): Promise<void>

  /** Execute JavaScript in the session page. */
  evaluate(script: string, session: BrowserSession): Promise<EvaluateResult>

  /** Get CDP WebSocket URL for the session. */
  getCdpUrl?(session: BrowserSession): string | undefined

  /** Optional reachability probe. */
  isAvailable?(): Promise<boolean>
}

export interface ProviderConfig {
  apiKey?: string
  baseURL?: string
}

export type BrowserProviderFactory = (config: ProviderConfig) => BrowserProvider

export interface ClientOptions {
  maxRetries?: number
  baseDelay?: number
  timeout?: number
  userAgent?: string
}
