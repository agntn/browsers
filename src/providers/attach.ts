import type {
  AbortOptions,
  BrowserProvider,
  BrowserProviderFactory,
  BrowserSession,
  EvaluateResult,
  LinkItem,
  LinksResult,
  ProviderCapabilities,
  ProviderConfig,
  ScrapeOptions,
  ScrapeResult,
  ScreenshotOptions,
  ScreenshotResult,
} from "../core/types.ts";
import { rejectBlockPage } from "../core/block-page.ts";
import {
  BrowserError,
  InvalidInputError,
  SessionNotFoundError,
  TimeoutError,
  UnsupportedOperationError,
  normalizeError,
  responseReason,
} from "../core/errors.ts";
import { assertUrl, assertUrlOrSession, waitForMissMessage } from "../core/utils.ts";
import { dropProcessSession, holdProcessSession } from "../core/process-sessions.ts";
import { randomUUID } from "node:crypto";
import type { Page } from "playwright-core";

const PROVIDER = "attach";

/** Where Chrome and Firefox listen after `--remote-debugging-port=9222`. */
const DEFAULT_ENDPOINT = "http://127.0.0.1:9222";

/** Milliseconds `waitFor` and a selector screenshot wait for their selector. */
const WAIT_FOR_TIMEOUT = 25_000;

/** Milliseconds between two looks for a selector. */
const WAIT_FOR_POLL = 100;

/** Milliseconds one WebDriver BiDi command may take. One read per call stays well under it. */
const COMMAND_TIMEOUT = 30_000;

/** Milliseconds the debugging port gets to say which protocol it speaks. */
const PROBE_TIMEOUT = 5_000;

/** Open tabs the error for a missing one names, so two hundred tabs give the first twenty. */
const LISTED_TABS = 20;

/** Firefox's answer to a second WebDriver BiDi session. */
const BIDI_SESSION_TAKEN = /maximum number of active sessions/i;

/** Title, markup, text, links and the address the tab shows now, read in one call. */
const READ_PAGE = `({
  url: location.href,
  title: document.title,
  html: document.documentElement.outerHTML,
  text: document.body?.innerText ?? "",
  links: [...new Set(Array.from(document.querySelectorAll("a[href]"), (anchor) => anchor.href))],
})`;

/** Every anchor in page order, with its text and `rel`. */
const READ_LINKS = `Array.from(document.querySelectorAll("a[href]"), (anchor) => ({
  href: anchor.href,
  text: anchor.textContent?.trim() || undefined,
  rel: anchor.rel || undefined,
}))`;

type Protocol = "cdp" | "bidi";

/** An element's box in the viewport plus the page scroll, in CSS pixels. */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

/** One capture: the image type, and the box or the whole page when not just the viewport. */
interface Shot {
  readonly format: "png" | "jpeg";
  readonly quality?: number;
  readonly fullPage: boolean;
  readonly clip?: Box;
}

/** An open tab of the user's browser. */
interface Tab {
  readonly url: string;
  /** Runs an expression that yields JSON text, and returns that text parsed. */
  readonly evaluate: (expression: string) => Promise<unknown>;
  /** The capture as base64. */
  readonly capture: (shot: Shot) => Promise<string>;
}

/** A connection to the user's browser. Closing it leaves the browser and its tabs alone. */
interface Connection {
  readonly protocol: Protocol;
  readonly tabs: () => Promise<readonly Tab[]>;
  readonly close: () => Promise<void>;
}

interface SessionRecord {
  readonly session: BrowserSession;
  readonly connection: Connection;
  /** The tab the last call with a URL picked, which `evaluate` runs in. */
  readonly tab?: Tab;
}

/** Which session or fresh connection a call runs on, and the tab it names. */
interface TabRequest {
  readonly session?: BrowserSession;
  readonly url?: string;
  readonly signal?: AbortSignal;
}

/** What `READ_PAGE` returns. */
interface PageRead {
  readonly url: string;
  readonly title: string;
  readonly html: string;
  readonly text: string;
  readonly links: readonly string[];
}

