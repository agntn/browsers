import type {
  AbortOptions,
  BrowserProvider,
  BrowserProviderFactory,
  BrowserSession,
  CreateSessionOptions,
  EvaluateResult,
  LinksResult,
  ProviderCapabilities,
  ProviderConfig,
  ScrapeOptions,
  ScrapeResult,
  ScreenshotResult,
} from "../core/types.ts";
import { rejectBlockPage } from "../core/block-page.ts";
import { Client, defaultClient } from "../core/client.ts";
import {
  AuthError,
  BrowserError,
  HTTPError,
  InvalidInputError,
  NavigationError,
  SessionNotFoundError,
  UnsupportedOperationError,
  normalizeError,
} from "../core/errors.ts";
import { assertUrl, waitForMissMessage } from "../core/utils.ts";
import { dropProcessSession, holdProcessSession } from "../core/process-sessions.ts";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { promisify } from "node:util";
import type { Browser, Page } from "playwright-core";

const PROVIDER = "lightpanda";

/** Lightpanda Cloud in west Europe. The other region is `https://uswest.cloud.lightpanda.io`. */
const CLOUD_URL = "https://euwest.cloud.lightpanda.io";

/** Milliseconds a scrape waits for `waitFor` once the page has loaded. */
const WAIT_FOR_TIMEOUT = 25_000;

/** Milliseconds a fresh `lightpanda serve` gets to answer, with room for a crowded host. */
const SERVE_START_TIMEOUT = 30_000;

/** Milliseconds one `lightpanda fetch` may run before it is killed. */
const FETCH_TIMEOUT = 60_000;

/** Signals that end the host. A `lightpanda serve` it started has to go down with it. */
const HOST_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"] as const;

/** The stop of every `lightpanda serve` this process started and hasn't stopped yet. */
const runningServers = new Set<() => void>();

/** A failed `goto` with Lightpanda's own reason, like `CouldntResolveHost`. */
const GOTO_FAILURE = /^page\.goto: ([A-Z][A-Za-z]+) at /;

/** The cloud's 500 for a page that never loaded, read from the end past the URL it echoes. */
const CLOUD_LOAD_FAILURE = /: page load error ([A-Z][A-Za-z]+)\s*$/;

/** How Playwright reports a CDP socket the server refused for the token. */
const CDP_UNAUTHORIZED = /\b401 Unauthorized\b/;

const execFileAsync = promisify(execFile);

/** Cloud with a token, a running CDP server for a `ws://` base URL, else a binary to start. */
type Target =
  | { readonly kind: "cloud"; readonly baseURL: string; readonly token: string }
  | { readonly kind: "attach"; readonly endpoint: string }
  | { readonly kind: "launch"; readonly executable: string };

/** A CDP endpoint to connect to, and how to let go of what was started for it. */
interface Endpoint {
  readonly url: string;
  readonly stop: () => void;
}

/** One open connection: the page operations run on, the browser to close, the server to stop. */
interface Connection {
  readonly browser: Browser;
  readonly page: Page;
  readonly stop: () => void;
}

interface SessionRecord {
  readonly session: BrowserSession;
  readonly connection: Connection;
}

/** What `lightpanda fetch --json` prints for one URL. */
interface FetchReport {
  readonly url?: string;
  readonly http_status?: number;
  readonly content?: string;
  readonly error?: string | null;
}

/** One stateless fetch: the address, the dump format and the caller's options. */
interface FetchRequest {
  readonly url: string;
  readonly format: "markdown" | "html";
  readonly options?: ScrapeOptions;
}

/** What `POST /api/fetch` answers. */
interface CloudFetchReply {
  readonly data?: string;
  readonly status?: number;
}

/** Shared by every instance, since agent tools build a new provider per call. */
const sessionStores = new Map<string, Map<string, SessionRecord>>();

/**
 * Picks the target a config describes. A `ws://` base URL wins over a token in the environment.
 *
 * @param {ProviderConfig} config - Resolved provider config.
 * @returns {Target} Cloud, an existing CDP server, or a local binary to start.
 * @throws {AuthError} When the base URL names the cloud and there is no token.
 */
