import { consola } from "consola";
import { resolveProvider } from "../core/resolve";
import { create } from "../core/registry";
import type { BrowserProvider } from "../core/types";

/**
 * CLI helper: resolve provider name + create instance.
 * Prints user-friendly error and exits on failure.
 */
export function resolveAndCreate(preferred?: string): { name: string; provider: BrowserProvider } {
  try {
    const name = resolveProvider(preferred);
    const provider = create(name);
    return { name, provider };
  } catch (error) {
    consola.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
