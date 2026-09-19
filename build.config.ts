import { readdirSync } from "node:fs";
import { defineBuildConfig } from "obuild/config";

/**
 * Every provider file is its own bundle input, so the manifest's `import()` resolves to a stable
 * `dist/providers/<name>.mjs` that the `./providers/*` export also serves. Read from the
 * directory so a new provider needs only its file and its manifest entry.
 */
const providerInputs = readdirSync(new URL("./src/providers/", import.meta.url))
  .filter((file) => file.endsWith(".ts") && file !== "index.ts")
  .map((file) => `./src/providers/${file}`);

export default defineBuildConfig({
  entries: [
    {
      type: "bundle",
      input: [
        "./src/index.ts",
        "./src/cli.ts",
        "./src/mcp.ts",
        "./src/tool-operations.ts",
        ...providerInputs,
      ],
    },
  ],
  hooks: {
    /**
     * Keeps TypeBox inside the MCP bundle instead of paying module resolution on every spawn.
     *
     * @param config - Mutable Rolldown configuration assembled by obuild.
     */
    rolldownConfig(config) {
      const externals = Array.isArray(config.external) ? config.external : [];
      config.external = externals.filter(
        (entry) => entry !== "typebox" && !(entry instanceof RegExp && entry.test("typebox/value")),
      );
    },
  },
});
