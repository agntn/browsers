import { describe, expect, it, vi } from "vitest";
import { UnsupportedOperationError } from "../src/core/errors";
import { create } from "../src/core/registry";
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
});
