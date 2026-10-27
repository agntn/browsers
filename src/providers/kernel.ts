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
import { Client, defaultClient } from "../core/client.ts";
import {
  AuthError,
  BrowserError,
  NavigationError,
  navigationFailure,
  normalizeError,
  responseReason,
} from "../core/errors.ts";
import {
  assertUrl,
  assertUrlOrSession,
  isNotFoundError,
  assertNoSelector,
  assertNoWaitFor,
  waitForMissMessage,
  assertSessionId,
} from "../core/utils.ts";

interface KernelSessionResponse {
  readonly session_id: string;
  readonly cdp_ws_url?: string;
  readonly created_at?: string;
  readonly [key: string]: unknown;
}

function createSessionBody(options?: CreateSessionOptions): Record<string, unknown> {
  if (!options) return {};
  return {
    region: options.region,
    headless: options.headless,
    profile: options.profileId ? { id: options.profileId } : undefined,
    proxy: options.proxy,
    stealth: options.stealth,
    timeout_seconds: options.timeout === undefined ? undefined : Math.floor(options.timeout / 1000),
    viewport: options.viewport,
    ...options.extra,
  };
}

function mapSession(response: KernelSessionResponse): BrowserSession {
  return {
    id: response.session_id,
    cdpUrl: response.cdp_ws_url,
    provider: "kernel",
    createdAt: response.created_at ? new Date(response.created_at).getTime() : Date.now(),
  };
}

/** Kernel's proxy answering for a site it couldn't reach, like a DNS miss or a bad certificate. */
const PROXY_FAILURE =
  /^(?:upstream request failed|egress-proxy-mitm encountered an unexpected error)\b/;

/** The start of a 5xx answer to `page.goto`, which may be the proxy's and not the site's. */
type ServerError = Readonly<{ status: number; text: string }>;

/**
 * Playwright code that opens `url` and keeps the start of a 5xx answer for `rejectProxyFailure`.
 *
 * @param url - The page to open.
 * @param waitUntil - Playwright's load state to wait for, or Playwright's default.
 * @returns {string} Code that declares `serverError` after `page.goto`.
 */
function gotoScript(url: string, waitUntil?: string): string {
  const options = waitUntil ? `, { waitUntil: ${JSON.stringify(waitUntil)} }` : "";
  return `const response = await page.goto(${JSON.stringify(url)}${options}); const serverError = response && response.status() >= 500 ? { status: response.status(), text: (await response.text()).slice(0, 500) } : undefined;`;
}

/** Milliseconds Kernel waits for `waitFor`, the same as Playwright and Browserless. */
const WAIT_FOR_TIMEOUT = 25_000;

/** Kernel stops an execute call at 60 s, so its own answer has to arrive before this one. */
const EXECUTE_TIMEOUT = 65_000;

/**
 * Playwright code that waits for `waitFor` and declares `missed`, true when it never showed up.
 *
 * @param selector - CSS selector to wait for, or none.
 * @returns {string} Code to run after `gotoScript`.
 */
function waitForScript(selector: string | undefined): string {
  if (selector === undefined) return "const missed = false;";
  return `const missed = await page.waitForSelector(${JSON.stringify(selector)}, { timeout: ${WAIT_FOR_TIMEOUT} }).then(() => false, (error) => { if (error.name === "TimeoutError") return true; throw error; });`;
}

/**
 * Throws when `waitForScript` gave up on the selector, rather than return the page without it.
 *
 * @param missed - What `waitForScript` declared.
 * @param selector - The selector it waited for.
 * @throws {BrowserError} Naming the selector and the wait.
 */
function rejectMissedWait(missed: boolean | undefined, selector: string | undefined): void {
  if (missed === true && selector !== undefined) {
    throw new BrowserError(waitForMissMessage(selector, WAIT_FOR_TIMEOUT));
  }
}

/**
 * Throws when the page is the proxy's error text, which Chrome renders like any other page.
 *
 * @param serverError - What `gotoScript` kept, if the answer was a 5xx.
 * @throws {NavigationError} With the proxy's status and its text as the reason.
 */
function rejectProxyFailure(serverError: ServerError | undefined): void {
  if (!serverError || !PROXY_FAILURE.test(serverError.text)) return;
  const lines = serverError.text.split("\n").filter((line) => line.trim());
  throw new NavigationError("kernel", responseReason(lines.join(": ")) ?? "", serverError.status);
}

