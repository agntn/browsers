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
import { AuthError, BrowserError, normalizeError } from "../core/errors";
import {
  isNotFoundError,
  assertNoSelector,
  assertUrlOrSession,
  imageMimeType,
  notSupportedViaRest,
} from "../core/utils";

/** Every Anchor response wraps its payload in `data`. */
interface AnchorEnvelope<T> {
  data?: T;
}

interface AnchorCreatedSession {
  id?: string;
  cdp_url?: string;
  live_view_url?: string;
}

/**
 * Session status as the status routes report it. The single-session route
 * also carries an `id`, which is the record ID and not the session ID.
 */
interface AnchorSessionStatus {
  session_id?: string;
  status?: string;
  created_at?: string;
}

interface AnchorSessionList {
  count?: number;
  items?: AnchorSessionStatus[];
}

/**
 * Session section of the create body: proxy and lifetime.
 *
 * @param {CreateSessionOptions} options Session options.
 * @returns {Record<string, unknown>} Anchor `session` settings.
 */
function sessionConfig(options: CreateSessionOptions): Record<string, unknown> {
  const session: Record<string, unknown> = {};
  if (options.proxy) session.proxy = { type: "custom", active: true, ...options.proxy };
  if (options.timeout !== undefined) {
    session.timeout = { max_duration: Math.ceil(options.timeout / 60_000) };
  }
  return session;
}

/**
 * Browser section of the create body: window, profile and evasion toggles.
 *
 * @param {CreateSessionOptions} options Session options.
 * @returns {Record<string, unknown>} Anchor `browser` settings.
 */
function browserConfig(options: CreateSessionOptions): Record<string, unknown> {
  const browser: Record<string, unknown> = {};
  if (options.headless !== undefined) browser.headless = { active: options.headless };
  if (options.viewport) browser.viewport = options.viewport;
  if (options.profileId) browser.profile = { name: options.profileId };
  if (options.stealth) browser.extra_stealth = { active: true };
  if (options.captchaSolving) browser.captcha_solver = { active: true };
  return browser;
}

/**
 * Builds the nested body Anchor reads: session settings under `session`,
 * browser settings under `browser`. Flat keys are ignored by the API without
 * an error, so `extra` is merged one level deep into both sections.
 *
 * @param {CreateSessionOptions} [options] Session options.
 * @returns {Record<string, unknown>} Request body for `POST /v1/sessions`.
 */
function createSessionBody(options?: CreateSessionOptions): Record<string, unknown> {
  if (!options) return {};
  const { session: extraSession, browser: extraBrowser, ...extra } = options.extra ?? {};
  const session = Object.assign(sessionConfig(options), extraSession);
  const browser = Object.assign(browserConfig(options), extraBrowser);

  const body: Record<string, unknown> = { ...extra };
  if (Object.keys(session).length > 0) body.session = session;
  if (Object.keys(browser).length > 0) body.browser = browser;
  return body;
}

/**
 * Maps a status record onto a session. Anchor does not return the CDP URL
 * after creation, so only `createSession` can fill it.
 *
 * @param {AnchorSessionStatus} status Status record from the API.
 * @param {string} [fallbackId] Session ID the caller asked for.
 * @returns {BrowserSession} Session without a CDP URL.
 */
function toSession(status: Readonly<AnchorSessionStatus>, fallbackId?: string): BrowserSession {
  return {
    id: status.session_id ?? fallbackId ?? "",
    cdpUrl: undefined,
    provider: "anchor",
    createdAt: status.created_at ? new Date(status.created_at).getTime() : Date.now(),
    metadata: { status: status.status },
  };
}

