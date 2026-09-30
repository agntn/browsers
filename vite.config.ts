import { readdirSync } from "node:fs";
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

/**
 * Every provider file is its own bundle input, so the manifest's `import()` resolves to a stable
 * `dist/providers/<name>.mjs` that the `./providers/*` export also serves. Read from the
 * directory so a new provider needs only its file and its manifest entry.
 */
const providerEntries = Object.fromEntries(
  readdirSync(new URL("./src/providers/", import.meta.url))
    .filter((file) => file.endsWith(".ts") && file !== "index.ts")
    .map((file) => [`providers/${file.slice(0, -".ts".length)}`, `src/providers/${file}`]),
);

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
    ignorePatterns: ["docs"],
  },
  /**
   * One bundle for every entry, so the CLI, the MCP server and the providers share one copy of the
   * client and the tool executors. Chunks keep stable names under `_chunks`, as obuild wrote them;
   * `test/cli-source.test.ts` looks for the bundled MCP command at `_chunks/mcp.mjs`.
   */
  pack: {
    entry: {
      index: "src/index.ts",
      cli: "src/cli.ts",
      mcp: "src/mcp.ts",
      "tool-operations": "src/tool-operations.ts",
      ...providerEntries,
    },
    dts: true,
    format: "esm",
    platform: "node",
    sourcemap: true,
    hash: false,
    outputOptions: {
      chunkFileNames: "_chunks/[name].mjs",
      /* JSDoc ships once, in the declarations; the runtime files keep only legal and annotation comments. */
      comments: { jsdoc: false },
    },
    /** TypeBox is only a peer, so the CLI and the MCP server carry their own copy. */
    deps: {
      onlyBundle: [/^typebox(?:\/|$)/u],
      alwaysBundle: [/^typebox(?:\/|$)/u],
    },
    /* The inlined typebox carries no license header of its own, so its MIT notice ships beside it. */
    copy: [{ from: "node_modules/typebox/license", rename: "typebox.LICENSE" }],
  },
});
