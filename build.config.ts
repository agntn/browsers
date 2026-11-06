import { readdirSync } from "node:fs";
import { defineBuildConfig } from "obuild/config";

/** One input per provider file, so a new provider needs only its file and its manifest entry. */
const providerInputs = readdirSync(new URL("src/providers/", import.meta.url))
  .filter((file) => file.endsWith(".ts") && file !== "index.ts")
  .map((file) => `./src/providers/${file}`);

export default defineBuildConfig({
  entries: [
    {
      /** One bundle, so the CLI, the MCP server and the providers share one client. */
      type: "bundle",
      input: [
        "./src/index.ts",
        "./src/cli.ts",
        "./src/mcp.ts",
        "./src/mcp-stdio.ts",
        "./src/tools.ts",
        "./src/tool-operations.ts",
        ...providerInputs,
      ],
      /** Declaration maps would point at a src/ the tarball doesn't carry. */
      dts: { sourcemap: false },
    },
  ],
});