/** A WebDriver BiDi command reply or event, as far as this client reads it. */
interface BidiMessage {
  readonly id?: number;
  readonly type?: string;
  readonly result?: unknown;
  readonly error?: string;
  readonly message?: string;
}

/** What `script.evaluate` answers. */
interface BidiEvaluation {
  readonly type: "success" | "exception";
  readonly result?: { readonly type: string; readonly value?: unknown };
  readonly exceptionDetails?: { readonly text?: string };
}

/** One top-level browsing context from `browsingContext.getTree`. */
interface BidiContext {
  readonly context: string;
  readonly url: string;
}

/** Sends one WebDriver BiDi command and resolves with its `result`. */
type BidiSend = (method: string, params: Readonly<Record<string, unknown>>) => Promise<unknown>;

interface Waiter {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly timer: NodeJS.Timeout;
}

/** Shared by every instance, since agent tools build a new provider per call. */
const sessionStores = new Map<string, Map<string, SessionRecord>>();

/**
 * Tells a loopback host from anything else.
 *
 * @param {string} hostname - `URL.hostname`, brackets included for IPv6.
 * @returns {boolean} True for localhost, 127.0.0.0/8 and `[::1]`.
 */
function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/**
 * The debugging address to use: the config's, then `ATTACH_URL`, then port 9222.
 *
 * @param {ProviderConfig} config - Resolved provider config.
 * @returns {string} The address, checked to be on this machine.
 * @throws {InvalidInputError} For an address that isn't http or ws, or isn't loopback.
 */
function resolveEndpoint(config: Readonly<ProviderConfig>): string {
  const configured = config.baseURL === "local" ? undefined : config.baseURL;
  const raw = configured || process.env.ATTACH_URL || DEFAULT_ENDPOINT;
  const parsed = URL.parse(raw);
  if (!parsed || !/^(?:https?|wss?):$/.test(parsed.protocol)) {
    throw new InvalidInputError(
      `attach wants the http:// or ws:// address of a debugging port, like ${DEFAULT_ENDPOINT}.`,
    );
  }
  if (!isLoopback(parsed.hostname)) {
    throw new InvalidInputError(
      `attach drives a browser on this machine only (localhost, 127.0.0.1 or [::1]), not ${parsed.host}.`,
    );
  }
  return parsed.href;
}

/**
 * Says what to do when nothing answers on the debugging port.
 *
 * @param {string} endpoint - The address tried.
 * @param {unknown} cause - What the connection attempt threw.
 * @returns {BrowserError} The error, with the attempt as `cause`.
 */
function notListening(endpoint: string, cause: unknown): BrowserError {
  return new BrowserError(
    `No browser answers at ${endpoint}. Start it with --remote-debugging-port=9222, or set ATTACH_URL to its debugging address.`,
    { cause },
  );
}

/**
 * CDP when `/json/version` advertises a socket, as Chromium does, else BiDi, as Firefox 404s there.
 *
 * @param {string} endpoint - Checked loopback address.
 * @returns {Promise<{ protocol: Protocol; url: string }>} What to connect to, and how.
 */
async function detectTarget(endpoint: string): Promise<{ protocol: Protocol; url: string }> {
  const url = new URL(endpoint);
  if (url.protocol.startsWith("ws")) {
    return { protocol: url.pathname === "/session" ? "bidi" : "cdp", url: endpoint };
  }
  let response: Response;
  try {
    response = await fetch(new URL("/json/version", url), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    });
  } catch (error) {
    throw notListening(endpoint, error);
  }
  const version = response.ok ? ((await response.json().catch(() => ({}))) as object) : {};
  if ("webSocketDebuggerUrl" in version) return { protocol: "cdp", url: endpoint };
  const socket = url.protocol === "https:" ? "wss:" : "ws:";
  return { protocol: "bidi", url: `${socket}//${url.host}/session` };
}

/**
 * Wraps an expression so it yields JSON text, the one shape both protocols return as it is.
 *
 * @param {string} expression - Page expression; a promise is awaited.
 * @returns {string} The wrapped expression.
 */