function resolveTarget(config: Readonly<ProviderConfig>): Target {
  const token = config.apiKey || process.env.LPD_TOKEN;
  const baseURL = (config.baseURL ?? "local").replace(/\/+$/, "");
  if (/^wss?:\/\//.test(baseURL)) return { kind: "attach", endpoint: baseURL };
  const cloudURL = /^https?:\/\//.test(baseURL) ? baseURL : undefined;
  if (token) return { kind: "cloud", baseURL: cloudURL ?? CLOUD_URL, token };
  if (cloudURL) {
    throw new AuthError(
      "Missing API key for Lightpanda Cloud. Set LIGHTPANDA_API_KEY or LPD_TOKEN",
      PROVIDER,
    );
  }
  return { kind: "launch", executable: process.env.LIGHTPANDA_EXECUTABLE_PATH || "lightpanda" };
}

/**
 * The key the session store files a target's sessions under.
 *
 * @param {Target} target - Where the browser runs.
 * @returns {string} One key per cloud account, CDP server or binary.
 */
function storeKey(target: Readonly<Target>): string {
  if (target.kind === "cloud") return `cloud\0${target.baseURL}\0${target.token}`;
  if (target.kind === "attach") return `attach\0${target.endpoint}`;
  return `launch\0${target.executable}`;
}

/**
 * Says how to get the binary when starting it failed for lack of one.
 *
 * @param {unknown} error - What `spawn` or `execFile` threw.
 * @param {string} executable - The binary it tried.
 * @returns {BrowserError} An install hint for a missing binary, the normalized error otherwise.
 */
function launchFailure(error: unknown, executable: string): BrowserError {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return new BrowserError(
      `Lightpanda binary not found at ${executable}. Install it from https://lightpanda.io/docs, put it on PATH or set LIGHTPANDA_EXECUTABLE_PATH, or set LIGHTPANDA_API_KEY for Lightpanda Cloud.`,
      { cause: error },
    );
  }
  return normalizeError(error, PROVIDER);
}

/**
 * Asks the OS for a free loopback port.
 *
 * @returns {Promise<number>} A port nothing listened on a moment ago.
 */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (address === null || typeof address === "string") {
    throw new BrowserError("No free port for lightpanda serve");
  }
  return address.port;
}

/**
 * Reads the WebSocket address a CDP server advertises, or `undefined` while it isn't up yet.
 *
 * @param {string} versionUrl - The server's `/json/version` route.
 * @returns {Promise<string | undefined>} Its `webSocketDebuggerUrl`.
 */
