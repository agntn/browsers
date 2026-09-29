import recording from "../data/scrape-sample.json";
import { PROVIDERS, type ProviderEntry } from "./providers";

/** The page every sample scraped. */
export const SAMPLE_URL = "https://example.com";

/** When `app/data/scrape-sample.json` was recorded, as a date. */
export const RECORDED_ON = recording.at.slice(0, 10);

/** What a scrape handed back, judged from the text itself. */
export type AnswerForm = "html" | "markdown" | "text" | "refused";

/** One step of the path the tool call took, as `scrapeWithSessionWhenNeeded` runs it. */
export interface RouteStep {
  label: string;
  state: "done" | "skipped" | "refused";
}

export interface ScrapeSample {
  provider: ProviderEntry;
  /** Wall time of the whole tool call when it was recorded. */
  ms: number;
  /** The full `browsers_scrape` text, or the error message the tool reported. */
  text: string;
  /** The page as it came back, without the tool's `[provider=…] url` line. */
  body: string;
  /** Characters of page content before any cut, as the tool counted them. */
  length: number;
  form: AnswerForm;
  /** Error class for a refused call. */
  error?: string;
  route: RouteStep[];
}

/**
 * Tells HTML, markdown and plain text apart the way a reader of the answer would.
 *
 * @param {string} body - The page content.
 * @returns {AnswerForm} The form it arrived in.
 */
export function answerForm(body: string): Exclude<AnswerForm, "refused"> {
  const start = body.trimStart();
  if (start.startsWith("<")) return "html";
  if (start.startsWith("---\n") || start.startsWith("# ") || /\]\(https?:\/\//u.test(body)) return "markdown";
  return "text";
}

/**
 * The path a scrape takes for a provider, read from its flags the way the tool does: a provider
 * that scrapes without a session gets one call, one that needs a session gets it opened and
 * released around the call, one without scrape is asked anyway and says no.
 *
 * @param {ProviderEntry} provider - A provider.
 * @returns {RouteStep[]} Create, session, scrape and release.
 */
export function scrapeRoute(provider: ProviderEntry): RouteStep[] {
  const { scrape, statelessScrape } = provider.capabilities;
  const session = scrape && !statelessScrape;
  return [
    { label: "create", state: "done" },
    { label: "session", state: session ? "done" : "skipped" },
    { label: "scrape", state: scrape ? "done" : "refused" },
    { label: "release", state: session ? "done" : "skipped" },
  ];
}

/**
 * The first line of an answer a reader would call content: past a front matter block and blank lines.
 *
 * @param {string} body - The page as it came back.
 * @returns {string} That line, or the body's start when there's nothing else.
 */
export function firstLine(body: string): string {
  const withoutFrontMatter = body.replace(/^---\n[\s\S]*?\n---\n/u, "");
  return withoutFrontMatter.split("\n").find((line) => line.trim() !== "") ?? body;
}

/** One recorded `browsers_scrape` call per provider, in registry order. */
export const SAMPLES: readonly ScrapeSample[] = PROVIDERS.map((provider) => {
  const row = recording.out.find((entry) => entry.provider === provider.key);
  if (!row) throw new Error(`No recorded scrape for ${provider.key}`);
  if (!row.ok) {
    // What the MCP server hands a model when the executor throws.
    const text = `browsers_scrape failed: ${row.message}`;
    return {
      provider,
      ms: row.ms,
      text,
      body: row.message ?? "",
      length: 0,
      form: "refused",
      error: row.error,
      route: scrapeRoute(provider),
    };
  }
  const text = row.text ?? "";
  const body = text.slice(text.indexOf("\n\n") + 2);
  return {
    provider,
    ms: row.ms,
    text,
    body,
    length: row.details?.contentLength ?? body.length,
    form: answerForm(body),
    route: scrapeRoute(provider),
  };
});
