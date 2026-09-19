import { defineCommand } from "citty";
import { consola } from "consola";
import { resolveAndCreate } from "./_helpers";
import type { ScrapeResult } from "../core/types";
import { scrapeWithSessionWhenNeeded } from "../core/utils";

function printScrapeResult(
  format: string,
  result: Readonly<Pick<ScrapeResult, "html" | "text" | "markdown">>,
): void {
  switch (format) {
    case "html":
      console.log(result.html ?? "");
      return;
    case "text":
      console.log(result.text ?? "");
      return;
    default:
      console.log(result.markdown ?? result.text ?? result.html ?? "");
  }
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
    const { name: providerName, provider } = await resolveAndCreate(args.provider, args.browser);
    consola.info(`Scraping via ${providerName}...`);

    try {
      const result = await scrapeWithSessionWhenNeeded(provider, args.url, {
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
