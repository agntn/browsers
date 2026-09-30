import { BlockedPageError } from "./errors.ts";
import type { ScrapeResult } from "./types.ts";

/** Most visible text a block page has. The recorded Reddit ones run 221 to 987 characters. */
const MAX_BLOCK_PAGE_CHARS = 2000;

/** Elements whose content a reader never sees. */
const HIDDEN_ELEMENTS = new Set(["head", "script", "style", "svg", "noscript", "template"]);

/** The fields a block page shows up in. */
type PageFields = Readonly<Pick<ScrapeResult, "title" | "html" | "markdown" | "text">>;

interface BlockPage {
  /** How the error names the page. */
  readonly page: string;
  /** Exact lowercased title, when the signature needs one. */
  readonly title?: string;
  /** Marker anywhere in the HTML source, scripts included. */
  readonly source?: string;
  /** Lowercased phrases that all appear in the visible text. */
  readonly text: readonly string[];
}

const BLOCK_PAGES: readonly BlockPage[] = [
  {
    page: "a Cloudflare challenge",
    title: "just a moment...",
    source: "challenges.cloudflare.com",
    text: [],
  },
  {
    page: "a Reddit block page",
    text: ["whoa there, pardner!", "blocked due to a network policy"],
  },
  { page: "a Reddit block page", text: ["blocked by network security", "blocked by mistake"] },
  { page: "a Reddit captcha", text: ["prove your humanity", "reddit, inc."] },
];

function collapse(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim().toLowerCase();
}

function htmlTitle(html: string): string | undefined {
  const lower = html.toLowerCase();
  const tag = lower.indexOf("<title");
  if (tag === -1) return undefined;
  const open = lower.indexOf(">", tag);
  const close = open === -1 ? -1 : lower.indexOf("</title", open);
  return close === -1 ? undefined : html.slice(open + 1, close);
}

/**
 * Finds where the tag at `tag` ends, past the content of a hidden element.
 *
 * @param lower - Lowercased HTML.
 * @param tag - Index of the tag's `<`.
 * @returns {number} Index of the closing `>`, or -1 when the page ends first.
 */
function tagEnd(lower: string, tag: number): number {
  const name = /^<([a-z]+)/.exec(lower.slice(tag, tag + 12))?.[1];
  const close = name && HIDDEN_ELEMENTS.has(name) ? lower.indexOf(`</${name}`, tag) : tag;
  return close === -1 ? -1 : lower.indexOf(">", close);
}

/**
 * Collects the visible text of an HTML page, with `indexOf` so a hostile page stays linear.
 *
 * @param html - Page source.
 * @returns {string | undefined} The text, or `undefined` once it outgrows a block page.
 */
function htmlText(html: string): string | undefined {
  const lower = html.toLowerCase();
  let text = "";
  let index = 0;
  while (index < html.length) {
    const tag = lower.indexOf("<", index);
    const chunk = collapse(html.slice(index, tag === -1 ? undefined : tag));
    if (chunk) text += ` ${chunk}`;
    if (text.length > MAX_BLOCK_PAGE_CHARS + 1) return undefined;
    if (tag === -1) break;
    const end = tagEnd(lower, tag);
    if (end === -1) break;
    index = end + 1;
  }
  return text;
}

/**
 * Cuts `data:` URIs out of markdown, since an inlined image is no text.
 *
 * @param markdown - Page as markdown.
 * @returns {string} The markdown without them.
 */
function markdownText(markdown: string): string {
  let text = "";
  let index = 0;
  while (index < markdown.length) {
    const uri = markdown.indexOf("(data:", index);
    if (uri === -1) return text + markdown.slice(index);
    text += markdown.slice(index, uri);
    const end = markdown.indexOf(")", uri);
    if (end === -1) break;
    index = end + 1;
  }
  return text;
}

function visibleText(result: PageFields): string | undefined {
  if (result.markdown !== undefined) return markdownText(result.markdown);
  if (result.html !== undefined) return htmlText(result.html);
  return result.text;
}

/**
 * Names the block or challenge page a scrape got. A long page never counts as one.
 *
 * @param result - Scrape result as the provider built it.
 * @returns {string | undefined} What the page is, like `a Reddit captcha`, or `undefined`.
 */
export function blockPage(result: PageFields): string | undefined {
  const raw = visibleText(result);
  if (raw === undefined) return undefined;
  const text = collapse(raw);
  if (text.length > MAX_BLOCK_PAGE_CHARS) return undefined;
  const title = collapse(result.title || (result.html && htmlTitle(result.html)) || "");
  const source = result.html?.toLowerCase() ?? "";
  return BLOCK_PAGES.find(
    (signature) =>
      (signature.title === undefined || signature.title === title) &&
      (signature.source === undefined || source.includes(signature.source)) &&
      signature.text.every((phrase) => text.includes(phrase)),
  )?.page;
}

/**
 * Passes a scrape result through, or throws when it is a block or challenge page.
 *
 * @param result - Scrape result as the provider built it.
 * @param provider - Provider key, named in the error.
 * @returns {T} The same result.
 * @throws {BlockedPageError} When the provider got a block or challenge page.
 */
export function rejectBlockPage<T extends PageFields>(result: T, provider: string): T {
  const page = blockPage(result);
  if (page) throw new BlockedPageError(provider, page);
  return result;
}
