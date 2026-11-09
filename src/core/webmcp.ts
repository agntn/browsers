/**
 * WebMCP over CDP: a page registers tools with `document.modelContext.registerTool`, and the
 * `WebMCP` domain lists and runs them. No REST quick action returns what page script returns,
 * so this talks to the browser socket directly. Chromium 152 and Cloudflare's Kitesurf both
 * speak the domain; Playwright can't attach to Kitesurf (`Duplicate target`), hence a bare
 * client on Node's own `WebSocket`.
 */

import {
  BrowserError,
  InvalidInputError,
  NavigationError,
  responseReason,
  TimeoutError,
  UnsupportedOperationError,
} from "./errors.ts";
import type { WebMcpAnnotations, WebMcpTool } from "./types.ts";
import { WEBMCP_CALL_TIMEOUT } from "../tool-contract.ts";

/** Longest a CDP command may go unanswered before the socket counts as dead. */
const COMMAND_TIMEOUT = 30_000;

/** Time the page gets to fire `load`. */
const LOAD_TIMEOUT = 30_000;

/** Quiet time after `load` that closes a list. Radar's tools land 0.5 to 1.4 s after `load`. */
const SETTLE_TIME = 3_000;

/** Longest wait for tools after `load`, for a list to go quiet or a call to find its tool. */
const MAX_SETTLE_TIME = 10_000;

/** How often the wait for tools looks again. */
const POLL_INTERVAL = 100;

/** JSON-RPC code for a method the browser does not know. */
const METHOD_NOT_FOUND = -32_601;

interface Waiter {
  readonly method: string;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface CdpMessage {
  readonly id?: number;
  readonly method?: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
  readonly sessionId?: string;
}

/** One CDP command, sent to the browser or, with `sessionId`, to an attached target. */
interface CdpCommand {
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly sessionId?: string;
}

type CdpListener = (params: Readonly<Record<string, unknown>>, sessionId?: string) => void;

/** A command the browser refused, with the JSON-RPC code that says why. */
class CdpCommandError extends BrowserError {
  readonly code: number | undefined;

  constructor(method: string, error: Readonly<NonNullable<CdpMessage["error"]>>) {
    super(`The browser refused ${method}: ${error.message ?? "no reason given"}`);
    this.name = "CdpCommandError";
    this.code = error.code;
  }
}

/**
 * The error for a command on a socket the browser already closed.
 *
 * @returns {BrowserError} The error.
 */
function closedSocket(): BrowserError {
  return new BrowserError("The browser closed the CDP connection.");
}

/** Node's `WebSocket` (undici) takes `{ headers }` second; `lib.dom` knows only protocols there. */
type NodeWebSocket = new (
  url: string,
  init?: { readonly headers: Readonly<Record<string, string>> },
) => WebSocket;

/** A CDP client over Node's `WebSocket`: commands with replies, and events by method. */
export class CdpSocket {
  private readonly socket: WebSocket;
  private readonly waiters = new Map<number, Waiter>();
  private readonly listeners = new Map<string, Set<CdpListener>>();
  private lastId = 0;

  private constructor(url: string, headers?: Readonly<Record<string, string>>) {
    const Socket = globalThis.WebSocket as unknown as NodeWebSocket;
    this.socket = new Socket(url, headers ? { headers } : undefined);
    this.socket.addEventListener("message", (event) => this.settle(String(event.data)));
    this.socket.addEventListener("close", () => this.failAll());
  }

  /**
   * Opens the socket and waits until it is up.
   *
   * @param {string} url - The browser's `ws://` or `wss://` address.
   * @param {Record<string, string>} [headers] - Upgrade request headers, like `Authorization`.
   * @returns {Promise<CdpSocket>} The open client.
   * @throws {BrowserError} When the browser refuses the connection.
   */
  static async open(url: string, headers?: Readonly<Record<string, string>>): Promise<CdpSocket> {
    const client = new CdpSocket(url, headers);
    await new Promise<void>((resolve, reject) => {
      client.socket.addEventListener("open", () => resolve(), { once: true });
      client.socket.addEventListener(
        "error",
        () => reject(new BrowserError("The browser refused the CDP connection.")),
        { once: true },
      );
    });
    return client;
  }

