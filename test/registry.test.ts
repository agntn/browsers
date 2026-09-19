import { readdirSync } from "node:fs";
import { describe, it, expect, beforeEach } from "vitest";
import { create, providers, has } from "../src/core/registry";
import { resetDefaultClientForTests } from "../src/core/client";
import { builtins } from "../src/providers/index";
import { browserProviderNames } from "../src/tool-contract";

describe("registry", () => {
  beforeEach(() => {
    resetDefaultClientForTests();
  });

  it("register + has + providers", () => {
    const all = providers();
    expect(all.length).toBeGreaterThan(0);
    expect(has("steel")).toBe(true);
    expect(has("nonexistent")).toBe(false);
  });

  it("create with explicit config", async () => {
    const provider = await create("steel", { apiKey: "test-key" });
    expect(provider.name()).toBe("steel");
  });

  it("create rejects an unknown provider", async () => {
    await expect(create("nonexistent")).rejects.toThrow("Unknown provider");
  });

  it("create reads API key from env", async () => {
    const key = process.env.STEEL_API_KEY;
    process.env.STEEL_API_KEY = "env-test-key";
    try {
      const provider = await create("steel");
      expect(provider.name()).toBe("steel");
    } finally {
      if (key) process.env.STEEL_API_KEY = key;
      else delete process.env.STEEL_API_KEY;
    }
  });
});

describe("built-in manifest", () => {
  it("lists the providers the tool contract advertises, in that order", () => {
    expect(builtins.map((entry) => entry.key)).toEqual([...browserProviderNames]);
    expect(providers()).toEqual([...browserProviderNames]);
  });

  it("has one entry per provider file", () => {
    const files = readdirSync(new URL("../src/providers/", import.meta.url))
      .filter((file) => file.endsWith(".ts") && file !== "index.ts")
      .map((file) => file.slice(0, -3))
      .sort();
    expect(builtins.map((entry) => entry.key).sort()).toEqual(files);
  });

  it("loads a factory that builds the provider it is listed under", async () => {
    for (const entry of builtins) {
      const factory = await entry.load();
      const provider = factory({ apiKey: "test-key", accountID: "test-account" });
      expect(provider.name()).toBe(entry.key);
    }
  });
});