function asJson(expression: string): string {
  return `Promise.resolve(${expression}).then((value) => value === undefined ? undefined : JSON.stringify(value))`;
}

/**
 * Parses what an `asJson` expression yielded.
 *
 * @param {unknown} text - JSON text, or nothing for `undefined`.
 * @returns {unknown} The value.
 */
function parseJson(text: unknown): unknown {
  return typeof text === "string" ? JSON.parse(text) : undefined;
}

/**
 * Captures a Chromium tab brought to the front, since a background tab took up to 20s to paint.
 *
 * @param {Page} page - The tab.
 * @param {Shot} shot - What to capture.
 * @returns {Promise<string>} The image as base64.
 */
async function captureCdp(page: Page, shot: Readonly<Shot>): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Page.bringToFront");
    let region: { x: number; y: number; width: number; height: number } | undefined;
    if (shot.clip) {
      const { x, y, width, height, scrollX, scrollY } = shot.clip;
      region = { x: x + scrollX, y: y + scrollY, width, height };
    } else if (shot.fullPage) {
      const { cssContentSize } = await cdp.send("Page.getLayoutMetrics");
      region = { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height };
    }
    const reply = await cdp.send("Page.captureScreenshot", {
      format: shot.format,
      quality: shot.format === "jpeg" ? shot.quality : undefined,
      ...(region ? { clip: { ...region, scale: 1 } } : {}),
      captureBeyondViewport: shot.fullPage && !shot.clip,
    });
    return reply.data;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/**
 * Evaluates in a Chromium tab, cutting a page's error to one line before it reaches the agent.
 *
 * @param {Page} page - The tab.
 * @param {string} expression - An `asJson` expression.
 * @returns {Promise<unknown>} The value.
 */
async function cdpEvaluate(page: Page, expression: string): Promise<unknown> {
  try {
    return parseJson(await page.evaluate(expression));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BrowserError(responseReason(message) ?? "The page threw with no message", {
      cause: error,
    });
  }
}

/**
 * Connects to a Chromium over CDP. Playwright's `close()` on such a connection only disconnects.
 *
 * @param {string} url - The debugging address.
 * @returns {Promise<Connection>} The connection.
 */
async function connectCdp(url: string): Promise<Connection> {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(url);
  return {
    protocol: "cdp",
    tabs: async () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .map((page) => ({
          url: page.url(),
          evaluate: async (expression) => cdpEvaluate(page, expression),
          capture: async (shot) => captureCdp(page, shot),
        })),
    close: async () => {
      await browser.close().catch(() => {});
    },
  };
}

/**
 * The error for a command on a connection the browser already closed.
 *
 * @returns {BrowserError} The error.
 */
function closedConnection(): BrowserError {
  return new BrowserError("The browser closed the WebDriver BiDi connection.");
}

/**
 * A WebDriver BiDi client over Node's own `WebSocket`, enough for one session and its commands.
 */
class BidiSocket {
  readonly url: string;
  private readonly socket: WebSocket;
  private readonly waiters = new Map<number, Waiter>();
  private lastId = 0;

  private constructor(url: string) {
    this.url = url;
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", (event) => this.settle(String(event.data)));
    this.socket.addEventListener("close", () => this.failAll());
  }

  /**
   * Opens the socket and waits until it is up.
   *
   * @param {string} url - The `ws://host:port/session` address.
   * @returns {Promise<BidiSocket>} The open client.
   */
  static async open(url: string): Promise<BidiSocket> {
    const client = new BidiSocket(url);
    await new Promise<void>((resolve, reject) => {
      client.socket.addEventListener("open", () => resolve(), { once: true });
      client.socket.addEventListener("error", (event) => reject(notListening(url, event)), {
        once: true,
      });
    });
    return client;
  }