async function advertisedSocket(versionUrl: string): Promise<string | undefined> {
  try {
    const response = await fetch(versionUrl);
    if (!response.ok) return undefined;
    const version = (await response.json()) as { readonly webSocketDebuggerUrl?: unknown };
    return typeof version.webSocketDebuggerUrl === "string"
      ? version.webSocketDebuggerUrl
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Polls the server's `/json/version` until it advertises its WebSocket.
 *
 * @param {string} versionUrl - The server's version route.
 * @param {Promise<never>} failed - Rejects when the server dies or the caller aborts.
 * @returns {Promise<string>} The CDP WebSocket address.
 */
async function waitUntilServing(
  versionUrl: string,
  failed: Readonly<Promise<never>>,
): Promise<string> {
  const deadline = Date.now() + SERVE_START_TIMEOUT;
  while (Date.now() < deadline) {
    const socket = await Promise.race([advertisedSocket(versionUrl), failed]);
    if (socket) return socket;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new BrowserError(`lightpanda serve didn't answer within ${SERVE_START_TIMEOUT / 1000}s`);
}

/**
 * Stops every server, then sends the signal again when no other listener would take it.
 *
 * @param {NodeJS.Signals} signal - What the host got.
 */
function stopServersOnSignal(signal: NodeJS.Signals): void {
  for (const stop of runningServers) stop();
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}

/**
 * Counts a server in, and listens for the host's signals while it is the only one.
 *
 * @param {() => void} stop - What stops it.
 */
function holdServer(stop: () => void): void {
  runningServers.add(stop);
  if (runningServers.size > 1) return;
  for (const signal of HOST_SIGNALS) process.on(signal, stopServersOnSignal);
}

/**
 * Counts a server out, and lets go of the host's signals once none is left.
 *
 * @param {() => void} stop - The stop `holdServer` got.
 */
function dropServer(stop: () => void): void {
  if (!runningServers.delete(stop) || runningServers.size > 0) return;
  for (const signal of HOST_SIGNALS) process.off(signal, stopServersOnSignal);
}

/**
 * Starts `lightpanda serve` on a free loopback port and waits until it answers.
 *
 * @param {string} executable - The Lightpanda binary.
 * @param {AbortSignal} [signal] - Stops the wait, and the server, when the caller gives up.
 * @returns {Promise<Endpoint>} Its CDP address, and a stop that kills the process.
 */
async function launchServer(executable: string, signal?: AbortSignal): Promise<Endpoint> {
  const port = await freePort();
  signal?.throwIfAborted();
  const child = spawn(executable, ["serve", "--host", "127.0.0.1", "--port", String(port)], {
    stdio: "ignore",
  });
  const stop = (): void => {
    dropServer(stop);
    child.kill();
  };
  holdServer(stop);
  child.once("exit", () => dropServer(stop));
  const failed = Promise.withResolvers<never>();
  child.once("error", failed.reject);
  child.once("exit", (code) => {
    failed.reject(new BrowserError(`lightpanda serve exited with code ${code ?? "null"}`));
  });
  const giveUp = (): void => failed.reject(signal?.reason);
  failed.promise.catch(() => {});
  signal?.addEventListener("abort", giveUp, { once: true });
  const versionUrl = `http://127.0.0.1:${port}/json/version`;
  try {
    return { url: await waitUntilServing(versionUrl, failed.promise), stop };
  } catch (error) {
    stop();
    throw launchFailure(error, executable);
  } finally {
    signal?.removeEventListener("abort", giveUp);
  }
}

/**
 * The CDP endpoint for one connection to a target.
 *
 * @param {Target} target - Where the browser runs.
 * @param {AbortSignal} [signal] - Cancels a server start still under way.
 * @returns {Promise<Endpoint>} The address, with a stop for a server this call started.
 */
async function openEndpoint(target: Readonly<Target>, signal?: AbortSignal): Promise<Endpoint> {
  if (target.kind === "launch") return launchServer(target.executable, signal);
  const stop = (): void => {};
  if (target.kind === "attach") return { url: target.endpoint, stop };
  const socket = target.baseURL.replace(/^http/, "ws");
  const token = encodeURIComponent(target.token);
  return { url: `${socket}/ws?token=${token}&browser=lightpanda`, stop };
}

/**
 * The `/json/version` route of the server behind a CDP socket, whatever path the socket has.
 *
 * @param {string} socket - A `ws://` or `wss://` address, like Chrome's `/devtools/browser/<id>`.
 * @returns {string} The `http(s)` version route on the same host.
 */
function versionRoute(socket: string): string {
  const { protocol, host } = new URL(socket);
  return `${protocol.replace(/^ws/, "http")}//${host}/json/version`;
}

/**
 * Connects over CDP and opens a page in a context of its own, which Lightpanda limits to one page.
 *
 * @param {Endpoint} endpoint - Where to connect.
 * @param {CreateSessionOptions} [options] - The viewport, when the caller set one.
 * @returns {Promise<Connection>} The open page.
 */
async function connect(
  endpoint: Readonly<Endpoint>,
  options?: CreateSessionOptions,
): Promise<Connection> {
  const { chromium } = await import("playwright-core");
  try {
    const browser = await chromium.connectOverCDP(endpoint.url);
    const context = await browser.newContext(
      options?.viewport ? { viewport: options.viewport } : {},
    );
    return { browser, page: await context.newPage(), stop: endpoint.stop };
  } catch (error) {
    endpoint.stop();
    if (error instanceof Error && CDP_UNAUTHORIZED.test(error.message)) {
      throw new AuthError("Authentication failed for lightpanda: Unauthorized", PROVIDER);
    }
    throw normalizeError(error, PROVIDER);
  }
}

/**
 * Closes the connection and stops the server opened for it, without failing on either.
 *
 * @param {Connection} connection - What to close.
 * @returns {Promise<void>} Resolves once the browser is closed.
 */
async function disconnect(connection: Readonly<Connection>): Promise<void> {
  await connection.browser.close().catch(() => {});
  connection.stop();
}

/**
 * `page.goto` that throws `NavigationError` with Lightpanda's own reason, like `CouldntConnect`.
 *
 * @param {Page} page - Page to navigate.
 * @param {string} url - Address to open.
 * @param {"load" | "networkidle"} waitUntil - When the navigation counts as done.
 * @returns {Promise<number | undefined>} The site's HTTP status.
 */
async function goto(
  page: Page,
  url: string,
  waitUntil: "load" | "networkidle" = "load",
): Promise<number | undefined> {
  try {
    const response = await page.goto(url, { waitUntil });
    return response?.status();
  } catch (error) {
    const reason = error instanceof Error ? GOTO_FAILURE.exec(error.message)?.[1] : undefined;
    if (reason) throw new NavigationError(PROVIDER, reason, undefined, { cause: error, own: true });
    throw error;
  }
}

/**
 * Waits for a `waitFor` selector and reports a miss by name, not as Playwright's call log.
 *
 * @param {Page} page - Page to watch.
 * @param {string} selector - CSS selector the caller waits for.
 * @returns {Promise<void>} Resolves once the selector shows up.
 */
async function waitForSelector(page: Page, selector: string): Promise<void> {
  try {
    await page.waitForSelector(selector, { timeout: WAIT_FOR_TIMEOUT });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
    throw new BrowserError(waitForMissMessage(selector, WAIT_FOR_TIMEOUT), { cause: error });
  }
}

/**
 * Loads a page and reads its title, HTML, text and links.
 *
 * @param {Page} page - Page to load the URL in.
 * @param {string} url - Address to scrape.
 * @param {ScrapeOptions} [options] - Network idle wait and `waitFor` selector.
 * @returns {Promise<ScrapeResult>} The rendered page.
 */
async function scrapePage(page: Page, url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
  const statusCode = await goto(page, url, options?.waitForNetworkIdle ? "networkidle" : "load");
  if (options?.waitFor !== undefined) await waitForSelector(page, options.waitFor);
  const [title, html, text, links] = await Promise.all([
    page.title(),
    page.content(),
    page.evaluate(() => document.body?.innerText || ""),
    page.evaluate(() =>
      Array.from(
        document.querySelectorAll("a[href]"),
        (anchor) => (anchor as HTMLAnchorElement).href,
      ),
    ),
  ]);
  return { url, title, html, text, statusCode, links: [...new Set(links)] };
}

/**
 * Loads a page and lists its anchors.
 *
 * @param {Page} page - Page to load the URL in.
 * @param {string} url - Address to read.
 * @returns {Promise<LinksResult>} Every `a[href]` in page order.
 */
async function readLinks(page: Page, url: string): Promise<LinksResult> {
  await goto(page, url);
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"), (anchor) => {
      const element = anchor as HTMLAnchorElement;
      return {
        href: element.href,
        text: element.textContent?.trim() || undefined,
        rel: element.rel || undefined,
      };
    }),
  );
  return { url, links };
}

