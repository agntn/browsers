import { describe, it, expect, beforeEach } from "vitest";
// Import providers/index to register all providers
import "../src/providers/index";
import { register, create, providers, has } from "../src/core/registry";
import { resetDefaultClientForTests } from "../src/core/client";
import type { BrowserProviderFactory, ProviderConfig, BrowserProvider } from "../src/core/types";

function mockFactory(name: string): BrowserProviderFactory {
  return (config: ProviderConfig): BrowserProvider => ({
    name: () => name,
    capabilities: () => ({
      scrape: false,
      screenshot: false,
      navigate: false,
      evaluate: false,
      sessions: false,
      cdp: false,
      statelessScrape: false,
      statelessScreenshot: false,
      crawl: false,
      pdf: false,
      links: false,
      search: false,
      extract: false,
    }),
    createSession: async () => ({ id: "test", provider: name, createdAt: Date.now() }),
    getSession: async () => null,
    listSessions: async () => [],
    releaseSession: async () => {},
    scrape: async () => ({ url: "" }),
    screenshot: async () => ({ data: "", mimeType: "image/png" }),
    navigate: async () => {},
    evaluate: async () => ({ value: null }),
    getCdpUrl: () => undefined,
    isAvailable: async () => true,
  });
}

describe("registry", () => {
  beforeEach(() => {
    resetDefaultClientForTests();
  });

  it("register + has + providers", () => {
    // Note: providers are already registered by import. Just verify the API works.
    const all = providers();
    expect(all.length).toBeGreaterThan(0);
    expect(has("steel")).toBe(true);
    expect(has("nonexistent")).toBe(false);
  });

  it("create with explicit config", () => {
    const provider = create("steel", { apiKey: "test-key" });
    expect(provider.name()).toBe("steel");
  });

  it("create throws for unknown provider", () => {
    expect(() => create("nonexistent")).toThrow("Unknown provider");
  });

  it("create reads API key from env", () => {
    const key = process.env.STEEL_API_KEY;
    process.env.STEEL_API_KEY = "env-test-key";
    try {
      const provider = create("steel");
      expect(provider.name()).toBe("steel");
    } finally {
      if (key) process.env.STEEL_API_KEY = key;
      else delete process.env.STEEL_API_KEY;
    }
  });
});
