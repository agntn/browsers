import { readdirSync } from "node:fs";
import { defineBuildConfig } from "obuild/config";

/** One input per provider file, so a new provider needs only its file and its manifest entry. */
const providerInputs = readdirSync(new URL("src/providers/", import.meta.url))
  .filter((file) => file.endsWith(".ts") && file !== "index.ts")
  .map((file) => `./src/providers/${file}`);

/** typebox stays inline, since every MCP spawn parses it slower from node_modules. */
const typeboxId = /^typebox(?:\/|$)/u;

export default defineBuildConfig({
  entries: [
    {
      /** One bundle, so the CLI, the MCP server and the providers share one client. */
      type: "bundle",
      input: [
        "./src/index.ts",
        "./src/cli.ts",
        "./src/mcp.ts",
        "./src/tool-operations.ts",
        ...providerInputs,
      ],
      /** Declaration maps would point at a src/ the tarball doesn't carry. */
      dts: { sourcemap: false },
    },
  ],
  hooks: {
    /**
     * obuild marks the typebox peer external by name and by subpath, and both have to go.
     *
     * @param config - The rolldown options obuild hands over.
     */
    rolldownConfig(config) {
      if (!Array.isArray(config.external)) return;
      config.external = config.external.filter((entry) =>
        typeof entry === "string"
          ? !typeboxId.test(entry)
          : !(entry instanceof RegExp && entry.test("typebox/value")),
      );
    },
  },
});
