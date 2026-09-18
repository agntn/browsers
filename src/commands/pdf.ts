import { defineCommand } from "citty";
import { consola } from "consola";
import { resolveAndCreate } from "./_helpers";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export default defineCommand({
  meta: {
    name: "pdf",
    description: "Generate a PDF from a URL",
  },
  args: {
    url: {
      type: "positional",
      description: "URL to convert to PDF",
      required: true,
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Provider (cloudflare, browserless)",
    },
    browser: {
      type: "string",
      description: "Cloudflare browser engine: kitesurf",
    },
    output: {
      type: "string",
      alias: "o",
      description: "Output file (default: output.pdf)",
      default: "output.pdf",
    },
    landscape: {
      type: "boolean",
      description: "Landscape orientation",
      default: false,
    },
  },
  async run({ args }) {
    const { name: providerName, provider } = resolveAndCreate(args.provider, args.browser);
    if (!provider.pdf) {
      consola.error(`Provider ${providerName} does not support PDF generation.`);
      process.exit(1);
    }
    consola.info(`Generating PDF via ${providerName}...`);
    try {
      const result = await provider.pdf(args.url, { landscape: args.landscape });
      const outputPath = resolve(args.output);
      const base64Data = result.data.replace(/^data:application\/pdf;base64,/, "");
      writeFileSync(outputPath, Buffer.from(base64Data, "base64"));
      consola.success(`PDF saved to ${outputPath}`);
    } catch (error) {
      consola.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
});