/**
 * Lightpanda's own markdown when that's all the caller wants, the DOM otherwise.
 *
 * @param {ScrapeOptions} [options] - Requested formats.
 * @returns {"markdown" | "html"} The dump format.
 */
function dumpFormat(options?: ScrapeOptions): "markdown" | "html" {
  const formats = options?.formats;
  if (!formats?.includes("markdown")) return "html";
  return formats.includes("html") || formats.includes("cleanedHtml") ? "html" : "markdown";
}

/**
 * Builds the scrape result from what a fetch returned.
 *
 * @param {string} url - Requested address.
 * @param {{ format: "markdown" | "html"; content: string; status?: number }} page - The dump.
 * @returns {ScrapeResult} The result, with the content under the field its format names.
 */
function fetchedResult(
  url: string,
  page: Readonly<{ format: "markdown" | "html"; content: string; status?: number }>,
): ScrapeResult {
  return { url, [page.format]: page.content, statusCode: page.status };
}

/**
 * Turns the cloud's 500 for a dead page into `NavigationError`; a real server fault stays as it was.
 *
 * @param {unknown} error - What `POST /api/fetch` threw.
 * @returns {BrowserError} The navigation failure with Lightpanda's reason, or the normalized error.
 */
function cloudFetchFailure(error: unknown): BrowserError {
  const reason =
    error instanceof HTTPError && error.statusCode === 500
      ? CLOUD_LOAD_FAILURE.exec(error.body)?.[1]
      : undefined;
  if (!reason) return normalizeError(error, PROVIDER);
  return new NavigationError(PROVIDER, reason, undefined, { cause: error, own: true });
}

