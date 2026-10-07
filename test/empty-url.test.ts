import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { resetDefaultClientForTests } from "../src/core/client";
import { EmptyUrlError, InvalidInputError } from "../src/core/errors";
import { create, providers } from "../src/core/registry";
import type { BrowserProvider, BrowserSession } from "../src/core/types";
import { scrapeWithSessionWhenNeeded, screenshotWithSessionWhenNeeded } from "../src/core/utils";
import { browserScrape } from "../src/tool-operations";

const session: BrowserSession = { id: "session", provider: "test", createdAt: 0 };

/* Each URL operation called the way a caller would, with a session where the method needs one. */
const calls = {
  scrape: (provider, url) => provider.scrape(url),
  navigate: (provider, url) => provider.navigate(url, session),
  crawl: (provider, url) => provider.crawl?.(url),
  pdf: (provider, url) => provider.pdf?.(url),
  extract: (provider, url) => provider.extract?.(url, { prompt: "title" }),
  links: (provider, url) => provider.links?.(url),
  accessibilityTree: (provider, url) => provider.accessibilityTree?.(url),
} satisfies Record<
  string,
  (provider: BrowserProvider, url: string) => Promise<unknown> | undefined
>;

const operations = Object.keys(calls) as (keyof typeof calls)[];

afterEach(() => {
  vi.unstubAllGlobals();
  resetDefaultClientForTests();
});

describe("empty URL", () => {
  for (const name of providers()) {
    it(`${name} refuses it before any request`, async () => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
      vi.stubGlobal("fetch", fetch);
      resetDefaultClientForTests();
      const provider = await create(name, { apiKey: "key", accountID: "account" });
      const capabilities = provider.capabilities();
      const supported = operations.filter((operation) => capabilities[operation] === true);

      for (const operation of supported) {
        for (const url of ["", " \t\n"]) {
          await expect(
            calls[operation](provider, url),
            `${operation}(${JSON.stringify(url)})`,
          ).rejects.toBeInstanceOf(EmptyUrlError);
        }
      }
      expect(fetch).not.toHaveBeenCalled();
    });

    it(`${name} refuses it next to a session in screenshot`, async () => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
      vi.stubGlobal("fetch", fetch);
      resetDefaultClientForTests();
      const provider = await create(name, { apiKey: "key", accountID: "account" });
      if (!provider.capabilities().screenshot) return;

      for (const url of ["", " \t\n"]) {
        await expect(provider.screenshot({ url }, session)).rejects.toBeInstanceOf(EmptyUrlError);
      }
      expect(fetch).not.toHaveBeenCalled();
    });

    it(`${name} opens no session for it on the CLI and tool path`, async () => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
      vi.stubGlobal("fetch", fetch);
      resetDefaultClientForTests();
      const provider = await create(name, { apiKey: "key", accountID: "account" });
      const createSession = vi.spyOn(provider, "createSession");

      for (const url of ["", " \t\n"]) {
        await expect(scrapeWithSessionWhenNeeded(provider, url)).rejects.toBeInstanceOf(
          EmptyUrlError,
        );
        await expect(screenshotWithSessionWhenNeeded(provider, { url })).rejects.toBeInstanceOf(
          EmptyUrlError,
        );
      }
      expect(createSession).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });
  }

  it("reaches the agent as a call to fix", async () => {
    const result = browserScrape({ provider: "playwright", url: "" });

    await expect(result).rejects.toBeInstanceOf(InvalidInputError);
    await expect(result).rejects.toThrow("URL cannot be empty. Pass the page to open");
  });
});
