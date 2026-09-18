import type {
  BrowserProvider,
  BrowserSession,
  CreateSessionOptions,
  ScrapeResult,
  ScrapeOptions,
  ScreenshotResult,
  ScreenshotOptions,
  EvaluateResult,
  CrawlResult,
  CrawlOptions,
  PdfResult,
  PdfOptions,
  LinksResult,
  ExtractResult,
  ExtractOptions,
  ProviderConfig,
  BrowserProviderFactory,
  ProviderCapabilities,
  CloudflareBrowser,
} from "../core/types";
import { defaultClient } from "../core/client";
import type { Client } from "../core/client";
import { AuthError, normalizeError } from "../core/errors";
import { register } from "../core/registry";
import { assertUrlOrSession, notSupportedViaRest, resolveCloudflareBrowser } from "../core/utils";

interface CfEnvelope<T = unknown> {
  readonly success: boolean;
  readonly result: T;
  readonly errors?: readonly { readonly code: number; readonly message: string }[];
  readonly messages?: readonly string[];
}

interface CfSessionResult {
  readonly sessionId?: string;
  readonly sessionId2?: string;
  readonly closeReason?: string;
  readonly connectionStartTime?: number;
  readonly connectionEndTime?: number;
  readonly connectionId?: string;
  readonly webSocketDebuggerUrl?: string;
  readonly [key: string]: unknown;
}

interface CfContentResult {
  readonly content?: string;
  readonly [key: string]: unknown;
}

interface CfScreenshotResult {
  readonly image?: string;
  readonly [key: string]: unknown;
}

function createScrapeBody(url: string, options?: ScrapeOptions): Record<string, unknown> {
  const body: Record<string, unknown> = { url };
  if (!options) return body;
  if (options.waitFor) body.waitForSelector = options.waitFor;
  if (options.waitForNetworkIdle) body.waitUntil = "networkidle";
  if (options.headers) body.headers = options.headers;
  if (options.script) body.addScriptTag = { content: options.script };
  return body;
}

function createScreenshotBody(
  options: ScreenshotOptions,
  session?: BrowserSession,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (options.url) body.url = options.url;
  if (session?.id) body.sessionId = session.id;
  if (options.selector) body.selector = options.selector;
  if (options.fullPage !== undefined) body.fullPage = options.fullPage;
  return body;
}

function createCrawlBody(url: string, options?: CrawlOptions): Record<string, unknown> {
  const body: Record<string, unknown> = { url };
  if (!options) return body;
  if (options.maxDepth) body.depth = options.maxDepth;
  if (options.maxPages) body.limit = options.maxPages;
  if (options.formats) body.output_format = options.formats[0];
  return body;
}

function createPdfBody(url: string, options?: PdfOptions): Record<string, unknown> {
  const body: Record<string, unknown> = { url };
  if (!options) return body;
  if (options.format) body.format = options.format;
  if (options.landscape !== undefined) body.landscape = options.landscape;
  if (options.printBackground !== undefined) body.printBackground = options.printBackground;
  if (options.css) body.css = options.css;
  return body;
}

class CloudflareProvider implements BrowserProvider {
  private readonly client: Client;
  private readonly accountID: string;
  private readonly apiToken: string;
  private readonly browser?: CloudflareBrowser;

  constructor(config: ProviderConfig) {
    const apiToken = config.apiKey || process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
    const accountID =
      config.accountID || process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!apiToken) {
      throw new AuthError(
        "Missing Cloudflare API token. Set CF_API_TOKEN (or CLOUDFLARE_API_TOKEN)",
        "cloudflare",
      );
    }
    if (!accountID) {
      throw new AuthError(
        "Missing Cloudflare account ID. Set CF_ACCOUNT_ID (or CLOUDFLARE_ACCOUNT_ID)",
        "cloudflare",
      );
    }