  /**
   * Sends one command and waits for its reply.
   *
   * @param {string} method - Command name, like `script.evaluate`.
   * @param {Record<string, unknown>} params - Its parameters.
   * @returns {Promise<unknown>} The reply's `result`.
   */
  async send(method: string, params: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (this.socket.readyState !== WebSocket.OPEN) throw closedConnection();
    this.lastId += 1;
    const id = this.lastId;
    const reply = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new TimeoutError(COMMAND_TIMEOUT, this.url));
      }, COMMAND_TIMEOUT);
      this.waiters.set(id, { resolve, reject, timer });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return reply;
  }

  close(): void {
    this.socket.close();
  }

  private settle(data: string): void {
    let message: BidiMessage;
    try {
      message = JSON.parse(data) as BidiMessage;
    } catch {
      return;
    }
    const waiter = message.id === undefined ? undefined : this.waiters.get(message.id);
    if (!waiter || message.id === undefined) return;
    this.waiters.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.type === "success") waiter.resolve(message.result);
    else waiter.reject(new BrowserError(`${message.error ?? "error"}: ${message.message ?? ""}`));
  }

  private failAll(): void {
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(closedConnection());
    }
    this.waiters.clear();
  }
}

/**
 * Reads the JSON text an `asJson` expression left in a `script.evaluate` reply.
 *
 * @param {unknown} reply - The command result.
 * @returns {unknown} The value.
 * @throws {BrowserError} When the page threw.
 */
function bidiValue(reply: unknown): unknown {
  const evaluation = reply as BidiEvaluation;
  if (evaluation.type === "exception") {
    const reason = responseReason(evaluation.exceptionDetails?.text ?? "");
    throw new BrowserError(`The page threw: ${reason ?? "no message"}`);
  }
  return parseJson(evaluation.result?.type === "string" ? evaluation.result.value : undefined);
}

/**
 * Where an element sits in the viewport, after scrolling it into view.
 *
 * @param {Tab} tab - The tab.
 * @param {string} selector - CSS selector of the element.
 * @returns {Promise<Box>} Its box.
 */
async function elementBox(tab: Readonly<Tab>, selector: string): Promise<Box> {
  const box = await tab.evaluate(
    asJson(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.scrollIntoView({ block: "center" });
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height, scrollX, scrollY };
    })()`),
  );
  return box as Box;
}

/**
 * Captures a Firefox tab in front. An element is a viewport box, since BiDi's own clip missed.
 *
 * @param {{ send: BidiSend; context: string }} target - Command sender and the tab's context.
 * @param {Shot} shot - What to capture.
 * @returns {Promise<string>} The image as base64.
 */
async function captureBidi(
  target: Readonly<{ send: BidiSend; context: string }>,
  shot: Readonly<Shot>,
): Promise<string> {
  const clip = shot.clip
    ? {
        type: "box",
        x: shot.clip.x,
        y: shot.clip.y,
        width: shot.clip.width,
        height: shot.clip.height,
      }
    : undefined;
  await target.send("browsingContext.activate", { context: target.context });
  const quality =
    shot.format === "jpeg" && shot.quality !== undefined ? { quality: shot.quality / 100 } : {};
  const reply = (await target.send("browsingContext.captureScreenshot", {
    context: target.context,
    origin: shot.fullPage && !clip ? "document" : "viewport",
    format: { type: `image/${shot.format}`, ...quality },
    ...(clip ? { clip } : {}),
  })) as { readonly data: string };
  return reply.data;
}

/**
 * One tab of a Firefox, by its browsing context.
 *
 * @param {BidiSend} send - Command sender.
 * @param {BidiContext} context - The context from `browsingContext.getTree`.
 * @returns {Tab} The tab.
 */
function bidiTab(send: BidiSend, context: Readonly<BidiContext>): Tab {
  return {
    url: context.url,
    evaluate: async (expression) =>
      bidiValue(
        await send("script.evaluate", {
          expression,
          target: { context: context.context },
          awaitPromise: true,
        }),
      ),
    capture: async (shot) => captureBidi({ send, context: context.context }, shot),
  };
}

/**
 * Opens a WebDriver BiDi session on a Firefox. Firefox allows one at a time, so `close()` ends it.
 *
 * @param {string} url - The `ws://host:port/session` address.
 * @returns {Promise<Connection>} The connection.
 * @throws {BrowserError} When another client holds the session.
 */