  /**
   * Sends one command and waits for its reply.
   *
   * @param {CdpCommand} command - Method, parameters and the target session, if any.
   * @returns {Promise<unknown>} The reply's `result`.
   */
  async send(command: Readonly<CdpCommand>): Promise<unknown> {
    if (this.socket.readyState !== WebSocket.OPEN) throw closedSocket();
    this.lastId += 1;
    const id = this.lastId;
    const reply = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        reject(new TimeoutError(COMMAND_TIMEOUT, command.method));
      }, COMMAND_TIMEOUT);
      this.waiters.set(id, { method: command.method, resolve, reject, timer });
    });
    this.socket.send(JSON.stringify({ id, params: {}, ...command }));
    return reply;
  }

  /**
   * Calls `listener` for every event named `method` until the returned function runs.
   *
   * @param {string} method - Event name, like `WebMCP.toolsAdded`.
   * @param {CdpListener} listener - Gets the event's params and the session it came from.
   * @returns {() => void} Stops the listener.
   */
  on(method: string, listener: CdpListener): () => void {
    const set = this.listeners.get(method) ?? new Set<CdpListener>();
    set.add(listener);
    this.listeners.set(method, set);
    return () => set.delete(listener);
  }

  /**
   * Whether either side closed the socket or started to.
   *
   * @returns {boolean} True once it is closing.
   */
  get closed(): boolean {
    return this.socket.readyState >= WebSocket.CLOSING;
  }

  close(): void {
    this.socket.close();
    this.failAll();
  }

  private settle(data: string): void {
    let message: CdpMessage;
    try {
      message = JSON.parse(data) as CdpMessage;
    } catch {
      return;
    }
    if (message.id === undefined) {
      this.dispatch(message);
      return;
    }
    const waiter = this.waiters.get(message.id);
    if (!waiter) return;
    this.waiters.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new CdpCommandError(waiter.method, message.error));
    else waiter.resolve(message.result);
  }

  private dispatch(message: Readonly<CdpMessage>): void {
    if (message.method === undefined) return;
    for (const listener of this.listeners.get(message.method) ?? []) {
      listener(message.params ?? {}, message.sessionId);
    }
  }

  private failAll(): void {
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(closedSocket());
    }
    this.waiters.clear();
  }
}

/** A tool as the `WebMCP` domain reports it, with the frame that registered it. */
interface FrameTool extends WebMcpTool {
  readonly frameId: string;
}

/** What `WebMCP.toolResponded` says about one invocation. */
interface ToolResponse {
  readonly status?: string;
  readonly output?: unknown;
  readonly errorText?: string;
  readonly exception?: { readonly description?: string; readonly value?: unknown };
}

/** Where to open the page, and who to blame when it fails. */
export interface WebMcpPageTarget {
  readonly url: string;
  /** Provider key for errors, like `cloudflare`. */
  readonly provider: string;
}

/** The tab a page opened in, as `Target.attachToTarget` gave it. */
interface AttachedTab {
  readonly sessionId: string;
  readonly targetId: string;
  readonly target: WebMcpPageTarget;
}

/** What one page tool returned. */
export interface WebMcpOutput {
  readonly output: unknown;
  readonly text: string;
}

/**
 * Keeps the hints WebMCP defines and drops the rest, so a page can't widen the result.
 *
 * @param {unknown} value - The `annotations` field of a reported tool.
 * @returns {WebMcpAnnotations | undefined} The known boolean hints, or none.
 */
function annotationsOf(value: unknown): WebMcpAnnotations | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { readOnly, untrustedContent, consequential } = value as Record<string, unknown>;
  const hints = Object.entries({ readOnly, untrustedContent, consequential }).filter(
    ([, hint]) => typeof hint === "boolean",
  );
  return hints.length > 0 ? (Object.fromEntries(hints) as WebMcpAnnotations) : undefined;
}

/**
 * Reads one entry of `WebMCP.toolsAdded`, without the stack trace Chromium attaches.
 *
 * @param {unknown} value - One element of the event's `tools`.
 * @returns {FrameTool | undefined} The tool, or nothing for a malformed entry.
 */