    this.client = defaultClient();
    this.apiToken = apiToken;
    this.accountID = accountID;
    this.browser = resolveCloudflareBrowser("cloudflare", config.browser);
  }

  name(): string {
    return "cloudflare";
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
      statelessScreenshot: true,
      crawl: true,
      pdf: true,
      links: true,
      search: false,
      extract: true,
    };
  }

  private base(): string {
    const product = this.browser ? "browser-run" : "browser-rendering";
    return `https://api.cloudflare.com/client/v4/accounts/${this.accountID}/${product}`;
  }

  private browserEndpoint(path: string, params = new URLSearchParams()): string {
    if (this.browser) params.set("browser", this.browser);
    const query = params.toString();
    return `${this.base()}${path}${query ? `?${query}` : ""}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  private unwrap<T>(response: CfEnvelope<T> | T): T {
    if (
      typeof response !== "object" ||
      response === null ||
      !("success" in response) ||
      !("result" in response)
    ) {
      return response as T;
    }
    const envelope = response as CfEnvelope<T>;
    if (!envelope.success) {
      const msg = envelope.errors?.map((e) => e.message).join("; ") ?? "Unknown Cloudflare error";
      throw new Error(msg);
    }
    return envelope.result;
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const params = new URLSearchParams();
      if (options?.timeout) params.set("keep_alive", String(options.timeout));
      const res = await this.client.postJSON<CfEnvelope<CfSessionResult> | CfSessionResult>(
        this.browserEndpoint("/devtools/browser", params),
        {},
        this.headers(),
      );
      const result = this.unwrap(res);

      return {
        id: result.sessionId ?? "",
        provider: "cloudflare",
        createdAt: Date.now(),
        ...(result.webSocketDebuggerUrl ? { cdpUrl: result.webSocketDebuggerUrl } : {}),
        metadata: { connectionId: result.connectionId },
      };
    } catch (error) {
      throw normalizeError(error, "cloudflare");
    }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    try {
      const res = await this.client.getJSON<CfEnvelope<CfSessionResult> | CfSessionResult>(
        this.browserEndpoint(`/devtools/browser/${sessionId}`),
        this.headers(),
      );
      const result = this.unwrap(res);
      return {
        id: sessionId,
        provider: "cloudflare",
        createdAt: result.connectionStartTime ?? Date.now(),
        ...(result.webSocketDebuggerUrl ? { cdpUrl: result.webSocketDebuggerUrl } : {}),
        metadata: result,
      };
    } catch {
      return null;
    }
  }

  async listSessions(): Promise<BrowserSession[]> {
    try {
      const res = await this.client.getJSON<CfEnvelope<CfSessionResult[]> | CfSessionResult[]>(
        this.browserEndpoint("/devtools/session"),
        this.headers(),
      );
      const sessions = this.unwrap(res);
      return (Array.isArray(sessions) ? sessions : []).map((s) => ({
        id: s.sessionId ?? "",
        provider: "cloudflare",
        createdAt: s.connectionStartTime ?? Date.now(),
        ...(s.webSocketDebuggerUrl ? { cdpUrl: s.webSocketDebuggerUrl } : {}),
        metadata: s,
      }));
    } catch {
      return [];
    }
  }

  async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.client.deleteJSON(
        this.browserEndpoint(`/devtools/browser/${sessionId}`),
        this.headers(),
      );
    } catch (error) {
      throw normalizeError(error, "cloudflare");
    }
  }

  async scrape(
    url: string,
    options?: ScrapeOptions,
    _session?: BrowserSession,
  ): Promise<ScrapeResult> {
    try {
      const res = await this.client.postJSON<CfEnvelope<CfContentResult>>(
        this.browserEndpoint("/content"),
        createScrapeBody(url, options),
        this.headers(),
      );
      const result = this.unwrap(res) as CfContentResult | string;

      return {
        url,
        html: typeof result === "string" ? result : result.content,
      };
    } catch (error) {
      throw normalizeError(error, "cloudflare");
    }
  }

  async screenshot(
    options: ScreenshotOptions,
    session?: BrowserSession,
  ): Promise<ScreenshotResult> {
    try {
      assertUrlOrSession(options.url, session, "cloudflare", "screenshot");

      const res = await this.client.postResponse(
        this.browserEndpoint("/screenshot"),
        createScreenshotBody(options, session),
        this.headers(),
      );

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("image")) {
        const buf = await res.arrayBuffer();
        return {
          data: `data:image/png;base64,${Buffer.from(buf).toString("base64")}`,
          mimeType: "image/png",
        };
      }

      const data = (await res.json()) as CfEnvelope<CfScreenshotResult>;
      const result = this.unwrap(data);
      return {
        data: result.image ?? "",
        mimeType: `image/${options.format ?? "png"}`,
      };
    } catch (error) {
      throw normalizeError(error, "cloudflare");
    }
  }

  async navigate(_url: string, _session: BrowserSession): Promise<void> {
    notSupportedViaRest("cloudflare", "navigate");
  }

  async evaluate(_script: string, _session: BrowserSession): Promise<EvaluateResult> {
    notSupportedViaRest("cloudflare", "evaluate");
  }

  getCdpUrl(session: BrowserSession): string | undefined {
    if (!session.id) return undefined;
    return `wss://cloudflare.com/browser-run/devtools/browser/${session.id}`;
  }

  async crawl(
    url: string,
    options?: CrawlOptions,
    _session?: BrowserSession,
  ): Promise<CrawlResult> {
    try {
      const res = await this.client.postJSON<CfEnvelope<string | Record<string, unknown>>>(
        this.browserEndpoint("/crawl"),
        createCrawlBody(url, options),
        this.headers(),
      );
      const result = this.unwrap(res);

      if (typeof result === "string") {
        return { pages: [], totalFound: 0, jobId: result, status: "running" };
      }

      const pages = (result.pages ?? result.data ?? []) as Array<Record<string, unknown>>;
      return {
        pages: pages.map((p) => ({
          url: (p.url ?? "") as string,
          html: p.html as string,
          markdown: p.markdown as string,
          title: p.title as string,
        })),
        totalFound: pages.length,
        jobId: result.jobId as string,
        status: result.status as "completed" | "running" | "failed",
      };
    } catch (error) {
      throw normalizeError(error, "cloudflare");
    }
  }

  async pdf(url: string, options?: PdfOptions, _session?: BrowserSession): Promise<PdfResult> {
    try {
      const res = await this.client.postResponse(
        this.browserEndpoint("/pdf"),
        createPdfBody(url, options),
        this.headers(),
      );

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("pdf")) {
        const buf = await res.arrayBuffer();
        return {
          data: `data:application/pdf;base64,${Buffer.from(buf).toString("base64")}`,
          mimeType: "application/pdf",
        };
      }
      const data = (await res.json()) as CfEnvelope<Record<string, unknown>>;
      const result = this.unwrap(data);
      return { data: (result.data ?? result.content ?? "") as string, mimeType: "application/pdf" };
    } catch (error) {
      throw normalizeError(error, "cloudflare");
    }
  }

  async links(url: string, _session?: BrowserSession): Promise<LinksResult> {
    try {
      const res = await this.client.postJSON<CfEnvelope<string[]>>(
        this.browserEndpoint("/links"),
        { url },
        this.headers(),
      );
      const result = this.unwrap(res);
      const rawLinks = Array.isArray(result) ? result : [];
      return {
        url,
        links: rawLinks.map((href) => ({ href })),
      };
    } catch (error) {
      throw normalizeError(error, "cloudflare");
    }
  }

  async extract(
    url: string,
    options?: ExtractOptions,
    _session?: BrowserSession,
  ): Promise<ExtractResult> {
    try {
      const body: Record<string, unknown> = { url };
      if (options?.prompt) body.prompt = options.prompt;
      if (options?.schema)
        body.response_format = { type: "json_schema", json_schema: options.schema };

      const res = await this.client.postJSON<CfEnvelope<Record<string, unknown>>>(
        this.browserEndpoint("/json"),
        body,
        this.headers(),
      );
      const result = this.unwrap(res);
      return {
        url,
        data: result.data ?? result,
        markdown: result.markdown as string | undefined,
      };
    } catch (error) {
      throw normalizeError(error, "cloudflare");
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await this.client.getJSON<CfEnvelope<unknown>>(
        `${this.base()}/devtools/session`,
        this.headers(),
      );
      return res.success;
    } catch {
      return false;
    }
  }
}

const factory: BrowserProviderFactory = (config) => new CloudflareProvider(config);
register("cloudflare", "https://api.cloudflare.com", factory);