async function connectBidi(url: string): Promise<Connection> {
  const socket = await BidiSocket.open(url);
  try {
    await socket.send("session.new", { capabilities: {} });
  } catch (error) {
    socket.close();
    if (error instanceof Error && BIDI_SESSION_TAKEN.test(error.message)) {
      throw new BrowserError(
        `The browser at ${url} already has a WebDriver BiDi session, and Firefox allows one. End the other client's session, or restart the browser.`,
        { cause: error },
      );
    }
    throw error;
  }
  const send: BidiSend = async (method, params) => socket.send(method, params);
  return {
    protocol: "bidi",
    tabs: async () => {
      const tree = (await socket.send("browsingContext.getTree", { maxDepth: 0 })) as {
        readonly contexts: readonly BidiContext[];
      };
      return tree.contexts.map((context) => bidiTab(send, context));
    },
    close: async () => {
      await socket.send("session.end", {}).catch(() => {});
      socket.close();
    },
  };
}

/**
 * Connects to the browser behind a debugging address, over the protocol it speaks.
 *
 * @param {string} endpoint - Checked loopback address.
 * @returns {Promise<Connection>} The connection.
 */
async function connect(endpoint: string): Promise<Connection> {
  const target = await detectTarget(endpoint);
  return target.protocol === "cdp" ? connectCdp(target.url) : connectBidi(target.url);
}

/**
 * An address without its fragment, which a single-page app changes without leaving the page.
 *
 * @param {string} url - Any address.
 * @returns {string} The normalized address, or the input when it doesn't parse.
 */
function withoutHash(url: string): string {
  const parsed = URL.parse(url);
  if (!parsed) return url;
  parsed.hash = "";
  return parsed.href;
}

/**
 * Whether a tab sits at the address or below it, like a book page under the book.
 *
 * @param {string} tab - The tab's address, without fragment.
 * @param {string} wanted - The caller's address, without fragment.
 * @returns {boolean} True for the same address or one under it.
 */
function isUnder(tab: string, wanted: string): boolean {
  if (!tab.startsWith(wanted)) return false;
  return wanted.endsWith("/") || "/?".includes(tab.charAt(wanted.length));
}

/**
 * Picks the tab a call names: the one at that exact address, else the first one under it.
 *
 * @param {readonly Tab[]} tabs - The browser's open tabs.
 * @param {string} url - The caller's address.
 * @returns {Tab} The tab.
 * @throws {InvalidInputError} When no tab matches, naming the open ones.
 */
function pickTab(tabs: readonly Tab[], url: string): Tab {
  const wanted = withoutHash(url);
  const exact = tabs.find((tab) => withoutHash(tab.url) === wanted);
  const match = exact ?? tabs.find((tab) => isUnder(withoutHash(tab.url), wanted));
  if (match) return match;
  const open = tabs.slice(0, LISTED_TABS).map((tab) => tab.url);
  const more = tabs.length > LISTED_TABS ? `, and ${tabs.length - LISTED_TABS} more` : "";
  const listing = open.length > 0 ? `Open tabs: ${open.join(", ")}${more}.` : "No tab is open.";
  throw new InvalidInputError(
    `No open tab at ${URL.parse(url)?.href ?? JSON.stringify(url)}. attach reads tabs you opened and never loads a page itself. ${listing}`,
  );
}

/**
 * Waits until a selector matches in the tab.
 *
 * @param {Tab} tab - The tab.
 * @param {{ selector: string; timeout: number; signal?: AbortSignal }} wait - Selector,
 *   milliseconds to wait, and the caller's cancellation.
 * @returns {Promise<void>} Resolves once it matches.
 * @throws {BrowserError} When it doesn't show up in time.
 */
