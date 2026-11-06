import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import {
  resolveProvider,
  _hasKey,
  _keyless,
  providerEnvKey,
  providerEnvHint,
} from "../src/core/resolve";

const PROVIDER_ENV = [
  "STEEL_API_KEY",
  "BROWSERBASE_API_KEY",
  "KERNEL_API_KEY",
  "BROWSERLESS_API_KEY",
  "HYPERBROWSER_API_KEY",
  "ANCHOR_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "AGNTN_CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ACCOUNT_ID",
  "BROWSERS_TEST_CF_WHOAMI",
] as const;

const saved: Record<string, string | undefined> = {};
let home = "";

beforeEach(() => {
  for (const key of PROVIDER_ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  home = mkdtempSync(join(tmpdir(), "browsers-cf-"));
});

afterEach(() => {
  for (const [key, val] of Object.entries(saved)) {
    if (val !== undefined) process.env[key] = val;
    else delete process.env[key];
  }
  rmSync(home, { recursive: true, force: true });
});

/**
 * Log the stand-in cf in with a token file that never expires, so no session outlives the test.
 *
 * @param {readonly string[]} accounts Account IDs the session reaches.
 */
function cfLogin(accounts: readonly string[]): void {
  const file = join(home, "credentials.json");
  writeFileSync(file, JSON.stringify({ oauth_token: "cf-session-token" }));
  process.env.BROWSERS_TEST_CF_WHOAMI = JSON.stringify({
    authenticated: true,
    authSource: `OAuth token from ${file}`,
    accounts: accounts.map((id) => ({ id })),
  });
}

describe("_hasKey", () => {
  it("playwright always has key", async () => {
    expect(_keyless("playwright")).toBe(true);
    expect(await _hasKey("playwright")).toBe(true);
  });

  it("returns false when no env var set", async () => {
    expect(await _hasKey("steel")).toBe(false);
  });

  it("returns true when env var set", async () => {
    process.env.STEEL_API_KEY = "test";
    expect(await _hasKey("steel")).toBe(true);
  });

  it("wants an exported token with an account", async () => {
    expect(await _hasKey("cloudflare")).toBe(false);

    process.env.CLOUDFLARE_API_TOKEN = "test";
    expect(await _hasKey("cloudflare")).toBe(false);

    process.env.AGNTN_CLOUDFLARE_ACCOUNT_ID = "account";
    expect(await _hasKey("cloudflare")).toBe(true);

    delete process.env.AGNTN_CLOUDFLARE_ACCOUNT_ID;
    process.env.CLOUDFLARE_ACCOUNT_ID = "account";
    expect(await _hasKey("cloudflare")).toBe(true);
  });

  it("no longer reads CF_API_TOKEN and CF_ACCOUNT_ID", async () => {
    process.env.CF_API_TOKEN = "test";
    process.env.CF_ACCOUNT_ID = "account";
    try {
      expect(await _hasKey("cloudflare")).toBe(false);
    } finally {
      delete process.env.CF_API_TOKEN;
      delete process.env.CF_ACCOUNT_ID;
    }
  });

  it("takes a cf login that reaches one account", async () => {
    cfLogin(["account"]);
    expect(await _hasKey("cloudflare")).toBe(true);
  });

  it("refuses a cf login that reaches several accounts until one is named", async () => {
    cfLogin(["one", "two"]);
    expect(await _hasKey("cloudflare")).toBe(false);

    process.env.AGNTN_CLOUDFLARE_ACCOUNT_ID = "two";
    expect(await _hasKey("cloudflare")).toBe(true);
  });
});

describe("providerEnvKey", () => {
  it("returns normal env key for standard providers", () => {
    expect(providerEnvKey("steel")).toBe("STEEL_API_KEY");
    expect(providerEnvKey("browserbase")).toBe("BROWSERBASE_API_KEY");
  });

  it("returns the token variable for cloudflare", () => {
    expect(providerEnvKey("cloudflare")).toBe("CLOUDFLARE_API_TOKEN");
  });

  it("names the cf login next to the token", () => {
    expect(providerEnvHint("cloudflare")).toBe("cf auth login or CLOUDFLARE_API_TOKEN");
  });
});

describe("resolveProvider", () => {
  it("throws UnknownProviderError for unknown name", async () => {
    await expect(resolveProvider("nonexistent")).rejects.toThrow("Unknown provider");
  });

  it("throws AuthError when API key missing", async () => {
    await expect(resolveProvider("steel")).rejects.toThrow("Missing API key");
  });

  it("returns preferred when configured", async () => {
    process.env.STEEL_API_KEY = "test";
    expect(await resolveProvider("steel")).toBe("steel");
  });

  it("auto-detects first available", async () => {
    process.env.KERNEL_API_KEY = "test";
    expect(await resolveProvider()).toBe("kernel");
  });

  it("skips Cloudflare with a token but no account, and says why when named", async () => {
    process.env.CLOUDFLARE_API_TOKEN = "test";

    expect(await resolveProvider()).toBe("playwright");
    const error = await resolveProvider("cloudflare").then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toMatchObject({ name: "AuthError", provider: "cloudflare" });
    expect(String(error)).toContain("Set AGNTN_CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID");
  });

  it("tells a caller without any Cloudflare login how to get one", async () => {
    await expect(resolveProvider("cloudflare")).rejects.toThrow("cf auth login");
  });

  it("picks Cloudflare from a cf login alone", async () => {
    cfLogin(["account"]);
    expect(await resolveProvider()).toBe("cloudflare");
    expect(await resolveProvider("cloudflare")).toBe("cloudflare");
  });

  it("playwright resolves without env", async () => {
    expect(await resolveProvider("playwright")).toBe("playwright");
  });
});