class AnchorProvider implements BrowserProvider {
  private readonly client: Client;
  private readonly baseURL: string;
  private readonly apiKey: string;

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new AuthError("Missing API key for Anchor Browser. Set ANCHOR_API_KEY", "anchor");
    }
    this.client = defaultClient();
    this.baseURL = (config.baseURL ?? "https://api.anchorbrowser.io").replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  name(): string {
    return "anchor";
  }

  /**
   * The screenshot tool accepts a bare URL, but a call without a session
   * leaves a two-minute session running on the account, so the executors
   * open and release their own instead.
   *
   * @returns {ProviderCapabilities} What Anchor does over REST.
   */
  capabilities(): ProviderCapabilities {
    return {
      scrape: false,
      screenshot: true,
      navigate: false,
      evaluate: false,
      sessions: true,
      cdp: true,
      statelessScrape: false,
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
      "anchor-api-key": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const res = await this.client.postJSON<AnchorEnvelope<AnchorCreatedSession>>(
        `${this.baseURL}/v1/sessions`,
        createSessionBody(options),
        this.headers(),
      );
      const data = res.data ?? {};
      if (!data.id) throw new BrowserError("Anchor returned a session without an ID");

      return {
        id: data.id,
        cdpUrl: data.cdp_url,
        provider: "anchor",
        createdAt: Date.now(),
        metadata: { liveViewUrl: data.live_view_url },
      };
    } catch (error) {
      throw normalizeError(error, "anchor");
    }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    try {
      const res = await this.client.getJSON<AnchorEnvelope<AnchorSessionStatus>>(
        `${this.baseURL}/v1/sessions/${sessionId}`,
        this.headers(),
      );
      return toSession(res.data ?? {}, sessionId);
    } catch (error: unknown) {
      if (isNotFoundError(error)) return null;
      throw normalizeError(error, "anchor");
    }
  }

  async listSessions(): Promise<BrowserSession[]> {
    try {
      const res = await this.client.getJSON<AnchorEnvelope<AnchorSessionList>>(
        `${this.baseURL}/v1/sessions/all/status`,
        this.headers(),
      );
      return (res.data?.items ?? []).map((status) => toSession(status));
    } catch {
      return [];
    }
  }

  async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.client.deleteJSON(`${this.baseURL}/v1/sessions/${sessionId}`, this.headers());
    } catch (error) {
      throw normalizeError(error, "anchor");
    }
  }

  async scrape(
    _url: string,
    _options?: ScrapeOptions,
    _session?: BrowserSession,
  ): Promise<ScrapeResult> {
    notSupportedViaRest("anchor", "scrape");
  }

  async screenshot(
    options: ScreenshotOptions,
    session?: BrowserSession,
  ): Promise<ScreenshotResult> {
    try {
      assertUrlOrSession(options.url, session, "anchor", "screenshot");
      assertNoSelector(options.selector, "anchor");
      const body: Record<string, unknown> = { capture_full_height: options.fullPage ?? true };
      if (options.url) body.url = options.url;
      if (options.quality !== undefined) body.image_quality = options.quality;

      const query = session ? `?sessionId=${encodeURIComponent(session.id)}` : "";
      const res = await this.client.postResponse(
        `${this.baseURL}/v1/tools/screenshot${query}`,
        body,
        this.headers(),
      );
      const image = Buffer.from(await res.arrayBuffer());
      const mimeType = imageMimeType(image, res.headers.get("content-type") ?? "");

      return {
        data: `data:${mimeType};base64,${image.toString("base64")}`,
        mimeType,
      };
    } catch (error) {
      throw normalizeError(error, "anchor");
    }
  }

  async navigate(_url: string, _session: BrowserSession): Promise<void> {
    notSupportedViaRest("anchor", "navigate");
  }

  async evaluate(_script: string, _session: BrowserSession): Promise<EvaluateResult> {
    notSupportedViaRest("anchor", "evaluate");
  }

  getCdpUrl(session: BrowserSession): string | undefined {
    return session.cdpUrl;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.getJSON<AnchorEnvelope<AnchorSessionList>>(
        `${this.baseURL}/v1/sessions/all/status`,
        this.headers(),
      );
      return true;
    } catch {
      return false;
    }
  }
}

export const factory: BrowserProviderFactory = (config) => new AnchorProvider(config);
