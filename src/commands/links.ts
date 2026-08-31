import { defineCommand } from "citty";
import { consola } from "consola";
import { resolveAndCreate } from "./_helpers";

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
  },
  async run({ args }) {
    const { name: providerName, provider } = resolveAndCreate(args.provider);
    if (!provider.links) {
      consola.error(`Provider ${providerName} does not support link extraction.`);
      process.exit(1);
    }
    try {
      const result = await provider.links(args.url);
      for (const link of result.links) {
        console.log(link.href);
      }
    } catch (error) {
      consola.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
});
