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
  CrawlPage,
  WebSearchResult,
  WebSearchOptions,
  ExtractResult,
  ExtractOptions,
  ProviderConfig,
  BrowserProviderFactory,
  ProviderCapabilities,
} from "../core/types";
import { defaultClient } from "../core/client";
import type { Client } from "../core/client";
import { AuthError, BrowserError, InvalidInputError, normalizeError } from "../core/errors";
import { JOB_TIMEOUT, isNotFoundError, notSupportedViaRest, waitForJob } from "../core/utils";

interface HyperbrowserSessionResponse {
  readonly id: string;
  readonly wsEndpoint?: string;
  readonly status?: string;
  readonly createdAt?: string;
  readonly [key: string]: unknown;
}

interface HyperbrowserSessionListResponse {
  readonly sessions: readonly HyperbrowserSessionResponse[];
}

interface HyperbrowserFetchResponse {
  readonly status?: string;
  readonly error?: string;
  readonly data?: {
    readonly screenshot?: string;
    readonly [key: string]: unknown;
  };
}

/**
 * Hyperbrowser has no screenshot route: fetch renders the page and stores the image at a URL.
 *
 * @param {ScreenshotOptions} options Screenshot options.
 * @returns {Record<string, unknown>} Fetch request body asking for one screenshot.
 */
function createScreenshotBody(options: ScreenshotOptions): Record<string, unknown> {
  if (!options.url) {
    throw new InvalidInputError("hyperbrowser screenshot requires a URL");
  }
  const body: Record<string, unknown> = {
    url: options.url,
    outputs: {
      formats: [
        { type: "screenshot", fullPage: options.fullPage ?? true, format: options.format ?? "png" },
      ],
    },
  };
  if (options.viewport) body.browser = { screen: options.viewport };
  return body;
}

function createSessionBody(options?: CreateSessionOptions): Record<string, unknown> {
  if (!options) return {};
  const body: Record<string, unknown> = {
    region: options.region,
    useStealth: options.stealth,
    solveCaptchas: options.captchaSolving,
    profile: options.profileId ? { id: options.profileId } : undefined,
    timeoutMinutes: options.timeout === undefined ? undefined : Math.ceil(options.timeout / 60_000),
    screen: options.viewport,
  };
  if (options.proxy) {
    body.useProxy = true;
    body.proxyServer = options.proxy.server;
    body.proxyServerUsername = options.proxy.username;
    body.proxyServerPassword = options.proxy.password;
  }
  if (options.extra) Object.assign(body, options.extra);
  return body;
}

function mapSession(response: HyperbrowserSessionResponse): BrowserSession {
  return {
    id: response.id,
    cdpUrl: response.wsEndpoint,
    provider: "hyperbrowser",
    createdAt: response.createdAt ? new Date(response.createdAt).getTime() : Date.now(),
    metadata: response.status ? { status: response.status } : undefined,
  };
}

interface HyperbrowserCrawlPage {
  readonly url?: string;
  readonly status?: string;
  readonly markdown?: string;
  readonly html?: string;
  readonly metadata?: { readonly title?: string | readonly string[] };
}

interface HyperbrowserCrawlBatch {
  readonly status?: string;
  readonly totalPageBatches?: number;
  readonly data?: readonly HyperbrowserCrawlPage[];
}

/** Job states after which Hyperbrowser adds no more pages. */
const FINISHED_CRAWL_STATUSES = new Set(["completed", "failed", "stopped"]);

interface HyperbrowserExtractJob {
  readonly status?: string;
  readonly data?: unknown;
  readonly error?: string;
}

/** Job states after which an extract job has its answer. */
const FINISHED_EXTRACT_STATUSES = new Set(["completed", "failed"]);

/**
 * Turns the last read of an extract job into a result, or an error when the job failed.
 *
 * @param {string} url Page the job extracts from.
 * @param {string} jobId Job ID the extract started.
 * @param {HyperbrowserExtractJob} job Last read of the job.
 * @returns {ExtractResult} The extracted data, or the job ID of a job still running.
 */
function extractResult(url: string, jobId: string, job: HyperbrowserExtractJob): ExtractResult {
  if (job.status === "failed") {
    throw new BrowserError(
      `Hyperbrowser extract job ${jobId} failed${job.error ? `: ${job.error}` : ""}`,
    );
  }
  if (job.status !== "completed") {
    return { url, data: { jobId, status: job.status ?? "pending" } };
  }
  return { url, data: job.data };
}

