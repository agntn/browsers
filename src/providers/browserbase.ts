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
} from "../core/types";
import { defaultClient } from "../core/client";
import type { Client } from "../core/client";
import { AuthError, normalizeError } from "../core/errors";
import { register } from "../core/registry";
import { isNotFoundError, assertSessionId, notSupportedViaRest } from "../core/utils";

interface BrowserbaseSessionResponse {
  id: string;
  connectUrl?: string;
  status?: string;
  createdAt?: string;
  [key: string]: unknown;
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
      screenshot: true,
      navigate: false,
      evaluate: false,
      sessions: true,
      cdp: true,
      statelessScrape: true,
      statelessScreenshot: false,
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

  async scrape(
    url: string,
    _options?: ScrapeOptions,
    _session?: BrowserSession,
  ): Promise<ScrapeResult> {
    try {
      const body: Record<string, unknown> = { url, format: "markdown" };

      const res = await this.client.postJSON<Record<string, unknown>>(
        `${this.baseURL}/v1/fetch`,
        body,
        this.headers(),
      );

      return {
        url,
        html: res.content as string | undefined,
        markdown: typeof res.content === "string" ? res.content : undefined,
        statusCode: res.statusCode as number | undefined,
      };
    } catch (error) {
      throw normalizeError(error, "browserbase");
    }
  }

  async screenshot(
    options: ScreenshotOptions,
    session?: BrowserSession,
  ): Promise<ScreenshotResult> {
    try {
      assertSessionId(session?.id, "browserbase", "screenshot");
      const body: Record<string, unknown> = {
        sessionId: session.id,
        fullPage: options.fullPage ?? true,
        format: options.format ?? "png",
      };
      if (options.selector) body.selector = options.selector;

      const res = await this.client.postJSON<{ data?: string; screenshot?: string }>(
        `${this.baseURL}/v1/screenshot`,
        body,
        this.headers(),
      );

      return {
        data: res.data ?? res.screenshot ?? "",
        mimeType: `image/${options.format ?? "png"}`,
      };
    } catch (error) {
      throw normalizeError(error, "browserbase");
    }
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

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.getJSON<Record<string, unknown>>(
        `${this.baseURL}/v1/sessions`,
        this.headers(),
      );
      return true;
    } catch {
      return false;
    }
  }
}

const factory: BrowserProviderFactory = (config) => new BrowserbaseProvider(config);
register("browserbase", "https://api.browserbase.com", factory);