async function waitForSelector(
  tab: Readonly<Tab>,
  wait: Readonly<{ selector: string; timeout: number; signal?: AbortSignal }>,
): Promise<void> {
  const probe = asJson(`document.querySelector(${JSON.stringify(wait.selector)}) !== null`);
  const deadline = Date.now() + wait.timeout;
  while (Date.now() < deadline) {
    wait.signal?.throwIfAborted();
    if ((await tab.evaluate(probe)) === true) return;
    await new Promise((resolve) => setTimeout(resolve, WAIT_FOR_POLL));
  }
  throw new BrowserError(waitForMissMessage(wait.selector, wait.timeout));
}

/**
 * The image type a capture asks for.
 *
 * @param {ScreenshotOptions["format"]} format - Requested format.
 * @returns {"png" | "jpeg"} PNG by default.
 * @throws {InvalidInputError} For WebP, which neither protocol captures in both browsers.
 */
function shotFormat(format: ScreenshotOptions["format"]): "png" | "jpeg" {
  if (format === "webp") throw new InvalidInputError("attach captures PNG or JPEG, not WebP.");
  return format ?? "png";
}

class AttachProvider implements BrowserProvider {
  private readonly endpoint: string;

  constructor(config: ProviderConfig) {
    this.endpoint = resolveEndpoint(config);
  }

  name(): string {
    return PROVIDER;
  }

  capabilities(): ProviderCapabilities {
    return {
      scrape: true,
      screenshot: true,
      navigate: false,
      evaluate: true,
      sessions: true,
      cdp: false,
      statelessScrape: true,
      statelessScreenshot: true,
      elementScreenshot: true,
      screenshotWaitFor: true,
      scrapeWaitFor: true,
      crawl: false,
      pdf: false,
      links: true,
      search: false,
      extract: false,
    };
  }

  private sessions(): Map<string, SessionRecord> {
    let store = sessionStores.get(this.endpoint);
    if (!store) {
      store = new Map();
      sessionStores.set(this.endpoint, store);
    }
    return store;
  }

  private record(sessionId: string): SessionRecord {
    const record = sessionStores.get(this.endpoint)?.get(sessionId);
    if (!record) throw new SessionNotFoundError(sessionId, PROVIDER);
    return record;
  }

  /**
   * The session's tab: the one `url` names, which the session keeps, or the one it kept.
   *
   * @param {string} sessionId - The session.
   * @param {string} [url] - Address of the tab to pick.
   * @returns {Promise<Tab>} The tab.
   */
  private async sessionTab(sessionId: string, url?: string): Promise<Tab> {
    const record = this.record(sessionId);
    if (url === undefined) {
      if (record.tab) return record.tab;
      throw new InvalidInputError(
        "This attach session has no tab yet. Scrape or screenshot a URL with it first, which picks the tab.",
      );
    }
    const tab = pickTab(await record.connection.tabs(), url);
    this.sessions().set(sessionId, { ...record, tab });
    return tab;
  }

  /**
   * Runs `operation` on the named tab, through the session or a connection closed once it settles.
   *
   * @param {TabRequest} where - Session, tab address and cancellation.
   * @param {(tab: Tab) => Promise<T>} operation - Work on the tab.
   * @returns {Promise<T>} What the operation returned.
   */
  private async withTab<T>(
    where: Readonly<TabRequest>,
    operation: (tab: Tab) => Promise<T>,
  ): Promise<T> {
    const { session, url, signal } = where;
    try {
      signal?.throwIfAborted();
      const result = session
        ? await operation(await this.sessionTab(session.id, url))
        : await this.withFreshTab({ url: url ?? "", signal }, operation);
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      throw normalizeError(signal?.aborted ? signal.reason : error, PROVIDER);
    }
  }

  /**
   * Connects for one operation and disconnects after it, or at once on abort.
   *
   * @param {{ url: string; signal?: AbortSignal }} request - Tab address and cancellation.
   * @param {(tab: Tab) => Promise<T>} operation - Work on the tab.
   * @returns {Promise<T>} What the operation returned.
   */
  private async withFreshTab<T>(
    request: Readonly<{ url: string; signal?: AbortSignal }>,
    operation: (tab: Tab) => Promise<T>,
  ): Promise<T> {
    const connection = await connect(this.endpoint);
    const close = (): void => {
      void connection.close();
    };
    request.signal?.addEventListener("abort", close, { once: true });
    try {
      request.signal?.throwIfAborted();
      return await operation(pickTab(await connection.tabs(), request.url));
    } finally {
      request.signal?.removeEventListener("abort", close);
      await connection.close();
    }
  }

