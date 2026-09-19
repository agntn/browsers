import { describe, expect, it, vi } from "vitest";
import { lazy } from "../src/core/lazy";

describe("lazy", () => {
  it("runs the load once for concurrent callers", async () => {
    const load = vi.fn(async () => ({ value: 1 }));
    const get = lazy(load);

    const [first, second] = await Promise.all([get(), get()]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("retries after a rejected load", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("first attempt failed"))
      .mockResolvedValue("loaded");
    const get = lazy(load);

    await expect(get()).rejects.toThrow("first attempt failed");
    await expect(get()).resolves.toBe("loaded");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("turns a synchronous throw into a rejection", async () => {
    const get = lazy<never>(() => {
      throw new Error("threw before returning a promise");
    });

    await expect(get()).rejects.toThrow("threw before returning a promise");
  });
});
