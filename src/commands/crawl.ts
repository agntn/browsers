import { defineCommand } from "citty";
import { consola } from "consola";
import { resolveAndCreate } from "./_helpers";
import type { CrawlPage, CrawlResult } from "../core/types";

type PrintableCrawlPage = Readonly<Pick<CrawlPage, "url" | "markdown" | "text" | "html">>;

type PrintableCrawlResult = Readonly<Pick<CrawlResult, "jobId" | "status">> & {
  readonly pages: readonly PrintableCrawlPage[];
};

function pageContent(page: PrintableCrawlPage): string {
  if (page.markdown) return page.markdown;
  if (page.text) return page.text;
  if (page.html) return page.html.slice(0, 500);
  return "(no content)";
}

function printCrawlResult(result: PrintableCrawlResult): void {
  if (result.jobId) consola.info(`Job ID: ${result.jobId} (status: ${result.status})`);
  if (result.pages.length === 0) {
    if (result.jobId) {
      consola.info("Crawl is running asynchronously. Use the job ID to check status.");
    }
    return;
  }

  for (const page of result.pages) {
    console.log(`\n--- ${page.url} ---`);
    console.log(pageContent(page));
  }
}

export default defineCommand({
  meta: {
    name: "crawl",
    description: "Crawl a website following links",
  },
  args: {
    url: {
      type: "positional",
      description: "URL to start crawling from",
      required: true,
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Provider name (cloudflare, hyperbrowser)",
    },
    maxPages: {
      type: "string",
      description: "Max pages to crawl (default: 10)",
    },
    maxDepth: {
      type: "string",
      description: "Max link depth (default: 1)",
    },
  },
  async run({ args }) {
    const { name: providerName, provider } = resolveAndCreate(args.provider);
    if (!provider.crawl) {
      consola.error(`Provider ${providerName} does not support crawl.`);
      process.exit(1);
    }
    consola.info(`Crawling via ${providerName}...`);
    try {
      const result = await provider.crawl(args.url, {
        maxPages: args.maxPages ? Number(args.maxPages) : 10,
        maxDepth: args.maxDepth ? Number(args.maxDepth) : 1,
      });
      printCrawlResult(result);
    } catch (error) {
      consola.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
});
