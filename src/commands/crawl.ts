import { defineCommand } from "citty";
import { consola } from "consola";
import { createCrawl } from "../core/resolve.ts";
import type { CrawlPage, CrawlResult } from "../core/types.ts";

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
    if (result.status === "running") {
      consola.info(
        "The crawl job is still running. Pass --job with this ID and the same --provider and --browser to wait for it again.",
      );
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
      required: false,
    },
    job: {
      type: "string",
      description: "Job ID an earlier crawl returned; waits for it instead of crawling again",
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Provider name (cloudflare, hyperbrowser)",
    },
    browser: {
      type: "string",
      description: "Cloudflare browser engine: kitesurf",
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
    try {
      const { name: providerName, read } = await createCrawl(
        { url: args.url, jobId: args.job },
        args.provider,
        args.browser,
      );
      consola.info(
        args.job === undefined
          ? `Crawling via ${providerName}...`
          : `Waiting for crawl job ${args.job} via ${providerName}...`,
      );
      const result = await read({
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
