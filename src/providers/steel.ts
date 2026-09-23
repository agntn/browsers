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
  assertSessionId,
  imageMimeType,
  notSupportedViaRest,
} from "../core/utils";

interface SteelSessionResponse {
  readonly id: string;
  readonly websocketUrl?: string;
  readonly status?: string;
  readonly createdAt?: string;
  readonly [key: string]: unknown;
}

interface SteelScrapeResponse {
  readonly content?: {
    readonly html?: string;
    readonly markdown?: string;
    readonly cleaned_html?: string;
    readonly readability?: string;
  };
  readonly metadata?: {
    readonly status_code?: number;
    readonly title?: string;
  };
  readonly links?: readonly string[];
  readonly [key: string]: unknown;
}

function createSessionBody(options?: CreateSessionOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (!options) return body;
  if (options.region) body.proxy_region = options.region;
  if (options.stealth) body.stealth = true;
  if (options.timeout) body.timeout = options.timeout;
  if (options.proxy) body.proxy = options.proxy;
  if (options.profileId) body.profiles = [options.profileId];
  if (options.captchaSolving) body.solve_captchas = true;
  if (options.extra) Object.assign(body, options.extra);
  return body;
}

function createScrapeBody(url: string, options?: ScrapeOptions): Record<string, unknown> {
  const body: Record<string, unknown> = { url };
  if (!options) return body;
  if (options.waitFor) body.waitFor = options.waitFor;
  if (options.headers) body.headers = options.headers;
  return body;
}

function isCloudflareChallenge(response: SteelScrapeResponse): boolean {
  return (
    response.metadata?.title?.trim().toLowerCase() === "just a moment..." &&
    response.content?.html?.includes("challenges.cloudflare.com") === true
  );
}

function toScrapeResult(url: string, response: SteelScrapeResponse): ScrapeResult {
  if (isCloudflareChallenge(response)) {
    throw new BrowserError("Steel returned a Cloudflare challenge instead of page content");
  }
  return {
    url,
    title: response.metadata?.title,
    html: response.content?.html,
    cleanedHtml: response.content?.cleaned_html,
    markdown: response.content?.markdown,
    text: response.content?.readability,
    statusCode: response.metadata?.status_code,
    links: response.links ? [...response.links] : undefined,
  };
}

function createScreenshotBody(
  options: ScreenshotOptions,
  session?: BrowserSession,
): Record<string, unknown> {
  assertSessionId(session?.id, "steel", "screenshot");
  const body: Record<string, unknown> = {
    sessionId: session.id,
    fullPage: options.fullPage ?? true,
  };
  if (options.url) body.url = options.url;
  if (options.selector) body.selector = options.selector;
  return body;
}

class SteelProvider implements BrowserProvider {
  private readonly client: Client;
  private readonly baseURL: string;
  private readonly apiKey: string;

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new AuthError("Missing API key for Steel. Set STEEL_API_KEY", "steel");
    }
    this.client = defaultClient();
    this.baseURL = (config.baseURL ?? "https://api.steel.dev").replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  name(): string {
    return "steel";
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

  /**
   * Turns a screenshot response into image data. Steel answers with a hosted
   * image URL, so the image is fetched to keep `data` an image, as it is for
   * every other provider.
   *
   * @param {Readonly<Record<string, unknown>>} response Screenshot response body.
   * @param {ScreenshotOptions["format"]} format Requested image format.
   * @returns {Promise<ScreenshotResult>} Image as a data URL.
   */
  private async screenshotImage(
    response: Readonly<Record<string, unknown>>,
    format: ScreenshotOptions["format"],
  ): Promise<ScreenshotResult> {
    if (typeof response.url === "string" && response.url) {
      const image = Buffer.from(await this.client.getRaw(response.url));
      const mimeType = imageMimeType(image, "");
      return { data: `data:${mimeType};base64,${image.toString("base64")}`, mimeType };
    }
    const data = response.screenshot ?? response.data;
    if (typeof data !== "string" || !data) throw new BrowserError("Steel returned no screenshot");
    return { data, mimeType: `image/${format ?? "png"}` };
  }

  private headers(): Record<string, string> {
    return {
      "steel-api-key": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const res = await this.client.postJSON<SteelSessionResponse>(
        `${this.baseURL}/v1/sessions`,
        createSessionBody(options),
        this.headers(),
      );

      return {
        id: res.id,
        cdpUrl: res.websocketUrl,
        provider: "steel",
        createdAt: Date.now(),
        metadata: { status: res.status },
      };
    } catch (error) {
      throw normalizeError(error, "steel");
    }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    try {
      const res = await this.client.getJSON<SteelSessionResponse>(
        `${this.baseURL}/v1/sessions/${sessionId}`,
        this.headers(),
      );
      return {
        id: res.id,
        cdpUrl: res.websocketUrl,
        provider: "steel",
        createdAt: res.createdAt ? new Date(res.createdAt).getTime() : Date.now(),
        metadata: { status: res.status },
      };
    } catch (error: unknown) {
      if (isNotFoundError(error)) return null;
      throw normalizeError(error, "steel");
    }
  }

  async listSessions(): Promise<BrowserSession[]> {
    const res = await this.client.getJSON<SteelSessionResponse[]>(
      `${this.baseURL}/v1/sessions`,
      this.headers(),
    );
    return res.map((s) => ({
      id: s.id,
      cdpUrl: s.websocketUrl,
      provider: "steel",
      createdAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
      metadata: { status: s.status },
    }));
  }

  async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.client.postJSON(
        `${this.baseURL}/v1/sessions/${sessionId}/release`,
        {},
        this.headers(),
      );
    } catch (error) {
      throw normalizeError(error, "steel");
    }
  }

  async scrape(
    url: string,
    options?: ScrapeOptions,
    _session?: BrowserSession,
  ): Promise<ScrapeResult> {
    try {
      const res = await this.client.postJSON<SteelScrapeResponse>(
        `${this.baseURL}/v1/scrape`,
        createScrapeBody(url, options),
        this.headers(),
      );
      return toScrapeResult(url, res);
    } catch (error) {
      throw normalizeError(error, "steel");
    }
  }

  async screenshot(
    options: ScreenshotOptions,
    session?: BrowserSession,
  ): Promise<ScreenshotResult> {
    try {
      const res = await this.client.postJSON<Record<string, unknown>>(
        `${this.baseURL}/v1/screenshot`,
        createScreenshotBody(options, session),
        this.headers(),
      );
      return await this.screenshotImage(res, options.format);
    } catch (error) {
      throw normalizeError(error, "steel");
    }
  }

  async navigate(_url: string, _session: BrowserSession): Promise<void> {
    notSupportedViaRest("steel", "navigate");
  }

  async evaluate(_script: string, _session: BrowserSession): Promise<EvaluateResult> {
    notSupportedViaRest("steel", "evaluate");
  }

  getCdpUrl(session: BrowserSession): string {
    if (session.cdpUrl) return session.cdpUrl;
    return `wss://connect.steel.dev?apiKey=${this.apiKey}&sessionId=${session.id}`;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.getJSON<{ status?: string }>(`${this.baseURL}/v1/health`, this.headers());
      return true;
    } catch {
      return false;
    }
  }
}

export const factory: BrowserProviderFactory = (config) => new SteelProvider(config);