function frameTool(value: unknown): FrameTool | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { name, description, inputSchema, annotations, frameId } = value as Record<string, unknown>;
  if (typeof name !== "string" || typeof frameId !== "string") return undefined;
  const hints = annotationsOf(annotations);
  return {
    name,
    description: typeof description === "string" ? description : "",
    frameId,
    ...(typeof inputSchema === "object" && inputSchema !== null
      ? { inputSchema: inputSchema as Readonly<Record<string, unknown>> }
      : {}),
    ...(hints ? { annotations: hints } : {}),
  };
}

/**
 * Parses an output Chromium sends as a JSON string; Kitesurf sends the object itself.
 *
 * @param {unknown} output - The `output` of `WebMCP.toolResponded`.
 * @returns {unknown} The value the page's `execute` returned.
 */
function parsedOutput(output: unknown): unknown {
  if (typeof output !== "string") return output;
  try {
    return JSON.parse(output) as unknown;
  } catch {
    return output;
  }
}

/**
 * The text parts of an MCP tool result (`{ content: [{ type: "text", text }] }`).
 *
 * @param {unknown} output - Parsed output.
 * @returns {string[] | undefined} The texts, or nothing when the output has no such part.
 */
function textParts(output: unknown): string[] | undefined {
  if (typeof output !== "object" || output === null) return undefined;
  const { content } = output as { readonly content?: unknown };
  if (!Array.isArray(content)) return undefined;
  const texts = content.flatMap((part: unknown) => {
    const { type, text } = (part ?? {}) as { readonly type?: unknown; readonly text?: unknown };
    return type === "text" && typeof text === "string" ? [text] : [];
  });
  return texts.length > 0 ? texts : undefined;
}

/**
 * Turns a tool's output into text for a model: its text parts when it is MCP shaped.
 *
 * @param {unknown} output - Parsed output.
 * @returns {string} The text, or the output as JSON.
 */
export function webmcpOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  const texts = textParts(output);
  if (texts) return texts.join("\n");
  return JSON.stringify(output) ?? "";
}

/**
 * Waits for `ready` to hold, looking every `POLL_INTERVAL`.
 *
 * @param {() => boolean} ready - The condition.
 * @param {number} timeout - Milliseconds before giving up.
 * @returns {Promise<boolean>} Whether it held before the timeout.
 */
