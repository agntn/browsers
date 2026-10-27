import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { InvalidInputError, UnsupportedOperationError } from "../src/core/errors";
import { create } from "../src/core/registry";
import { createCapableProvider, scrapeCapabilities } from "../src/core/resolve";
import { scrapeWithSessionWhenNeeded } from "../src/core/utils";
import type { BrowserProvider } from "../src/core/types";

/** Nothing listens here, so a request that went out would fail with a network error instead. */
const baseURL = "http://127.0.0.1:9";

describe("waiting scrapes on providers that read the page right away", () => {
  it.each(["steel", "browserbase", "hyperbrowser"])(
    "%s refuses waitFor instead of reading the page too early",
    async (name) => {
      const provider = await create(name, { apiKey: "test", baseURL });

      const error = await provider
        .scrape("https://example.com", { waitFor: ".quote" })
        .catch((error: unknown) => error);

      expect(error).toBeInstanceOf(UnsupportedOperationError);
      expect(error).toMatchObject({
        provider: name,
        message: `${name} cannot wait for a selector before a scrape. Use kernel, browserless, cloudflare or playwright, or drop waitFor.`,
      });
    },
  );

  it("refuses before opening a session for a provider without the flag", async () => {
    const kernel = await create("kernel", { apiKey: "test", baseURL });
    const createSession = vi.fn<BrowserProvider["createSession"]>();
    const unflagged: BrowserProvider = Object.assign(Object.create(kernel) as BrowserProvider, {
      capabilities: () => ({ ...kernel.capabilities(), scrapeWaitFor: false }),
      createSession,
    });

    await expect(
      scrapeWithSessionWhenNeeded(unflagged, "https://example.com", { waitFor: ".quote" }),
    ).rejects.toThrow(UnsupportedOperationError);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("refuses an empty waitFor instead of reading at once", async () => {
    const browserless = await create("browserless", { apiKey: "test", baseURL });
    const scrape = vi.spyOn(browserless, "scrape");

    await expect(
      scrapeWithSessionWhenNeeded(browserless, "https://example.com", { waitFor: "" }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(scrape).not.toHaveBeenCalled();
  });
});

describe("provider choice for waiting scrapes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function onlyConfigured(names: readonly string[]): void {
    for (const key of [
      "STEEL_API_KEY",
      "BROWSERBASE_API_KEY",
      "KERNEL_API_KEY",
      "BROWSERLESS_API_KEY",
      "HYPERBROWSER_API_KEY",
      "ANCHOR_API_KEY",
      "CF_API_TOKEN",
      "CLOUDFLARE_API_TOKEN",
    ]) {
      vi.stubEnv(key, "");
    }
    for (const name of names) vi.stubEnv(`${name.toUpperCase()}_API_KEY`, "test");
  }

  it("skips a provider that would read before waitFor shows up", async () => {
    onlyConfigured(["steel", "browserbase", "hyperbrowser"]);

    await expect(
      createCapableProvider(undefined, undefined, scrapeCapabilities({ waitFor: ".quote" })),
    ).resolves.toMatchObject({ name: "playwright" });
    await expect(
      createCapableProvider(undefined, undefined, scrapeCapabilities({ waitFor: undefined })),
    ).resolves.toMatchObject({ name: "steel" });
  });

  it("picks the first configured provider that waits", async () => {
    onlyConfigured(["steel", "browserless"]);

    await expect(
      createCapableProvider(undefined, undefined, scrapeCapabilities({ waitFor: ".quote" })),
    ).resolves.toMatchObject({ name: "browserless" });
  });

  it("keeps a provider the caller named", async () => {
    onlyConfigured(["steel"]);

    await expect(
      createCapableProvider("steel", undefined, scrapeCapabilities({ waitFor: ".quote" })),
    ).resolves.toMatchObject({ name: "steel" });
  });
});
