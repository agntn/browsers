import { describe, expect, it, vi } from "vite-plus/test";
import { create } from "../src/core/registry";
import type { BrowserProvider, BrowserProviderFactory } from "../src/core/types";

const factory: BrowserProviderFactory = (config) =>
  ({ name: () => "stub", config }) as unknown as BrowserProvider;

const loads = vi.hoisted(() => ({
  shared: vi.fn<() => Promise<BrowserProviderFactory>>(),
  flaky: vi.fn<() => Promise<BrowserProviderFactory>>(),
}));

vi.mock("../src/providers/index", () => ({
  builtins: [
    { key: "shared", defaultURL: "https://shared.test", load: loads.shared },
    { key: "flaky", defaultURL: "https://flaky.test", load: loads.flaky },
  ],
}));

describe("built-in loader", () => {
  it("runs once for parallel cold calls, since jiti splits overlapping imports", async () => {
    loads.shared.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 5, factory)),
    );

    const instances = await Promise.all([
      create("shared", { apiKey: "a" }),
      create("shared", { apiKey: "b" }),
    ]);
    await create("shared", { apiKey: "c" });

    expect(loads.shared).toHaveBeenCalledTimes(1);
    expect(instances.map((provider) => provider.name())).toEqual(["stub", "stub"]);
  });

  it("runs again after a failed import", async () => {
    loads.flaky.mockRejectedValueOnce(new Error("import failed")).mockResolvedValue(factory);

    await expect(create("flaky")).rejects.toThrow("import failed");
    await expect(create("flaky")).resolves.toMatchObject({
      config: { baseURL: "https://flaky.test" },
    });
    expect(loads.flaky).toHaveBeenCalledTimes(2);
  });
});