async function poll(ready: () => boolean, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (!ready()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
  return true;
}

/** One page in its own tab, with the WebMCP tools it has registered so far. */
export class WebMcpPage {
  private readonly socket: CdpSocket;
  private readonly sessionId: string;
  private readonly targetId: string;
  private readonly target: WebMcpPageTarget;
  private readonly registered = new Map<string, FrameTool>();
  private readonly responses = new Map<string, ToolResponse>();
  /** When `load` fired, or `undefined` before it. */
  private loadedAt: number | undefined;
  private changedAt = 0;

  private constructor(socket: CdpSocket, attached: Readonly<AttachedTab>) {
    this.socket = socket;
    this.sessionId = attached.sessionId;
    this.targetId = attached.targetId;
    this.target = attached.target;
    socket.on("WebMCP.toolsAdded", (params, sessionId) => this.added(params, sessionId));
    socket.on("WebMCP.toolsRemoved", (params, sessionId) => this.removed(params, sessionId));
    socket.on("WebMCP.toolResponded", (params, sessionId) => this.responded(params, sessionId));
    socket.on("Page.loadEventFired", (_params, sessionId) => {
      if (sessionId === this.sessionId) this.loadedAt ??= Date.now();
    });
  }

  /**
   * Opens a tab, turns on the `WebMCP` domain and loads the page in it.
   *
   * @param {CdpSocket} socket - CDP connection to the whole browser.
   * @param {WebMcpPageTarget} target - Page to load and the provider to name in errors.
   * @returns {Promise<WebMcpPage>} The page, loading.
   * @throws {UnsupportedOperationError} When the browser has no `WebMCP` domain.
   * @throws {NavigationError} When the browser could not load the page.
   */
  static async open(socket: CdpSocket, target: Readonly<WebMcpPageTarget>): Promise<WebMcpPage> {
    const { targetId } = (await socket.send({
      method: "Target.createTarget",
      params: { url: "about:blank" },
    })) as { readonly targetId: string };
    const { sessionId } = (await socket.send({
      method: "Target.attachToTarget",
      params: { targetId, flatten: true },
    })) as { readonly sessionId: string };
    const page = new WebMcpPage(socket, { sessionId, targetId, target });
    await page.command("Page.enable");
    await page.command("WebMCP.enable").catch((error: unknown) => {
      if (!(error instanceof CdpCommandError) || error.code !== METHOD_NOT_FOUND) throw error;
      throw new UnsupportedOperationError(
        `The ${target.provider} browser has no WebMCP support.`,
        target.provider,
      );
    });
    const navigated = (await page.command("Page.navigate", { url: target.url })) as {
      readonly errorText?: string;
    };
    if (navigated.errorText) throw new NavigationError(target.provider, navigated.errorText);
    return page;
  }

  /**
   * Waits for the page to load and stop registering tools, then lists them.
   *
   * @returns {Promise<WebMcpTool[]>} Tools in the order the page registered them.
   */
  async tools(): Promise<WebMcpTool[]> {
    await this.settled(
      () => Date.now() - Math.max(this.changedAt, this.loadedAt ?? 0) >= SETTLE_TIME,
    );
    return [...this.registered.values()].map(({ frameId: _frameId, ...tool }) => tool);
  }

  /**
   * Runs one page tool and waits for its answer.
   *
   * @param {string} name - Tool name, as `tools()` lists it.
   * @param {Record<string, unknown>} input - Arguments matching its `inputSchema`.
   * @returns {Promise<WebMcpOutput>} The parsed output and its text.
   * @throws {InvalidInputError} When the page has no tool by that name.
   * @throws {TimeoutError} When the tool gives no answer within `WEBMCP_CALL_TIMEOUT`.
   * @throws {BrowserError} When the tool failed or the page canceled it.
   */
  async call(name: string, input: Readonly<Record<string, unknown>>): Promise<WebMcpOutput> {
    await this.settled(() => this.toolNamed(name) !== undefined);
    const tool = this.toolNamed(name);
    if (!tool) throw this.missing(name);
    const { invocationId } = (await this.command("WebMCP.invokeTool", {
      frameId: tool.frameId,
      toolName: name,
      input,
    })) as { readonly invocationId: string };
    if (!(await this.wait(() => this.responses.has(invocationId), WEBMCP_CALL_TIMEOUT))) {
      await this.command("WebMCP.cancelInvocation", { invocationId }).catch(() => undefined);
      throw new TimeoutError(WEBMCP_CALL_TIMEOUT, `page tool ${JSON.stringify(name)}`);
    }
    return toolOutput(name, this.responses.get(invocationId) ?? {});
  }

  private async command(
    method: string,
    params?: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    return this.socket.send({ method, sessionId: this.sessionId, ...(params ? { params } : {}) });
  }

  /**
   * Waits for `load`, then for `done`, at most `MAX_SETTLE_TIME`.
   *
   * @param {() => boolean} done - The condition that ends the wait.
   * @returns {Promise<void>} Resolves once `done` holds or the time is up.
   * @throws {TimeoutError} When the page never fires `load` and registered no tools either.
   */
  private async settled(done: () => boolean): Promise<void> {
    const loaded = await this.wait(() => this.loadedAt !== undefined, LOAD_TIMEOUT);
    if (!loaded && this.registered.size === 0) {
      throw new TimeoutError(LOAD_TIMEOUT, this.shownUrl());
    }
    await this.wait(done, MAX_SETTLE_TIME);
  }

  /**
   * Waits for `ready`, but not past a closed socket, which is what cancelling leaves.
   *
   * @param {() => boolean} ready - The condition.
   * @param {number} timeout - Milliseconds before giving up.
   * @returns {Promise<boolean>} Whether it held before the timeout.
   * @throws {BrowserError} When the socket closed first.
   */
  private async wait(ready: () => boolean, timeout: number): Promise<boolean> {
    const held = await poll(() => ready() || this.socket.closed, timeout);
    if (this.socket.closed) throw closedSocket();
    return held;
  }

  /**
   * The page's URL as the parser writes it, control characters percent-encoded, for a message.
   *
   * @returns {string} The URL, or its JSON form when it doesn't parse.
   */
  private shownUrl(): string {
    const { url } = this.target;
    return URL.canParse(url) ? new URL(url).href : JSON.stringify(url);
  }

  /**
   * The tool by that name, from the top frame (its ID is the target's) when a frame repeats it.
   *
   * @param {string} name - Tool name.
   * @returns {FrameTool | undefined} The tool, if the page has it.
   */
  private toolNamed(name: string): FrameTool | undefined {
    const matches = [...this.registered.values()].filter((tool) => tool.name === name);
    return matches.find((tool) => tool.frameId === this.targetId) ?? matches[0];
  }

  private missing(name: string): InvalidInputError {
    const names = [...new Set([...this.registered.values()].map((tool) => tool.name))];
    const known =
      names.length > 0 ? `: ${names.map((item) => JSON.stringify(item)).join(", ")}` : "";
    return new InvalidInputError(
      `${this.shownUrl()} has no WebMCP tool ${JSON.stringify(name)}. It has ${names.length}${known}. Call browsers_webmcp_tools to see them.`,
    );
  }

  private added(params: Readonly<Record<string, unknown>>, sessionId?: string): void {
    if (sessionId !== this.sessionId || !Array.isArray(params.tools)) return;
    for (const entry of params.tools as unknown[]) {
      const tool = frameTool(entry);
      if (tool) this.registered.set(`${tool.frameId}\u0000${tool.name}`, tool);
    }
    this.changedAt = Date.now();
  }

  private removed(params: Readonly<Record<string, unknown>>, sessionId?: string): void {
    if (sessionId !== this.sessionId || !Array.isArray(params.tools)) return;
    for (const entry of params.tools as unknown[]) {
      const { name, frameId } = (entry ?? {}) as {
        readonly name?: unknown;
        readonly frameId?: unknown;
      };
      this.registered.delete(`${String(frameId)}\u0000${String(name)}`);
    }
    this.changedAt = Date.now();
  }

  private responded(params: Readonly<Record<string, unknown>>, sessionId?: string): void {
    if (sessionId === this.sessionId && typeof params.invocationId === "string") {
      this.responses.set(params.invocationId, params as ToolResponse);
    }
  }
}

/**
 * Why an invocation failed: Chromium leaves `errorText` empty for a throw and sends a stack.
 *
 * @param {ToolResponse} response - The `WebMCP.toolResponded` params.
 * @returns {string} The reason, or an empty string when the browser sent none.
 */
function failureReason(response: Readonly<ToolResponse>): string {
  const description = response.exception?.description?.split("\n", 1)[0];
  const value = response.exception?.value;
  const thrown = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return response.errorText || description || thrown;
}

/**
 * Reads a finished invocation: its output, or the reason it failed.
 *
 * @param {string} name - Tool name, for the error.
 * @param {ToolResponse} response - The `WebMCP.toolResponded` params.
 * @returns {WebMcpOutput} The parsed output and its text.
 * @throws {BrowserError} When the tool failed, reported an error result, or the page canceled it.
 */
function toolOutput(name: string, response: Readonly<ToolResponse>): WebMcpOutput {
  const tool = JSON.stringify(name);
  if (response.status === "Canceled") throw new BrowserError(`The page canceled tool ${tool}.`);
  if (response.status !== "Completed") {
    throw new BrowserError(
      `Page tool ${tool} failed: ${responseReason(failureReason(response)) ?? "the page gave no reason"}`,
    );
  }
  const output = parsedOutput(response.output);
  const text = webmcpOutputText(output);
  if ((output as { readonly isError?: unknown } | null)?.isError === true) {
    throw new BrowserError(
      `Page tool ${tool} reported an error: ${responseReason(text) ?? "no text"}`,
    );
  }
  return { output, text };
}