/**
 * Reads the JSON `lightpanda fetch --json` printed, also when it exited 1 for a failed page.
 *
 * @param {unknown} error - What `execFile` threw, carrying `stdout`.
 * @returns {FetchReport | undefined} The report, or `undefined` when there was none.
 */
function failedReport(error: unknown): FetchReport | undefined {
  if (!(error instanceof Error) || !("stdout" in error) || typeof error.stdout !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(error.stdout) as FetchReport;
  } catch {
    return undefined;
  }
}

/**
 * `lightpanda fetch` takes no `--`, so only a parsed `http(s)` URL, which can't pass for a flag.
 *
 * @param {string} url - Address to fetch.
 * @returns {string} The normalized URL.
 * @throws {InvalidInputError} When `url` is not an `http(s)` address.
 */
function fetchArgument(url: string): string {
  const parsed = URL.parse(url);
  if (parsed?.protocol !== "http:" && parsed?.protocol !== "https:") {
    throw new InvalidInputError("Lightpanda fetches http and https URLs only.");
  }
  return parsed.href;
}

/**
 * The command line for one `lightpanda fetch --json`.
 *
 * @param {FetchRequest} request - What to fetch.
 * @returns {string[]} Arguments after the binary, the URL last.
 */
function fetchArgs(request: Readonly<FetchRequest>): string[] {
  const waitUntil = request.options?.waitForNetworkIdle ? "networkidle" : "load";
  const url = fetchArgument(request.url);
  return ["fetch", "--json", "--dump", request.format, "--wait-until", waitUntil, url];
}

/**
 * Reads a failed `lightpanda fetch`: the report of a page that didn't load, or why it never ran.
 *
 * @param {unknown} error - What `execFile` threw.
 * @param {{ executable: string; signal?: AbortSignal }} run - The binary and the cancellation.
 * @returns {FetchReport} The report, when Lightpanda printed one with an `error`.
 * @throws {BrowserError} The abort, a missing binary, or the failure as it came.
 */
function fetchFailure(
  error: unknown,
  run: Readonly<{ executable: string; signal?: AbortSignal }>,
): FetchReport {
  const report = failedReport(error);
  if (report?.error) return report;
  if (run.signal?.aborted) throw normalizeError(run.signal.reason, PROVIDER);
  throw launchFailure(error, run.executable);
}

/**
 * Runs `lightpanda fetch --json` on one URL.
 *
 * @param {string} executable - The Lightpanda binary.
 * @param {FetchRequest} request - What to fetch.
 * @returns {Promise<FetchReport>} The report; `error` is null when the page loaded.
 */
async function runFetch(executable: string, request: Readonly<FetchRequest>): Promise<FetchReport> {
  const args = fetchArgs(request);
  const signal = request.options?.signal;
  try {
    const { stdout } = await execFileAsync(executable, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: request.options?.timeout ?? FETCH_TIMEOUT,
      signal,
    });
    return JSON.parse(stdout) as FetchReport;
  } catch (error) {
    return fetchFailure(error, { executable, signal });
  }
}

