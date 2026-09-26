import { defineCommand } from "citty";
import { consola } from "consola";
import { resolveAndCreate } from "./_helpers.ts";

export default defineCommand({
  meta: {
    name: "extract",
    description: "Extract structured data from a URL (AI-powered)",
  },
  args: {
    url: {
      type: "positional",
      description: "URL to extract data from",
      required: true,
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Provider (cloudflare, hyperbrowser)",
    },
    browser: {
      type: "string",
      description: "Cloudflare browser engine: kitesurf",
    },
    prompt: {
      type: "string",
      description: "Extraction prompt",
      default: "Extract the main content, title, and key information from this page",
    },
  },
  async run({ args }) {
    const { name: providerName, provider } = await resolveAndCreate(
      args.provider,
      args.browser,
      "extract",
    );
    consola.info(`Extracting via ${providerName}...`);
    try {
      const result = await provider.extract(args.url, { prompt: args.prompt });
      console.log(JSON.stringify(result.data, null, 2));
    } catch (error) {
      consola.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
});