  async createSession(): Promise<BrowserSession> {
    try {
      const connection = await connect(this.endpoint);
      const session: BrowserSession = {
        id: randomUUID(),
        provider: PROVIDER,
        createdAt: Date.now(),
        metadata: { protocol: connection.protocol },
      };
      this.sessions().set(session.id, { session, connection });
      holdProcessSession(session.id, {
        provider: PROVIDER,
        release: async () => this.releaseSession(session.id),
      });
      return { ...session };
    } catch (error) {
      throw normalizeError(error, PROVIDER);
    }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    const record = sessionStores.get(this.endpoint)?.get(sessionId);
    return record ? { ...record.session } : null;
  }

  async listSessions(): Promise<BrowserSession[]> {
    const store = sessionStores.get(this.endpoint);
    return store ? Array.from(store.values(), ({ session }) => ({ ...session })) : [];
  }

  async releaseSession(sessionId: string): Promise<void> {
    const record = this.record(sessionId);
    this.sessions().delete(sessionId);
    dropProcessSession(sessionId);
    await record.connection.close();
  }

  async scrape(
    url: string,
    options?: ScrapeOptions,
    session?: BrowserSession,
  ): Promise<ScrapeResult> {
    assertUrl(url);
    return this.withTab({ session, url, signal: options?.signal }, async (tab) => {
      if (options?.waitFor !== undefined) {
        const timeout = options.timeout ?? WAIT_FOR_TIMEOUT;
        await waitForSelector(tab, { selector: options.waitFor, timeout, signal: options.signal });
      }
      const page = (await tab.evaluate(asJson(READ_PAGE))) as PageRead;
      return rejectBlockPage({ ...page, links: [...page.links] }, PROVIDER);
    });
  }

  async screenshot(
    options: ScreenshotOptions,
    session?: BrowserSession,
  ): Promise<ScreenshotResult> {
    assertUrlOrSession(options.url, session, PROVIDER, "screenshot");
    const format = shotFormat(options.format);
    return this.withTab({ session, url: options.url }, async (tab) => {
      for (const selector of [options.waitFor, options.selector]) {
        if (selector !== undefined)
          await waitForSelector(tab, { selector, timeout: WAIT_FOR_TIMEOUT });
      }
      const data = await tab.capture({
        format,
        quality: options.quality,
        fullPage: options.fullPage ?? false,
        clip: options.selector === undefined ? undefined : await elementBox(tab, options.selector),
      });
      return { data, mimeType: `image/${format}` };
    });
  }

  async navigate(): Promise<void> {
    throw new UnsupportedOperationError(
      "attach never moves your tabs. Open the page in your browser, then scrape or screenshot its URL.",
      PROVIDER,
    );
  }

  async evaluate(script: string, session: BrowserSession): Promise<EvaluateResult> {
    return this.withTab({ session }, async (tab) => {
      const value = await tab.evaluate(asJson(`globalThis.eval(${JSON.stringify(script)})`));
      return { value };
    });
  }

  async links(
    url: string,
    session?: BrowserSession,
    options?: Readonly<AbortOptions>,
  ): Promise<LinksResult> {
    assertUrl(url);
    return this.withTab({ session, url, signal: options?.signal }, async (tab) => ({
      url: tab.url,
      links: (await tab.evaluate(asJson(READ_LINKS))) as LinkItem[],
    }));
  }

  async checkAvailability(): Promise<void> {
    try {
      await (await connect(this.endpoint)).close();
    } catch (error) {
      throw normalizeError(error, PROVIDER);
    }
  }
}

export const factory: BrowserProviderFactory = (config) => new AttachProvider(config);
