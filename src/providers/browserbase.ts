import type {
  BrowserProvider,
  BrowserSession,
  CreateSessionOptions,
  ScrapeResult,
  ScrapeOptions,
  ScreenshotResult,
  ScreenshotOptions,
  EvaluateResult,
  ProviderConfig,
  BrowserProviderFactory,
  ProviderCapabilities,
} from "../core/types.ts";
import { rejectBlockPage } from "../core/block-page.ts";
import { defaultClient } from "../core/client.ts";
import type { Client } from "../core/client.ts";
import { AuthError, normalizeError } from "../core/errors.ts";
import { isNotFoundError, notSupportedViaRest } from "../core/utils.ts";

interface BrowserbaseSessionResponse {
  id: string;
  connectUrl?: string;
  status?: string;
  createdAt?: string;
  [key: string]: unknown;
}

interface BrowserbaseFetchResponse {
  statusCode?: number;
  contentType?: string;
  content?: unknown;
}

function textOf(res?: Readonly<BrowserbaseFetchResponse>): string | undefined {
  return typeof res?.content === "string" ? res.content : undefined;
}

function toScrapeResult(
  url: string,
  page?: Readonly<BrowserbaseFetchResponse>,
  markdown?: Readonly<BrowserbaseFetchResponse>,
): ScrapeResult {
  return {
    url,
    html: page?.contentType?.includes("html") ? textOf(page) : undefined,
    markdown: textOf(markdown),
    statusCode: (page ?? markdown)?.statusCode,
  };
}

function createSessionBody(options?: CreateSessionOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (options?.region) body.region = options.region;
  if (options?.proxy) body.proxy = options.proxy;
  if (options?.stealth) body.stealth = options.stealth;
  if (options?.extra) Object.assign(body, options.extra);
  return body;
}

class BrowserbaseProvider implements BrowserProvider {
  private readonly client: Client;
  private readonly baseURL: string;
  private readonly apiKey: string;

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new AuthError(
        "Missing API key for Browserbase. Set BROWSERBASE_API_KEY",
        "browserbase",
      );
    }
    this.client = defaultClient();
    this.baseURL = (config.baseURL ?? "https://api.browserbase.com").replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  name(): string {
    return "browserbase";
  }

  capabilities(): ProviderCapabilities {
    return {
      scrape: true,
      screenshot: false,
      navigate: false,
      evaluate: false,
      sessions: true,
      cdp: true,
      statelessScrape: true,
      statelessScreenshot: false,
      elementScreenshot: false,
      crawl: false,
      pdf: false,
      links: false,
      search: false,
      extract: false,
    };
  }

  private headers(): Record<string, string> {
    return {
      "X-BB-API-Key": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const res = await this.client.postJSON<BrowserbaseSessionResponse>(
        `${this.baseURL}/v1/sessions`,
        createSessionBody(options),
        this.headers(),
      );

      return {
        id: res.id,
        cdpUrl: res.connectUrl,
        provider: "browserbase",
        createdAt: Date.now(),
        metadata: { status: res.status },
      };
    } catch (error) {
      throw normalizeError(error, "browserbase");
    }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    try {
      const res = await this.client.getJSON<BrowserbaseSessionResponse>(
        `${this.baseURL}/v1/sessions/${sessionId}`,
        this.headers(),
      );
      return {
        id: res.id,
        cdpUrl: res.connectUrl,
        provider: "browserbase",
        createdAt: res.createdAt ? new Date(res.createdAt).getTime() : Date.now(),
        metadata: { status: res.status },
      };
    } catch (error: unknown) {
      if (isNotFoundError(error)) return null;
      throw normalizeError(error, "browserbase");
    }
  }

  async listSessions(): Promise<BrowserSession[]> {
    const res = await this.client.getJSON<BrowserbaseSessionResponse[]>(
      `${this.baseURL}/v1/sessions`,
      this.headers(),
    );
    return res.map((s) => ({
      id: s.id,
      cdpUrl: s.connectUrl,
      provider: "browserbase",
      createdAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
      metadata: { status: s.status },
    }));
  }

  /**
   * Release a session through Browserbase's status update endpoint.
   *
   * @param {string} sessionId Session identifier.
   */
  async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.client.postJSON(
        `${this.baseURL}/v1/sessions/${sessionId}`,
        { status: "REQUEST_RELEASE" },
        this.headers(),
      );
    } catch (error) {
      throw normalizeError(error, "browserbase");
    }
  }

  private fetchPage(url: string, format: "raw" | "markdown"): Promise<BrowserbaseFetchResponse> {
    return this.client.postJSON<BrowserbaseFetchResponse>(
      `${this.baseURL}/v1/fetch`,
      { url, format },
      this.headers(),
    );
  }

  private async fetchPages(
    url: string,
    formats: Readonly<NonNullable<ScrapeOptions["formats"]>> = [],
  ): Promise<(BrowserbaseFetchResponse | undefined)[]> {
    const wantsHtml = formats.includes("html");
    const settled = await Promise.allSettled([
      wantsHtml ? this.fetchPage(url, "raw") : undefined,
      formats.includes("markdown") || !wantsHtml ? this.fetchPage(url, "markdown") : undefined,
    ]);
    const pages = settled.map((r) => (r.status === "fulfilled" ? r.value : undefined));
    if (pages.every((page) => !page)) {
      throw settled.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
    }
    return pages;
  }

  async scrape(
    url: string,
    options?: ScrapeOptions,
    _session?: BrowserSession,
  ): Promise<ScrapeResult> {
    try {
      const [page, markdown] = await this.fetchPages(url, options?.formats);
      return rejectBlockPage(toScrapeResult(url, page, markdown), "browserbase");
    } catch (error) {
      throw normalizeError(error, "browserbase");
    }
  }

  /**
   * Browserbase has no screenshot route; screenshots go over the session's CDP URL.
   *
   * @param {ScreenshotOptions} _options Screenshot options.
   * @param {BrowserSession} [_session] Browser session.
   * @returns {Promise<ScreenshotResult>} Never; the call always throws.
   */
  async screenshot(
    _options: ScreenshotOptions,
    _session?: BrowserSession,
  ): Promise<ScreenshotResult> {
    notSupportedViaRest("browserbase", "screenshot");
  }

  async navigate(_url: string, _session: BrowserSession): Promise<void> {
    notSupportedViaRest("browserbase", "navigate");
  }

  async evaluate(_script: string, _session: BrowserSession): Promise<EvaluateResult> {
    notSupportedViaRest("browserbase", "evaluate");
  }

  getCdpUrl(session: BrowserSession): string {
    if (session.cdpUrl) return session.cdpUrl;
    return `wss://connect.browserbase.com?sessionId=${session.id}`;
  }

  async checkAvailability(): Promise<void> {
    try {
      await this.client.getJSON<Record<string, unknown>>(
        `${this.baseURL}/v1/sessions`,
        this.headers(),
      );
    } catch (error) {
      throw normalizeError(error, "browserbase");
    }
  }
}

export const factory: BrowserProviderFactory = (config) => new BrowserbaseProvider(config);