class LightpandaProvider implements BrowserProvider {
  private readonly target: Target;
  private readonly client = defaultClient();
  /** One ask per dead page; a real server fault still gets its retries. */
  private readonly fetchClient = new Client({
    retryable: ({ body }) => !CLOUD_LOAD_FAILURE.test(body),
  });

  constructor(config: ProviderConfig) {
    this.target = resolveTarget(config);
  }

  name(): string {
    return PROVIDER;
  }

  capabilities(): ProviderCapabilities {
    return {
      scrape: true,
      screenshot: false,
      navigate: true,
      evaluate: true,
      sessions: true,
      cdp: true,
      statelessScrape: true,
      statelessScreenshot: false,
      elementScreenshot: false,
      screenshotWaitFor: false,
      scrapeWaitFor: true,
      crawl: false,
      pdf: false,
      links: true,
      search: false,
      extract: false,
    };
  }

  private sessions(): Map<string, SessionRecord> {
    const key = storeKey(this.target);
    let store = sessionStores.get(key);
    if (!store) {
      store = new Map();
      sessionStores.set(key, store);
    }
    return store;
  }

  private record(sessionId: string): SessionRecord {
    const record = sessionStores.get(storeKey(this.target))?.get(sessionId);
    if (!record) throw new SessionNotFoundError(sessionId, PROVIDER);
    return record;
  }

  /**
   * Runs `operation` on the session's page, or on a fresh connection closed once it settles.
   *
   * @param {{ session?: BrowserSession; signal?: AbortSignal }} where - Session and cancellation.
   * @param {(page: Page) => Promise<T>} operation - Work on the page.
   * @returns {Promise<T>} What the operation returned.
   */
  private async withPage<T>(
    where: Readonly<{ session?: BrowserSession; signal?: AbortSignal }>,
    operation: (page: Page) => Promise<T>,
  ): Promise<T> {
    const { session, signal } = where;
    try {
      signal?.throwIfAborted();
      if (session) return await operation(this.record(session.id).connection.page);
      return await this.withFreshPage(operation, signal);
    } catch (error) {
      throw normalizeError(signal?.aborted ? signal.reason : error, PROVIDER);
    }
  }

