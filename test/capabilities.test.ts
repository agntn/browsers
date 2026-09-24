import { describe, it, expect } from "vitest";
import { create, providers } from "../src/core/registry";
import type { BrowserProvider, ProviderConfig } from "../src/core/types";

const all = providers();
const testConfig = {
  apiKey: "test-key",
  accountID: "test-account",
} satisfies ProviderConfig;

async function everyProvider(): Promise<BrowserProvider[]> {
  return Promise.all(all.map((name) => create(name, testConfig)));
}

describe("provider capabilities", () => {
  for (const name of all) {
    describe(name, () => {
      it("creates with explicit provider configuration", async () => {
        const provider = await create(name, testConfig);
        expect(provider.name()).toBe(name);
      });

      it("returns capabilities", async () => {
        const provider = await create(name, testConfig);
        const caps = provider.capabilities();
        expect(typeof caps).toBe("object");
        expect(typeof caps.scrape).toBe("boolean");
        expect(typeof caps.screenshot).toBe("boolean");
        expect(typeof caps.elementScreenshot).toBe("boolean");
        expect(typeof caps.navigate).toBe("boolean");
        expect(typeof caps.evaluate).toBe("boolean");
        expect(typeof caps.sessions).toBe("boolean");
        expect(typeof caps.cdp).toBe("boolean");
        expect(typeof caps.crawl).toBe("boolean");
        expect(typeof caps.pdf).toBe("boolean");
        expect(typeof caps.links).toBe("boolean");
        expect(typeof caps.search).toBe("boolean");
        expect(typeof caps.extract).toBe("boolean");
      });

      it("implements all core methods", async () => {
        const provider = await create(name, testConfig);
        expect(typeof provider.createSession).toBe("function");
        expect(typeof provider.getSession).toBe("function");
        expect(typeof provider.listSessions).toBe("function");
        expect(typeof provider.releaseSession).toBe("function");
        expect(typeof provider.scrape).toBe("function");
        expect(typeof provider.screenshot).toBe("function");
        expect(typeof provider.navigate).toBe("function");
        expect(typeof provider.evaluate).toBe("function");
      });
    });
  }
});

describe("capability-specific optional methods", () => {
  it("crawl providers have crawl()", async () => {
    for (const provider of await everyProvider()) {
      if (provider.capabilities().crawl) {
        expect(typeof provider.crawl).toBe("function");
      }
    }
  });

  it("pdf providers have pdf()", async () => {
    for (const provider of await everyProvider()) {
      if (provider.capabilities().pdf) {
        expect(typeof provider.pdf).toBe("function");
      }
    }
  });

  it("search providers have search()", async () => {
    for (const provider of await everyProvider()) {
      if (provider.capabilities().search) {
        expect(typeof provider.search).toBe("function");
      }
    }
  });

  it("extract providers have extract()", async () => {
    for (const provider of await everyProvider()) {
      if (provider.capabilities().extract) {
        expect(typeof provider.extract).toBe("function");
      }
    }
  });

  it("links providers have links()", async () => {
    for (const provider of await everyProvider()) {
      if (provider.capabilities().links) {
        expect(typeof provider.links).toBe("function");
      }
    }
  });
});
