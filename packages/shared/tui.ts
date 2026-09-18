import stringWidth from "string-width";
import stripAnsi from "strip-ansi";
import { browserToolLabels, type BrowserToolName } from "../../src/tool-contract.ts";

/** Theme surface shared by Pi and OMP tool renderers. */
export interface StatusTheme {
  fg?(color: string, text: string): string;
  bold?(text: string): string;
}

/** Tool row state exposed by either supported harness. */
export interface RenderOptions {
  expanded?: boolean;
  isPartial?: boolean;
  spinnerFrame?: number;
  executionStarted?: boolean;
}

/** Result shape accepted by both supported harness renderers. */
export interface RenderedToolResult {
  content?: ReadonlyArray<unknown>;
  details?: unknown;
  isError?: boolean;
}

/** Visual vocabulary shared by the Pi and OMP browser extensions. */
export const BROWSER_TOOL_SYMBOLS: Readonly<Record<BrowserToolName, string>> = {
  browsers_scrape: "🌐",
  browsers_session: "🪟",
  browsers_release: "⏏️",
  browsers_providers: "🔌",
  browsers_screenshot: "📸",
  browsers_extract: "🧠",
  browsers_crawl: "🕸️",
  browsers_pdf: "📄",
  browsers_links: "🔗",
  browsers_search: "🔎",
  browsers_capabilities: "🧰",
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SUBJECT_WIDTH = 72;
const META_WIDTH = 40;
const FIELD_SCAN_LIMIT = 2048;
const RESULT_BODY_LIMIT = 16_000;
const TERMINAL_UNSAFE = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
const FORMAT_CHARACTER = /\p{Cf}/gu;
const SAFE_FORMAT_CHARACTERS = new Set(["\u200C", "\u200D"]);
const TAB = String.fromCodePoint(0x09);
const MALFORMED_SURROGATE = /\p{Cs}/gu;
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function cutAtGrapheme(text: string, end: number): string {
  let boundary = 0;
  for (const { index, segment } of GRAPHEME_SEGMENTER.segment(text)) {
    if (index + segment.length > end) break;
    boundary = index + segment.length;
  }
  return text.slice(0, boundary);
}

function clip(text: string, maxWidth: number): string {
  if (stringWidth(text) <= maxWidth) return text;

  const contentWidth = Math.max(0, maxWidth - stringWidth("…"));
  let width = 0;
  let clipped = "";
  for (const { segment } of GRAPHEME_SEGMENTER.segment(text)) {
    const segmentWidth = stringWidth(segment);
    if (width + segmentWidth > contentWidth) break;
    clipped += segment;
    width += segmentWidth;
  }
  return `${clipped}…`;
}

function cleanFormatCharacters(text: string): string {
  return text.replaceAll(FORMAT_CHARACTER, (character) =>
    SAFE_FORMAT_CHARACTERS.has(character) ? character : " ",
  );
}

function cleanTerminalText(text: string): string {
  return cleanFormatCharacters(stripAnsi(text.replaceAll(MALFORMED_SURROGATE, "�")))
    .replaceAll(TERMINAL_UNSAFE, " ")
    .replaceAll(/\p{Zs}+/gu, " ")
    .trim();
}

/**
 * Sanitizes and bounds one value before terminal rendering.
 *
 * @param value - Untrusted value crossing the terminal boundary.
 * @param max - Maximum visible code units.
 * @returns {string} A terminal safe value on one line.
 */
export function sanitizeTerminalText(value: unknown, max = SUBJECT_WIDTH): string {
  const text = String(value);
  const bounded =
    text.length > FIELD_SCAN_LIMIT ? `${cutAtGrapheme(text, FIELD_SCAN_LIMIT - 1)}…` : text;
  return clip(cleanTerminalText(bounded), max);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function scalar(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function finiteNumber(record: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function listLength(record: Readonly<Record<string, unknown>>, key: string): number | undefined {
  const value = record[key];
  return Array.isArray(value) ? value.length : undefined;
}

function compact(values: readonly (string | undefined)[]): string[] {
  return values.filter((value): value is string => value !== undefined);
}

function provider(record: Readonly<Record<string, unknown>>): string | undefined {
  return scalar(record, "provider");
}

function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value.toLocaleString("en-US")} ${value === 1 ? singular : plural}`;
}

function countedField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  singular: string,
): string | undefined {
  const value = finiteNumber(record, key);
  return value === undefined ? undefined : count(value, singular);
}

function prefixedField(
  record: Readonly<Record<string, unknown>>,
  key: string,
  prefix: string,
): string | undefined {
  const value = scalar(record, key);
  return value === undefined ? undefined : `${prefix} ${value}`;
}

type CallDescription = Readonly<{ subject?: string; meta: readonly string[] }>;
type CallDescriber = (record: Readonly<Record<string, unknown>>) => CallDescription;

function urlCall(
  record: Readonly<Record<string, unknown>>,
  extra: readonly (string | undefined)[] = [],
): CallDescription {
  return { subject: scalar(record, "url"), meta: compact([provider(record), ...extra]) };
}

const CALL_DESCRIPTIONS: Readonly<Record<BrowserToolName, CallDescriber>> = {
  browsers_scrape: (record) =>
    urlCall(record, [
      scalar(record, "browser"),
      prefixedField(record, "waitFor", "wait"),
      countedField(record, "maxChars", "char"),
    ]),
  browsers_session: (record) => ({
    subject: provider(record),
    meta: compact([scalar(record, "browser"), prefixedField(record, "region", "region")]),
  }),
  browsers_release: (record) => ({
    subject: scalar(record, "sessionId"),
    meta: compact([provider(record), scalar(record, "browser")]),
  }),
  browsers_providers: () => ({ meta: [] }),
  browsers_screenshot: (record) =>
    urlCall(record, [
      scalar(record, "browser"),
      scalar(record, "format"),
      record.fullPage === true ? "full page" : undefined,
      record.fullPage === false ? "viewport" : undefined,
    ]),
  browsers_extract: (record) =>
    urlCall(record, [scalar(record, "browser"), prefixedField(record, "prompt", "prompt")]),
  browsers_crawl: (record) =>
    urlCall(record, [scalar(record, "browser"), countedField(record, "maxPages", "page")]),
  browsers_pdf: (record) => urlCall(record, [scalar(record, "browser")]),
  browsers_links: (record) => urlCall(record, [scalar(record, "browser")]),
  browsers_search: (record) => ({ subject: scalar(record, "query"), meta: [] }),
  browsers_capabilities: (record) => ({ subject: provider(record), meta: [] }),
};

function paint(theme: Readonly<StatusTheme>, color: string, text: string): string {
  return theme.fg ? theme.fg(color, text) : text;
}

function callIcon(options: Readonly<RenderOptions> | undefined): string {
  if (options?.isPartial === false) return "✓";
  if (options?.spinnerFrame !== undefined) {
    return SPINNER_FRAMES[options.spinnerFrame % SPINNER_FRAMES.length] ?? "⠋";
  }
  return options?.executionStarted === true ? "◌" : "·";
}

/**
 * Renders one compact browser tool call for either harness.
 *
 * @param tool - Browser tool name.
 * @param args - Tool arguments, including partial streaming values.
 * @param options - Host rendering state.
 * @param theme - Active host theme.
 * @returns {string} One terminal safe status row.
 */
export function renderToolCall(
  tool: BrowserToolName,
  args: unknown,
  options: Readonly<RenderOptions> | undefined,
  theme: Readonly<StatusTheme>,
): string {
  const record = isRecord(args) ? args : {};
  const description = CALL_DESCRIPTIONS[tool](record);
  const icon = callIcon(options);
  const iconColor = options?.isPartial === false ? "success" : "accent";
  const label = browserToolLabels[tool];
  const title = theme.bold ? theme.bold(label) : label;
  const parts = [
    paint(theme, iconColor, icon),
    paint(theme, "accent", BROWSER_TOOL_SYMBOLS[tool]),
    paint(theme, "toolTitle", title),
  ];
  if (description.subject) {
    parts.push(paint(theme, "dim", sanitizeTerminalText(description.subject)));
  }
  if (description.meta.length > 0) {
    const meta = description.meta
      .map((value) => sanitizeTerminalText(value, META_WIDTH))
      .join(" · ");
    parts.push(paint(theme, "muted", meta));
  }
  return parts.join(" ");
}

type ResultMetaRenderer = (details: Readonly<Record<string, unknown>>) => string[];

function providersMeta(details: Readonly<Record<string, unknown>>): string[] {
  if (!Array.isArray(details.providers)) return [];
  const configured = details.providers.filter(
    (row) => isRecord(row) && row.configured === true,
  ).length;
  return [`${configured}/${details.providers.length} configured`];
}

function sessionMeta(details: Readonly<Record<string, unknown>>): string[] {
  const session = isRecord(details.session) ? details.session : {};
  return compact([scalar(session, "provider"), scalar(session, "id")]);
}

function capabilitiesMeta(details: Readonly<Record<string, unknown>>): string[] {
  const capabilities = isRecord(details.capabilities) ? details.capabilities : {};
  const values = Object.values(capabilities).filter((value) => typeof value === "boolean");
  const supported = values.filter((value) => value).length;
  return compact([
    scalar(details, "provider"),
    values.length > 0 ? `${supported}/${values.length} supported` : undefined,
  ]);
}

const RESULT_META: Readonly<Record<BrowserToolName, ResultMetaRenderer>> = {
  browsers_scrape: (details) =>
    compact([scalar(details, "provider"), countedField(details, "contentLength", "char")]),
  browsers_session: sessionMeta,
  browsers_release: (details) => (details.released === true ? ["released"] : []),
  browsers_providers: providersMeta,
  browsers_screenshot: (details) => compact([scalar(details, "provider")]),
  browsers_extract: (details) => compact([scalar(details, "provider")]),
  browsers_crawl: (details) =>
    compact([countedField(details, "pages", "page"), prefixedField(details, "jobId", "job")]),
  browsers_pdf: (details) =>
    compact([scalar(details, "provider"), countedField(details, "pdfLength", "char")]),
  browsers_links: (details) => {
    const length = listLength(details, "links");
    return length === undefined ? [] : [count(length, "link")];
  },
  browsers_search: (details) => {
    const length = listLength(details, "results");
    return length === undefined ? [] : [count(length, "result")];
  },
  browsers_capabilities: capabilitiesMeta,
};

function resultText(result: Readonly<RenderedToolResult>): string {
  const parts: string[] = [];
  for (const part of result.content ?? []) {
    if (isRecord(part) && typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("\n").trimEnd();
}

function firstLine(text: string): string {
  const end = text.search(/\r?\n/u);
  return end === -1 ? text : text.slice(0, end);
}

function cleanBodyLine(line: string): string {
  return cleanFormatCharacters(stripAnsi(line.replaceAll(MALFORMED_SURROGATE, "�")))
    .replaceAll(TERMINAL_UNSAFE, (character) => (character === TAB ? character : " "))
    .trimEnd();
}

function expandedBody(
  result: Readonly<RenderedToolResult>,
  theme: Readonly<StatusTheme>,
): string[] {
  const text = resultText(result);
  if (text.length === 0) return [];
  const truncated = text.length > RESULT_BODY_LIMIT;
  const bounded = truncated ? cutAtGrapheme(text, RESULT_BODY_LIMIT) : text;
  const lines = bounded
    .split(/\r?\n/u)
    .map((line) => `  ${paint(theme, "toolOutput", cleanBodyLine(line))}`);
  if (truncated) lines.push(`  ${paint(theme, "muted", "… output truncated")}`);
  return lines;
}

function runningResult(
  result: Readonly<RenderedToolResult>,
  options: Readonly<RenderOptions>,
  theme: Readonly<StatusTheme>,
): string {
  const icon =
    options.spinnerFrame === undefined
      ? "◌"
      : (SPINNER_FRAMES[options.spinnerFrame % SPINNER_FRAMES.length] ?? "⠋");
  const message = sanitizeTerminalText(firstLine(resultText(result)));
  return message.length > 0
    ? `${paint(theme, "accent", icon)} ${paint(theme, "dim", message)}`
    : paint(theme, "accent", icon);
}

/**
 * Renders one compact browser tool result for either harness.
 *
 * @param tool - Browser tool name.
 * @param result - Tool result supplied by the host.
 * @param isError - Error state from the host contract.
 * @param options - Host rendering state.
 * @param theme - Active host theme.
 * @returns {string} A compact result row with optional expanded output.
 */
export function renderToolResult(
  tool: BrowserToolName,
  result: Readonly<RenderedToolResult>,
  isError: boolean,
  options: Readonly<RenderOptions>,
  theme: Readonly<StatusTheme>,
): string {
  if (options.isPartial === true && !isError && result.isError !== true) {
    return runningResult(result, options, theme);
  }
  if (isError || result.isError === true) return failedResult(result, theme);
  return completedResult(tool, result, options, theme);
}

function failedResult(result: Readonly<RenderedToolResult>, theme: Readonly<StatusTheme>): string {
  const message = sanitizeTerminalText(firstLine(resultText(result)));
  const parts = [paint(theme, "error", "✗")];
  if (message.length > 0) parts.push(paint(theme, "error", message));
  parts.push(paint(theme, "accent", "(failed)"));
  return parts.join(" ");
}

function completedResult(
  tool: BrowserToolName,
  result: Readonly<RenderedToolResult>,
  options: Readonly<RenderOptions>,
  theme: Readonly<StatusTheme>,
): string {
  const text = resultText(result);
  const details = isRecord(result.details) ? result.details : {};
  const meta = RESULT_META[tool](details).map((value) => sanitizeTerminalText(value, META_WIDTH));
  const parts = [paint(theme, "success", "✓")];
  if (meta.length > 0) parts.push(paint(theme, "muted", meta.join(" · ")));
  if (text.length > 0 && options.expanded !== true) {
    parts.push(paint(theme, "dim", "(expand to view)"));
  }

  const header = parts.join(" ");
  const body = options.expanded === true ? expandedBody(result, theme) : [];
  return body.length > 0 ? [header, ...body].join("\n") : header;
}
