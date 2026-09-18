import { defineCommand } from "citty";
import { consola } from "consola";
import { browserLinks } from "../tool-operations";

export default defineCommand({
  meta: {
    name: "links",
    description: "Extract all links from a URL",
  },
  args: {
    url: {
      type: "positional",
      description: "URL to extract links from",
      required: true,
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Provider (cloudflare)",
    },
    browser: {
      type: "string",
      description: "Cloudflare browser engine: kitesurf",
    },
  },
  async run({ args }) {
    try {
      const result = await browserLinks({
        url: args.url,
        provider: args.provider,
        browser: args.browser,
      });
      for (const link of result.details.links) {
        console.log(link);
      }
    } catch (error) {
      consola.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
});
