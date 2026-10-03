import { stripVTControlCharacters } from "node:util";
import { renderUsage } from "citty";
import { describe, expect, it } from "vite-plus/test";
import accessibility from "../src/commands/accessibility";
import crawl from "../src/commands/crawl";
import extract from "../src/commands/extract";
import links from "../src/commands/links";
import pdf from "../src/commands/pdf";
import search from "../src/commands/search";
import type { ProviderOperation } from "../src/core/resolve";
import { builtins } from "../src/providers/index";

const commands = [
  {
    name: "accessibility",
    usage: () => renderUsage(accessibility),
    operation: "accessibilityTree",
  },
  { name: "crawl", usage: () => renderUsage(crawl), operation: "crawl" },
  { name: "extract", usage: () => renderUsage(extract), operation: "extract" },
  { name: "links", usage: () => renderUsage(links), operation: "links" },
  { name: "pdf", usage: () => renderUsage(pdf), operation: "pdf" },
  { name: "search", usage: () => renderUsage(search), operation: "search" },
] as const;

/**
 * The built-in providers `-p` accepts for an operation, in registry order.
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

describe("CLI provider help", () => {
  it.each(commands)("browsers $name --help lists every provider with it", async (row) => {
    const usage = stripVTControlCharacters(await row.usage());
    const listed = /--provider=<provider>\s+Provider \(([^)]+)\)/.exec(usage)?.[1];
    expect(listed?.split(", ")).toEqual(await implementing(row.operation));
  });
});