function crawlPage(page: HyperbrowserCrawlPage): CrawlPage {
  const title = page.metadata?.title;
  return {
    url: page.url ?? "",
    title: typeof title === "string" ? title : title?.[0],
    markdown: page.markdown,
    html: page.html,
  };
}

function createCrawlBody(url: string, options?: CrawlOptions): Record<string, unknown> {
  return {
    url,
    outputs: { formats: options?.formats ?? ["markdown"] },
    crawlOptions: { maxPages: options?.maxPages ?? 10 },
  };
}

class HyperbrowserProvider implements BrowserProvider {
  private readonly client: Client;
  private readonly baseURL: string;
  private readonly apiKey: string;

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new AuthError(
        "Missing API key for Hyperbrowser. Set HYPERBROWSER_API_KEY",
        "hyperbrowser",
      );
    }
    this.client = defaultClient();
    this.baseURL = (config.baseURL ?? "https://api.hyperbrowser.ai").replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  name(): string {
    return "hyperbrowser";
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
      pdf: false,
      links: false,
      search: true,
      extract: true,
    };
  }

  private headers(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      "Content-Type": "application/json",
    };
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const res = await this.client.postJSON<HyperbrowserSessionResponse>(
        `${this.baseURL}/api/session`,
        createSessionBody(options),
        this.headers(),
      );

      return mapSession(res);
    } catch (error) {
      throw normalizeError(error, "hyperbrowser");
    }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    try {
      const res = await this.client.getJSON<HyperbrowserSessionResponse>(
        `${this.baseURL}/api/session/${sessionId}`,
        this.headers(),
      );
      return mapSession(res);
    } catch (error: unknown) {
      if (isNotFoundError(error)) return null;
      throw normalizeError(error, "hyperbrowser");
    }
  }

  async listSessions(): Promise<BrowserSession[]> {
    try {
      const res = await this.client.getJSON<HyperbrowserSessionListResponse>(
        `${this.baseURL}/api/sessions`,
        this.headers(),
      );
      return res.sessions.map(mapSession);
    } catch {
      return [];
    }
  }

  async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.client.putJSON(`${this.baseURL}/api/session/${sessionId}/stop`, this.headers());
    } catch (error) {
      throw normalizeError(error, "hyperbrowser");
    }
  }

  async scrape(
    url: string,
    _options?: ScrapeOptions,
    _session?: BrowserSession,
  ): Promise<ScrapeResult> {
    try {
      const body: Record<string, unknown> = {
        url,
        outputs: { formats: ["markdown"] },
      };

      const res = await this.client.postJSON<Record<string, unknown>>(
        `${this.baseURL}/api/web/fetch`,
        body,
        this.headers(),
      );

      const data = res.data as Record<string, unknown> | undefined;
      return {
        url,
        title: data?.metadata ? (data.metadata as Record<string, string>).title : undefined,
        markdown: data?.markdown as string | undefined,
        html: data?.html as string | undefined,
        statusCode: res.status === "completed" ? 200 : undefined,
      };
    } catch (error) {
      throw normalizeError(error, "hyperbrowser");
    }
  }

  async screenshot(
    options: ScreenshotOptions,
    _session?: BrowserSession,
  ): Promise<ScreenshotResult> {
    try {
      const res = await this.client.postJSON<HyperbrowserFetchResponse>(
        `${this.baseURL}/api/web/fetch`,
        createScreenshotBody(options),
        this.headers(),
      );
      const location = res.data?.screenshot;
      if (!location) {
        throw new BrowserError(
          `Hyperbrowser returned no screenshot${res.error ? `: ${res.error}` : ""}`,
        );
      }

      const image = Buffer.from(await this.client.getRaw(location));
      const mimeType = `image/${options.format ?? "png"}`;
      return {
        data: `data:${mimeType};base64,${image.toString("base64")}`,
        mimeType,
      };
    } catch (error) {
      throw normalizeError(error, "hyperbrowser");
    }
  }

  async navigate(_url: string, _session: BrowserSession): Promise<void> {
    notSupportedViaRest("hyperbrowser", "navigate");
  }

  async evaluate(_script: string, _session: BrowserSession): Promise<EvaluateResult> {
    notSupportedViaRest("hyperbrowser", "evaluate");
  }

  getCdpUrl(session: BrowserSession): string | undefined {
    return session.cdpUrl;
  }

  async crawl(
    url: string,
    options?: CrawlOptions,
    _session?: BrowserSession,
  ): Promise<CrawlResult> {
    try {
      const { jobId } = await this.client.postJSON<{ jobId: string }>(
        `${this.baseURL}/api/web/crawl`,
        createCrawlBody(url, options),
        this.headers(),
      );
      const job = await waitForJob(
        () =>
          this.client.getJSON<{ status?: string }>(this.crawlURL(jobId, "/status"), this.headers()),
        (current) => FINISHED_CRAWL_STATUSES.has(current.status ?? ""),
        options?.timeout ?? JOB_TIMEOUT,
      );
      if (!FINISHED_CRAWL_STATUSES.has(job.status ?? "")) {
        return { pages: [], totalFound: 0, jobId, status: "running" };
      }

      const pages = (await this.crawlPages(jobId))
        .filter((page) => page.status === "completed")
        .map(crawlPage);
      return {
        pages,
        totalFound: pages.length,
        jobId,
        status: job.status === "completed" ? "completed" : "failed",
      };
    } catch (error) {
      throw normalizeError(error, "hyperbrowser");
    }
  }

  private crawlURL(jobId: string, path = ""): string {
    return `${this.baseURL}/api/web/crawl/${encodeURIComponent(jobId)}${path}`;
  }

  /**
   * Reads every batch of a finished job. Batches count from 1; the API rejects 0.
   *
   * @param {string} jobId Job ID the crawl started.
   * @returns {Promise<HyperbrowserCrawlPage[]>} Pages in batch order.
   */
  private async crawlPages(jobId: string): Promise<HyperbrowserCrawlPage[]> {
    const pages: HyperbrowserCrawlPage[] = [];
    let batches = 1;
    for (let batch = 1; batch <= batches; batch += 1) {
      const res = await this.client.getJSON<HyperbrowserCrawlBatch>(
        `${this.crawlURL(jobId)}?page=${batch}`,
        this.headers(),
      );
      pages.push(...(res.data ?? []));
      batches = res.totalPageBatches ?? batch;
    }
    return pages;
  }

  async search(query: string, _options?: WebSearchOptions): Promise<WebSearchResult[]> {
    try {
      const body: Record<string, unknown> = { query };

      const res = await this.client.postJSON<Record<string, unknown>>(
        `${this.baseURL}/api/web/search`,
        body,
        this.headers(),
      );

      const data = res.data as Record<string, unknown> | undefined;
      const results = (data?.results ?? res.results ?? []) as Array<Record<string, unknown>>;
      return results.map((r) => ({
        url: (r.url ?? "") as string,
        title: (r.title ?? "") as string,
        snippet: (r.description ?? r.snippet ?? "") as string,
      }));
    } catch (error) {
      throw normalizeError(error, "hyperbrowser");
    }
  }

  async extract(
    url: string,
    options?: ExtractOptions,
    _session?: BrowserSession,
  ): Promise<ExtractResult> {
    try {
      const body: Record<string, unknown> = { urls: [url] };
      if (options?.schema) body.schema = options.schema;
      if (options?.prompt) body.prompt = options.prompt;

      const { jobId } = await this.client.postJSON<{ jobId: string }>(
        `${this.baseURL}/api/extract`,
        body,
        this.headers(),
      );
      const job = await waitForJob(
        () =>
          this.client.getJSON<HyperbrowserExtractJob>(
            `${this.baseURL}/api/extract/${encodeURIComponent(jobId)}`,
            this.headers(),
          ),
        (current) => FINISHED_EXTRACT_STATUSES.has(current.status ?? ""),
        options?.timeout ?? JOB_TIMEOUT,
      );
      return extractResult(url, jobId, job);
    } catch (error) {
      throw normalizeError(error, "hyperbrowser");
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.getJSON<HyperbrowserSessionListResponse>(
        `${this.baseURL}/api/sessions`,
        this.headers(),
      );
      return true;
    } catch {
      return false;
    }
  }
}

export const factory: BrowserProviderFactory = (config) => new HyperbrowserProvider(config);
