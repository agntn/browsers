import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserProvider } from "../src/core/types";
import { browserExtract, browserLinks, browserScrape } from "../src/tool-operations";

const envKeys = [
  "STEEL_API_KEY",
  "BROWSERBASE_API_KEY",
  "KERNEL_API_KEY",
  "BROWSERLESS_API_KEY",
  "HYPERBROWSER_API_KEY",
  "ANCHOR_API_KEY",
  "CF_API_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CF_ACCOUNT_ID",
  "CLOUDFLARE_ACCOUNT_ID",
];

/**
 * Builds a provider stub that scrapes statelessly and implements only the listed operations.
 *
 * @param name - Provider name.
 * @param operations - Optional operations the stub implements.
 * @returns {BrowserProvider} The stub.
 */
const stub = vi.hoisted(
  () => (name: string, operations: Record<string, unknown>) =>
    ({
      name: () => name,
      capabilities: () => ({ scrape: true, statelessScrape: true }),
      scrape: async (url: string) => ({ url, text: `${name} text` }),
      ...operations,
    }) as unknown as BrowserProvider,
);

vi.mock("../src/providers/steel", () => ({ factory: () => stub("steel", {}) }));
vi.mock("../src/providers/playwright", () => ({
  factory: () =>
    stub("playwright", {
      links: async (url: string) => ({ url, links: [{ href: "https://example.test/a" }] }),
    }),
}));

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of envKeys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.STEEL_API_KEY = "test";
});

afterEach(() => {
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("provider selection by operation", () => {
  it("skips a configured provider that lacks the operation", async () => {
    const result = await browserLinks({ url: "https://example.test" });

    expect(result.content[0]?.text).toBe("[provider=playwright] 1 links:\nhttps://example.test/a");
  });

  it("keeps the first configured provider for scrape", async () => {
    const result = await browserScrape({ url: "https://example.test" });

    expect(result.details.provider).toBe("steel");
  });

  it("fails loudly when the named provider lacks the operation", async () => {
    await expect(browserLinks({ url: "https://example.test", provider: "steel" })).rejects.toThrow(
      "Provider steel does not support link extraction.",
    );
  });

  it("names the operation and the checked providers when none can do it", async () => {
    await expect(browserExtract({ url: "https://example.test", prompt: "title" })).rejects.toThrow(
      "No configured provider supports structured extraction (checked: steel, playwright).",
    );
  });
});