class KernelProvider implements BrowserProvider {
  private readonly client: Client;
  /** One try per execute call: a retry would load the page and wait all over again. */
  private readonly executeClient = new Client({ timeout: EXECUTE_TIMEOUT, maxRetries: 0 });
  private readonly baseURL: string;
  private readonly apiKey: string;

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new AuthError("Missing API key for Kernel. Set KERNEL_API_KEY", "kernel");
    }
    this.client = defaultClient();
    this.baseURL = (config.baseURL ?? "https://api.onkernel.com").replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  name(): string {
    return "kernel";
  }

  capabilities(): ProviderCapabilities {
    return {
      scrape: true,
      screenshot: true,
      navigate: true,
      evaluate: true,
      sessions: true,
      cdp: true,
      statelessScrape: false,
      statelessScreenshot: false,
      elementScreenshot: false,
      screenshotWaitFor: false,
      scrapeWaitFor: true,
      crawl: false,
      pdf: false,
      links: false,
      search: false,
      extract: false,
    };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const res = await this.client.postJSON<KernelSessionResponse>(
        `${this.baseURL}/browsers`,
        createSessionBody(options),
        this.headers(),
      );

      return mapSession(res);
    } catch (error) {
      throw normalizeError(error, "kernel");
    }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    try {
      const res = await this.client.getJSON<KernelSessionResponse>(
        `${this.baseURL}/browsers/${sessionId}`,
        this.headers(),
      );
      return mapSession(res);
    } catch (error: unknown) {
      if (isNotFoundError(error)) return null;
      throw normalizeError(error, "kernel");
    }
  }

  async listSessions(): Promise<BrowserSession[]> {
    const res = await this.client.getJSON<KernelSessionResponse[]>(
      `${this.baseURL}/browsers`,
      this.headers(),
    );
    return res.map(mapSession);
  }

  async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.client.deleteJSON(`${this.baseURL}/browsers/${sessionId}`, {
        ...this.headers(),
        Accept: "*/*",
      });
    } catch (error) {
      throw normalizeError(error, "kernel");
    }
  }

  async scrape(
    url: string,
    options?: ScrapeOptions,
    session?: BrowserSession,
  ): Promise<ScrapeResult> {
    assertUrl(url);
    try {
      assertSessionId(session?.id, "kernel", "scrape");
      const waitFor = options?.waitFor;

      const result = await this.evaluate(
        `${gotoScript(url, "networkidle")} ${waitForScript(waitFor)} return { serverError, missed, html: await page.content(), title: await page.title() }`,
        session!,
      );

      const data = result.value as
        | { serverError?: ServerError; missed?: boolean; html?: string; title?: string }
        | undefined;
      rejectProxyFailure(data?.serverError);
      rejectMissedWait(data?.missed, waitFor);
      return rejectBlockPage({ url, title: data?.title, html: data?.html }, "kernel");
    } catch (error) {
      throw navigationFailure(error, "kernel") ?? normalizeError(error, "kernel");
    }
  }

  async screenshot(
    options: ScreenshotOptions,
    session?: BrowserSession,
  ): Promise<ScreenshotResult> {
    try {
      assertSessionId(session?.id, "kernel", "screenshot");
      assertUrlOrSession(options.url, session, "kernel", "screenshot");
      assertNoSelector(options.selector, "kernel");
      assertNoWaitFor(options.waitFor, "kernel");
      const png = await this.client.postRaw(
        `${this.baseURL}/browsers/${session.id}/computer/screenshot`,
        {},
        { ...this.headers(), Accept: "image/png" },
      );

      return {
        data: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
        mimeType: "image/png",
      };
    } catch (error) {
      throw normalizeError(error, "kernel");
    }
  }

  async navigate(url: string, session: BrowserSession): Promise<void> {
    assertUrl(url);
    try {
      const result = await this.evaluate(`${gotoScript(url)} return serverError`, session);
      rejectProxyFailure(result.value as ServerError | undefined);
    } catch (error) {
      throw navigationFailure(error, "kernel") ?? error;
    }
  }

  async evaluate(script: string, session: BrowserSession): Promise<EvaluateResult> {
    try {
      const res = await this.executeClient.postJSON<{
        success: boolean;
        result?: unknown;
        error?: string;
        stdout?: string;
        stderr?: string;
      }>(
        `${this.baseURL}/browsers/${session.id}/playwright/execute`,
        { code: script },
        this.headers(),
      );
      if (!res.success) throw new BrowserError(res.error ?? "Kernel Playwright execution failed");
      const logs = [res.stdout, res.stderr].filter((line): line is string => Boolean(line));
      return logs.length > 0 ? { value: res.result, logs } : { value: res.result };
    } catch (error) {
      throw normalizeError(error, "kernel");
    }
  }

  getCdpUrl(session: BrowserSession): string | undefined {
    return session.cdpUrl;
  }

  async checkAvailability(): Promise<void> {
    try {
      await this.client.getJSON<KernelSessionResponse[]>(
        `${this.baseURL}/browsers?limit=1`,
        this.headers(),
      );
    } catch (error) {
      throw normalizeError(error, "kernel");
    }
  }
}

export const factory: BrowserProviderFactory = (config) => new KernelProvider(config);
