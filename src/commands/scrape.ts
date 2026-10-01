import { defineCommand } from "citty";
import { consola } from "./_logger.ts";
import { resolveCapableProvider } from "./_helpers.ts";
import type { ScrapeResult } from "../core/types.ts";
import { scrapeWithSessionWhenNeeded } from "../core/utils.ts";

/** Fields each format falls back through. Most providers leave `text` empty. */
const FORMAT_FIELDS = {
  html: ["html"],
  text: ["text", "markdown", "html"],
  markdown: ["markdown", "text", "html"],
} as const;

function printScrapeResult(
  format: string,
  result: Readonly<Pick<ScrapeResult, "html" | "text" | "markdown">>,
): void {
  const fields =
    format === "html" || format === "text" ? FORMAT_FIELDS[format] : FORMAT_FIELDS.markdown;
  const field = fields.find((name) => result[name] !== undefined);
  console.log(field === undefined ? "" : result[field]);
}

export default defineCommand({
  meta: {
    name: "scrape",
    description: "Scrape content from a URL using a browser provider",
  },
  args: {
    url: {
      type: "positional",
      description: "URL to scrape",
      required: true,
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Browser provider name (default: first with API key set)",
    },
    browser: {
      type: "string",
      description: "Cloudflare browser engine: kitesurf",
    },
    format: {
      type: "string",
      alias: "f",
      description: "Output format: markdown, text, html",
      default: "markdown",
    },
    waitFor: {
      type: "string",
      description: "CSS selector to wait for before extraction",
    },
    maxChars: {
      type: "string",
      description: "Maximum content length in characters",
    },
  },
  async run({ args }) {
    const { name: providerName, provider } = await resolveCapableProvider(
      args.provider,
      args.browser,
      "scrape",
    );
    consola.info(`Scraping via ${providerName}...`);

    try {
      const result = await scrapeWithSessionWhenNeeded(provider, args.url, {
        formats:
          args.format === "text" ? ["text", "markdown"] : [args.format as "markdown" | "html"],
        waitFor: args.waitFor,
        maxChars: args.maxChars ? Number(args.maxChars) : undefined,
      });
      printScrapeResult(args.format, result);
    } catch (error) {
      consola.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
});
