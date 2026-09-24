import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError, UnsupportedOperationError } from "../src/core/errors";
import { create } from "../src/core/registry";
import { createScreenshotProvider } from "../src/core/resolve";
import { screenshotWithSessionWhenNeeded } from "../src/core/utils";

// Nothing listens here, so a request that went out would fail with a network error instead.
const baseURL = "http://127.0.0.1:9";
const session = { id: "session-1", provider: "test", createdAt: 0 };

describe("element screenshots on providers without them", () => {
  it.each(["steel", "anchor", "kernel", "hyperbrowser"])(
    "%s refuses a selector instead of capturing the page",
    async (name) => {
      const provider = await create(name, { apiKey: "test", baseURL });

      const error = await provider
        .screenshot({ url: "https://example.com", selector: "h1" }, session)
        .catch((error: unknown) => error);

      expect(error).toBeInstanceOf(UnsupportedOperationError);
      expect(error).toMatchObject({
        provider: name,
        message: `${name} cannot screenshot a single element. Use cloudflare, browserless or playwright, or drop selector.`,
      });
    },
  );
});

describe("element screenshots through a temporary session", () => {
  it("refuses before opening a session the provider would bill", async () => {
    const steel = await create("steel", { apiKey: "test", baseURL });
    const createSession = vi.spyOn(steel, "createSession");

    await expect(
      screenshotWithSessionWhenNeeded(steel, { url: "https://example.com", selector: "h1" }),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("refuses an empty selector instead of capturing the page", async () => {
    const browserless = await create("browserless", { apiKey: "test", baseURL });
    const screenshot = vi.spyOn(browserless, "screenshot");

    await expect(
      screenshotWithSessionWhenNeeded(browserless, { url: "https://example.com", selector: "" }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(screenshot).not.toHaveBeenCalled();
  });
});

describe("provider choice for element screenshots", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function onlySteelConfigured(): void {
    for (const key of [
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
    vi.stubEnv("STEEL_API_KEY", "test");
  }

  it("skips a provider that would refuse the selector", async () => {
    onlySteelConfigured();

    await expect(createScreenshotProvider(undefined, undefined, "h1")).resolves.toMatchObject({
      name: "playwright",
    });
    await expect(createScreenshotProvider()).resolves.toMatchObject({ name: "steel" });
  });

  it("keeps a provider the caller named", async () => {
    onlySteelConfigured();

    await expect(createScreenshotProvider("steel", undefined, "h1")).resolves.toMatchObject({
      name: "steel",
    });
  });
});
