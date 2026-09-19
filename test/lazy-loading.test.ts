import { describe, expect, it, vi } from "vitest";
import { create, has, providers, register } from "../src/core/registry";
import { resolveProvider } from "../src/core/resolve";
import type { BrowserProvider, BrowserProviderFactory } from "../src/core/types";

/**
 * Each mocked provider module records its own evaluation. vitest runs a mock factory the first
 * time the module is imported, so the list is the import order the registry actually caused.
 */
const loaded = vi.hoisted(() => ({ modules: [] as string[] }));

function stubFactory(name: string): BrowserProviderFactory {
  return (config) => ({ name: () => name, config }) as unknown as BrowserProvider;
}

vi.mock("../src/providers/steel", () => {
  loaded.modules.push("steel");
  return { factory: stubFactory("steel") };
});
vi.mock("../src/providers/kernel", () => {
  loaded.modules.push("kernel");
  return { factory: stubFactory("kernel") };
});

describe("provider loading", () => {
  it("answers listing and resolution from the manifest alone", () => {
    process.env.KERNEL_API_KEY = "test";
    try {
      expect(providers()).toContain("kernel");
      expect(has("kernel")).toBe(true);
      expect(resolveProvider("kernel")).toBe("kernel");
    } finally {
      delete process.env.KERNEL_API_KEY;
    }

    expect(loaded.modules).toEqual([]);
  });

  it("imports only the provider it was asked for", async () => {
    const provider = await create("kernel", { apiKey: "k" });

    expect(loaded.modules).toEqual(["kernel"]);
    expect(provider).toMatchObject({
      config: { apiKey: "k", baseURL: "https://api.onkernel.com" },
    });
  });

  it("shares one import between parallel cold calls", async () => {
    const instances = await Promise.all([
      create("steel", { apiKey: "a" }),
      create("steel", { apiKey: "b" }),
      create("steel", { apiKey: "c" }),
    ]);

    expect(loaded.modules).toEqual(["kernel", "steel"]);
    expect(new Set(instances).size).toBe(3);
  });

  it("builds a registered provider from its own factory", async () => {
    const factory = vi.fn(stubFactory("host"));
    register("host", "https://host.test", factory);

    const provider = await create("host", { apiKey: "h" });

    expect(factory).toHaveBeenCalledWith({ apiKey: "h", baseURL: "https://host.test" });
    expect(provider.name()).toBe("host");
    expect(loaded.modules).toEqual(["kernel", "steel"]);
  });
});
