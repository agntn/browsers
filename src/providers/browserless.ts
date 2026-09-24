import type {
  BrowserProvider,
  BrowserSession,
  CreateSessionOptions,
  ScrapeResult,
  ScrapeOptions,
  ScreenshotResult,
  ScreenshotOptions,
  EvaluateResult,
  PdfResult,
  PdfOptions,
  ProviderConfig,
  BrowserProviderFactory,
  ProviderCapabilities,
} from "../core/types";
import { defaultClient } from "../core/client";
import type { Client } from "../core/client";
import { AuthError, normalizeError, SessionNotFoundError } from "../core/errors";
import { assertUrlOrSession } from "../core/utils";

interface BrowserlessSessionResponse {
  readonly id?: string;
  readonly connect?: string;
  readonly stop?: string;
}

interface BrowserlessSessionRecord {
  readonly session: BrowserSession;
  readonly stopUrl: string;
}

const browserlessSessionStores = new Map<string, Map<string, BrowserlessSessionRecord>>();

function createSessionBody(options?: CreateSessionOptions): Record<string, unknown> {
  const body: Record<string, unknown> = { ttl: options?.timeout ?? 300_000 };
  if (options?.proxy) body.proxy = options.proxy.server;
  if (options?.stealth) body.stealth = true;
  if (options?.extra) Object.assign(body, options.extra);
  return body;
}

class BrowserlessProvider implements BrowserProvider {
  private readonly client: Client;
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly sessionStoreKey: string;

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new AuthError(
        "Missing API key for Browserless. Set BROWSERLESS_API_KEY",
        "browserless",
      );
    }
    this.client = defaultClient();
    this.baseURL = (config.baseURL ?? "https://chrome.browserless.io").replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.sessionStoreKey = `${this.baseURL}\0${this.apiKey}`;
  }

  name(): string {
    return "browserless";
  }

  capabilities(): ProviderCapabilities {
    return {
      scrape: true,
      screenshot: true,
      navigate: true,
      evaluate: true,
      sessions: true,
      cdp: true,
      statelessScrape: true,
      statelessScreenshot: true,
      elementScreenshot: true,
      crawl: false,
      pdf: true,
      links: false,
      search: false,
      extract: false,
    };
  }

  private tokenParam(): string {
    return `token=${this.apiKey}`;
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const res = await this.client.postJSON<BrowserlessSessionResponse>(
        `${this.baseURL}/session?${this.tokenParam()}`,
        createSessionBody(options),
        { "Content-Type": "application/json" },
      );
      if (!res.id || !res.connect || !res.stop) {
        throw new Error("Browserless session response is missing lifecycle URLs");
      }

      const session: BrowserSession = {
        id: res.id,
        cdpUrl: res.connect,
        provider: "browserless",
        createdAt: Date.now(),
      };
      const sessionStore =
        browserlessSessionStores.get(this.sessionStoreKey) ??
        new Map<string, BrowserlessSessionRecord>();
      sessionStore.set(res.id, { session, stopUrl: res.stop });
      browserlessSessionStores.set(this.sessionStoreKey, sessionStore);
      return { ...session };
    } catch (error) {
      throw normalizeError(error, "browserless");
    }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    const record = browserlessSessionStores.get(this.sessionStoreKey)?.get(sessionId);
    return record ? { ...record.session } : null;
  }

  async listSessions(): Promise<BrowserSession[]> {
    const sessionStore = browserlessSessionStores.get(this.sessionStoreKey);
    return sessionStore ? Array.from(sessionStore.values(), ({ session }) => ({ ...session })) : [];
  }

  async releaseSession(sessionId: string): Promise<void> {
    const sessionStore = browserlessSessionStores.get(this.sessionStoreKey);
    if (!sessionStore) throw new SessionNotFoundError(sessionId, "browserless");
    const record = sessionStore.get(sessionId);
    if (!record) throw new SessionNotFoundError(sessionId, "browserless");

    try {
      await this.client.deleteJSON(record.stopUrl);
      sessionStore.delete(sessionId);
      if (sessionStore.size === 0) browserlessSessionStores.delete(this.sessionStoreKey);
    } catch (error) {
      throw normalizeError(error, "browserless");
    }
  }

  async scrape(
    url: string,
    _options?: ScrapeOptions,
    _session?: BrowserSession,
  ): Promise<ScrapeResult> {
    try {
      const html = await this.client.postText(
        `${this.baseURL}/content?${this.tokenParam()}`,
        { url },
        { "Content-Type": "application/json" },
      );
      return { url, html };
    } catch (error) {
      throw normalizeError(error, "browserless");
    }
  }

  async screenshot(
    options: ScreenshotOptions,
    session?: BrowserSession,
  ): Promise<ScreenshotResult> {
    try {
      if (!options.url && !session?.id) {
        assertUrlOrSession(options.url, session, "browserless", "screenshot");
      }

      const body: Record<string, unknown> = {};
      if (options.url) body.url = options.url;
      if (options.selector !== undefined) body.selector = options.selector;

      const png = await this.client.postRaw(
        `${this.baseURL}/screenshot?${this.tokenParam()}`,
        body,
        { "Content-Type": "application/json" },
      );

      return {
        data: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
        mimeType: "image/png",
      };
    } catch (error) {
      throw normalizeError(error, "browserless");
    }
  }

  async navigate(url: string, session: BrowserSession): Promise<void> {
    await this.evaluate(`await page.goto(${JSON.stringify(url)})`, session);
  }

  async evaluate(script: string, _session: BrowserSession): Promise<EvaluateResult> {
    try {
      const res = await this.client.postJSON<{ data?: unknown }>(
        `${this.baseURL}/function?${this.tokenParam()}`,
        { code: script },
        { "Content-Type": "application/json" },
      );
      return { value: res.data };
    } catch (error) {
      throw normalizeError(error, "browserless");
    }
  }

  getCdpUrl(session: BrowserSession): string {
    if (session.cdpUrl) return session.cdpUrl;
    return `wss://chrome.browserless.io?token=${this.apiKey}`;
  }

  async pdf(url: string, options?: PdfOptions, _session?: BrowserSession): Promise<PdfResult> {
    try {
      const body: Record<string, unknown> = { url };
      if (options?.landscape !== undefined) body.landscape = options.landscape;
      if (options?.printBackground !== undefined) body.printBackground = options.printBackground;

      const pdf = await this.client.postRaw(`${this.baseURL}/pdf?${this.tokenParam()}`, body, {
        "Content-Type": "application/json",
      });
      return {
        data: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`,
        mimeType: "application/pdf",
      };
    } catch (error) {
      throw normalizeError(error, "browserless");
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.getJSON<{ status?: string }>(`${this.baseURL}/stats?${this.tokenParam()}`);
      return true;
    } catch {
      return false;
    }
  }
}

export const factory: BrowserProviderFactory = (config) => new BrowserlessProvider(config);
