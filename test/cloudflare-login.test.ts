import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { resetDefaultClientForTests } from "../src/core/client";
import { create } from "../src/core/registry";

/** Every `refresh` the provider asked `@agntn/credentials` for, in order. */
const lookups = vi.hoisted(() => ({ refresh: [] as boolean[] }));

vi.mock("@agntn/credentials/cloudflare", async (importOriginal) => {
  const original = await importOriginal<typeof import("@agntn/credentials/cloudflare")>();
  return {
    ...original,
    resolve: async (options?: Readonly<{ refresh?: boolean }>) => {
      lookups.refresh.push(options?.refresh === true);
      return original.resolve(options);
    },
  };
});

let home = "";
let tokenFile = "";

beforeEach(() => {
  lookups.refresh.length = 0;
  home = mkdtempSync(join(tmpdir(), "browsers-cf-"));
  tokenFile = join(home, "credentials.json");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetDefaultClientForTests();
  rmSync(home, { recursive: true, force: true });
});

/**
 * Log the stand-in cf in. The token file has no expiry, so credentials never cache it and every
 * lookup reads whatever the file holds at that moment.
 *
 * @param {string} token Token the session hands out first.
 */
function cfLogin(token: string): void {
  writeFileSync(tokenFile, JSON.stringify({ oauth_token: token }));
  vi.stubEnv(
    "BROWSERS_TEST_CF_WHOAMI",
    JSON.stringify({
      authenticated: true,
      authSource: `OAuth token from ${tokenFile}`,
      accounts: [{ id: "cf-account" }],
    }),
  );
}

const refused = (): Response =>
  new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Expired" }] }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });

const markdown = (): Response =>
  new Response(JSON.stringify({ success: true, result: "# Logged in" }), {
    headers: { "Content-Type": "application/json" },
  });

describe("cloudflare through the cf login", () => {
  it("sends the session's token to the session's account", async () => {
    cfLogin("session-token");
    const fetch = vi.fn<typeof globalThis.fetch>(async () => markdown());
    vi.stubGlobal("fetch", fetch);
    const provider = await create("cloudflare");

    const result = await provider.scrape("https://example.com", { formats: ["markdown"] });

    expect(result.markdown).toBe("# Logged in");
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/cf-account/browser-rendering/markdown",
    );
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer session-token",
    );
  });

  it("resends a refused request once with a token cf hands out again", async () => {
    cfLogin("stale-token");
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      if (fetch.mock.calls.length > 1) return markdown();
      writeFileSync(tokenFile, JSON.stringify({ oauth_token: "fresh-token" }));
      return refused();
    });
    vi.stubGlobal("fetch", fetch);
    const provider = await create("cloudflare");

    const result = await provider.scrape("https://example.com", { formats: ["markdown"] });

    expect(result.markdown).toBe("# Logged in");
    expect(
      fetch.mock.calls.map((call) => new Headers(call[1]?.headers).get("authorization")),
    ).toEqual(["Bearer stale-token", "Bearer fresh-token"]);
    expect(lookups.refresh).toEqual([false, true]);
  });

  it("gives up after the fresh token is refused too", async () => {
    cfLogin("stale-token");
    const fetch = vi.fn<typeof globalThis.fetch>(async () => refused());
    vi.stubGlobal("fetch", fetch);
    const provider = await create("cloudflare");

    await expect(provider.scrape("https://example.com")).rejects.toMatchObject({
      name: "AuthError",
      message: "Authentication failed for cloudflare: Expired",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry after the caller gives up", async () => {
    cfLogin("stale-token");
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      controller.abort(new Error("caller left"));
      return refused();
    });
    vi.stubGlobal("fetch", fetch);
    const provider = await create("cloudflare");

    await expect(
      provider.scrape("https://example.com", { signal: controller.signal }),
    ).rejects.toThrow("caller left");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(lookups.refresh).toEqual([false]);
  });

  it("fails an exported token at once, since asking again returns the same one", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "env-token");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "env-account");
    const fetch = vi.fn<typeof globalThis.fetch>(async () => refused());
    vi.stubGlobal("fetch", fetch);
    const provider = await create("cloudflare");

    await expect(provider.scrape("https://example.com")).rejects.toThrow("Authentication failed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never asks for credentials it was handed", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => refused());
    vi.stubGlobal("fetch", fetch);
    const provider = await create("cloudflare", { apiKey: "given", accountID: "given-account" });

    await expect(provider.scrape("https://example.com")).rejects.toThrow("Authentication failed");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(lookups.refresh).toEqual([]);
  });

  it("names the missing login when nothing is configured", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => markdown());
    vi.stubGlobal("fetch", fetch);
    const provider = await create("cloudflare");

    const error = await provider.scrape("https://example.com").then(
      () => undefined,
      (failure: unknown) => failure,
    );

    expect(error).toMatchObject({ name: "AuthError", provider: "cloudflare" });
    expect(String(error)).toContain("run `cf auth login`");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the session's account out of a failure", async () => {
    cfLogin("session-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no route for cf-account", { status: 404 })),
    );
    const provider = await create("cloudflare");

    const error = await provider.scrape("https://example.com").then(
      () => undefined,
      (failure: unknown) => failure,
    );

    expect(String(error)).toContain("/accounts/[account]/browser-rendering/content");
    expect(String(error)).not.toContain("cf-account");
  });
});

describe("cloudflare account from outside", () => {
  it("keeps a strange account ID inside its path segment", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "env-token");
    vi.stubEnv("AGNTN_CLOUDFLARE_ACCOUNT_ID", "../../zones?x=1");
    const fetch = vi.fn<typeof globalThis.fetch>(async () => markdown());
    vi.stubGlobal("fetch", fetch);
    const provider = await create("cloudflare");

    await provider.scrape("https://example.com", { formats: ["markdown"] });

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/..%2F..%2Fzones%3Fx%3D1/browser-rendering/markdown",
    );
  });
});
