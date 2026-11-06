import { wireSchema } from "@agntn/tools";
import { describe, expect, it } from "vite-plus/test";
import type { ProviderOperation } from "../src/core/resolve";
import { builtins } from "../src/providers/index";
import { accessibilityTool, crawlTool, extractTool, linksTool, pdfTool } from "../src/tools";

/** Tools whose `provider` takes only some providers; its description is their `-p` help. */
const tools = [
  { tool: accessibilityTool, operation: "accessibilityTree" },
  { tool: crawlTool, operation: "crawl" },
  { tool: extractTool, operation: "extract" },
  { tool: linksTool, operation: "links" },
  { tool: pdfTool, operation: "pdf" },
] as const;

/**
 * The built-in providers `-p` accepts for an operation.
 *
 * @param {ProviderOperation} operation Method the provider has to implement.
 * @returns {Promise<string[]>} Their registry keys.
 */
async function implementing(operation: ProviderOperation): Promise<string[]> {
  const names: string[] = [];
  for (const entry of builtins) {
    const provider = (await entry.load())({ apiKey: "test-key", accountID: "test-account" });
    if (typeof provider[operation] === "function") names.push(entry.key);
  }
  return names;
}

describe("provider argument of partial tools", () => {
  it.each(tools)("$tool.name names every provider with it", async ({ tool, operation }) => {
    const wire = wireSchema(tool) as { properties: Record<string, { description?: string }> };
    const description = wire.properties.provider?.description ?? "";
    const listed = /^Provider\. One of: ([^.]+)\.$/u.exec(description)?.[1];

    expect(new Set(listed?.split(", "))).toEqual(new Set(await implementing(operation)));
  });
});
