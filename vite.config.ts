import oxfmt from "@agntn/ox/oxfmt";
import oxlint from "@agntn/ox/oxlint";
import { defineConfig } from "vite-plus";

const readonlyRule = oxlint.rules?.["typescript/prefer-readonly-parameter-types"];
if (
  !Array.isArray(readonlyRule) ||
  readonlyRule[1] === null ||
  typeof readonlyRule[1] !== "object"
) {
  throw new TypeError("@agntn/ox must configure prefer-readonly-parameter-types with options");
}
const sharedReadonlyOptions = readonlyRule[1];

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
  fmt: { ...oxfmt, ignorePatterns: ["CHANGELOG.md", "docs"] },
  /** Keep mutable public request types source-compatible while applying the shared policy elsewhere. */
  lint: {
    ...oxlint,
    rules: {
      ...oxlint.rules,
      "typescript/prefer-readonly-parameter-types": [
        "error",
        {
          ...sharedReadonlyOptions,
          allow: [
            ...(sharedReadonlyOptions.allow ?? []),
            { from: "lib", name: ["AbortSignal", "ErrorOptions", "Headers", "Response"] },
            {
              from: "file",
              name: [
                "BrowserProviderFactory",
                "BrowserSession",
                "ClientOptions",
                "CreateSessionOptions",
                "CrawlOptions",
                "ExtractOptions",
                "PdfOptions",
                "ProviderConfig",
                "ScrapeOptions",
                "ScreenshotOptions",
                "WebSearchOptions",
              ],
            },
            { from: "package", name: ["BrowserContext", "Frame", "Page"], package: "playwright" },
            {
              from: "package",
              name: ["BrowserContext", "Frame", "Page"],
              package: "playwright-core",
            },
            {
              from: "package",
              name: "ToolDefinition",
              package: "@earendil-works/pi-coding-agent",
            },
          ],
        },
      ],
    },
    overrides: [
      {
        files: ["test/**"],
        rules: {
          "typescript/prefer-readonly-parameter-types": "off",
        },
      },
    ],
    ignorePatterns: ["docs"],
  },
});
