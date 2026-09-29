import { defineCommand } from "citty";
import { consola } from "./_logger.ts";
import { accessibilityOutline, readAccessibilityTree } from "../tool-operations.ts";

export default defineCommand({
  meta: {
    name: "accessibility",
    description: "Print the accessibility tree of a URL",
  },
  args: {
    url: {
      type: "positional",
      description: "URL to read the accessibility tree of",
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
    root: {
      type: "string",
      description: "CSS selector of the element whose subtree to print",
    },
    all: {
      type: "boolean",
      description: "Keep generic and presentational nodes",
    },
  },
  async run({ args }) {
    try {
      const { tree } = await readAccessibilityTree({
        url: args.url,
        provider: args.provider,
        browser: args.browser,
        root: args.root,
        interestingOnly: args.all ? false : undefined,
      });
      console.log(accessibilityOutline(tree).join("\n"));
    } catch (error) {
      consola.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
});
