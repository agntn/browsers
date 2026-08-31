import { consola } from "consola";
import { resolveProvider } from "../core/resolve";
import { create } from "../core/registry";
import type { BrowserProvider } from "../core/types";

/**
 * Resolve and create a provider, or terminate with a readable error.
 *
 * @param {string} [preferred] Preferred provider name.
 * @returns {{ name: string; provider: BrowserProvider }} Resolved name and provider.
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
