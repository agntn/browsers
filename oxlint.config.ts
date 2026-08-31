import oxlint from "@agntn/ox/oxlint";
import { defineConfig } from "oxlint";

const readonlyRule = oxlint.rules?.["typescript/prefer-readonly-parameter-types"];
if (
  !Array.isArray(readonlyRule) ||
  readonlyRule[1] === null ||
  typeof readonlyRule[1] !== "object"
) {
  throw new TypeError("@agntn/ox must configure prefer-readonly-parameter-types with options");
}
const sharedReadonlyOptions = readonlyRule[1];

/** Keep mutable public request types source-compatible while applying the shared policy elsewhere. */
export default defineConfig({
  ...oxlint,
  rules: {
    ...oxlint.rules,
    "typescript/prefer-readonly-parameter-types": [
      "error",
      {
        ...sharedReadonlyOptions,
        allow: [
          ...(sharedReadonlyOptions.allow ?? []),
          { from: "lib", name: ["AbortSignal", "ErrorOptions", "Headers"] },
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
          { from: "package", name: ["BrowserContext", "Page"], package: "playwright" },
          { from: "package", name: ["BrowserContext", "Page"], package: "playwright-core" },
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
  ignorePatterns: [],
});