  /**
   * Opens a connection for one operation, closes it after, and closes it at once on abort.
   *
   * @param {(page: Page) => Promise<T>} operation - Work on the page.
   * @param {AbortSignal} [signal] - Cancellation.
   * @returns {Promise<T>} What the operation returned.
   */
  private async withFreshPage<T>(
    operation: (page: Page) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const connection = await connect(await openEndpoint(this.target, signal));
    const close = (): void => {
      void disconnect(connection);
    };
    signal?.addEventListener("abort", close, { once: true });
    try {
      signal?.throwIfAborted();
      return await operation(connection.page);
    } finally {
      signal?.removeEventListener("abort", close);
      await disconnect(connection);
    }
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const endpoint = await openEndpoint(this.target);
      const connection = await connect(endpoint, options);
      const session: BrowserSession = {
        id: randomUUID(),
        cdpUrl: endpoint.url,
        provider: PROVIDER,
        createdAt: Date.now(),
        metadata: { mode: this.target.kind },
      };
      this.sessions().set(session.id, { session, connection });
      holdProcessSession(session.id, {
        provider: PROVIDER,
        release: async () => this.releaseSession(session.id),
      });
      return { ...session };
    } catch (error) {
      throw this.target.kind === "launch"
        ? launchFailure(error, this.target.executable)
        : normalizeError(error, PROVIDER);
    }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    const record = sessionStores.get(storeKey(this.target))?.get(sessionId);
    return record ? { ...record.session } : null;
  }

  async listSessions(): Promise<BrowserSession[]> {
    const store = sessionStores.get(storeKey(this.target));
    return store ? Array.from(store.values(), ({ session }) => ({ ...session })) : [];
  }

  async releaseSession(sessionId: string): Promise<void> {
    const record = this.record(sessionId);
    this.sessions().delete(sessionId);
    dropProcessSession(sessionId);
    await disconnect(record.connection);
  }

  async scrape(
    url: string,
    options?: ScrapeOptions,
    session?: BrowserSession,
  ): Promise<ScrapeResult> {
    assertUrl(url);
    if (session || options?.waitFor !== undefined || this.target.kind === "attach") {
      return this.withPage({ session, signal: options?.signal }, async (page) =>
        rejectBlockPage(await scrapePage(page, url, options), PROVIDER),
      );
    }
    const format = dumpFormat(options);
    const result =
      this.target.kind === "cloud"
        ? await this.cloudFetch(url, format, options)
        : await this.localFetch(url, format, options);
    return rejectBlockPage(result, PROVIDER);
  }

  private async localFetch(
    url: string,
    format: "markdown" | "html",
    options?: ScrapeOptions,
  ): Promise<ScrapeResult> {
    if (this.target.kind !== "launch") throw new BrowserError("lightpanda fetch runs locally only");
    const report = await runFetch(this.target.executable, { url, format, options });
    if (report.error) throw new NavigationError(PROVIDER, report.error, undefined, { own: true });
    return fetchedResult(url, {
      format,
      content: report.content ?? "",
      status: report.http_status,
    });
  }

  private async cloudFetch(
    url: string,
    format: "markdown" | "html",
    options?: ScrapeOptions,
  ): Promise<ScrapeResult> {
    if (this.target.kind !== "cloud") throw new BrowserError("POST /api/fetch is cloud only");
    try {
      const reply = await this.fetchClient.postJSON<CloudFetchReply>(
        `${this.target.baseURL}/api/fetch`,
        {
          url,
          output_format: format,
          wait_event: options?.waitForNetworkIdle ? "networkIdle" : "load",
        },
        { Authorization: `Bearer ${this.target.token}`, "Content-Type": "application/json" },
        options?.signal,
      );
      if (!reply.status) throw new NavigationError(PROVIDER, "", undefined, { own: true });
      return fetchedResult(url, { format, content: reply.data ?? "", status: reply.status });
    } catch (error) {
      throw cloudFetchFailure(error);
    }
  }

  async screenshot(): Promise<ScreenshotResult> {
    throw new UnsupportedOperationError(
      "Lightpanda doesn't paint pages, so it takes no screenshots. Use cloudflare, browserless or playwright.",
      PROVIDER,
    );
  }

  async navigate(url: string, session: BrowserSession): Promise<void> {
    assertUrl(url);
    await this.withPage({ session }, async (page) => {
      await goto(page, url);
    });
  }

  async evaluate(script: string, session: BrowserSession): Promise<EvaluateResult> {
    return this.withPage({ session }, async (page) => {
      const value: unknown = await page.evaluate((source): unknown => {
        /* oxlint-disable-next-line no-eval -- evaluating the caller's script in the page is the operation */
        const result: unknown = globalThis.eval(source);
        return result;
      }, script);
      return { value };
    });
  }

  async links(
    url: string,
    session?: BrowserSession,
    options?: Readonly<AbortOptions>,
  ): Promise<LinksResult> {
    assertUrl(url);
    return this.withPage({ session, signal: options?.signal }, (page) => readLinks(page, url));
  }

  getCdpUrl(session: BrowserSession): string | undefined {
    return session.cdpUrl;
  }

  async checkAvailability(): Promise<void> {
    const target = this.target;
    try {
      if (target.kind === "launch") await execFileAsync(target.executable, ["version"]);
      else if (target.kind === "attach") {
        await this.client.getJSON(versionRoute(target.endpoint));
      } else await this.cloudFetch("https://example.com", "markdown");
    } catch (error) {
      throw target.kind === "launch"
        ? launchFailure(error, target.executable)
        : normalizeError(error, PROVIDER);
    }
  }
}

export const factory: BrowserProviderFactory = (config) => new LightpandaProvider(config);
