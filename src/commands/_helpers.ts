import { consola } from "consola";
import { resolveProvider } from "../core/resolve";
import { create } from "../core/registry";
import type { BrowserProvider } from "../core/types";
import { resolveCloudflareBrowser } from "../core/utils";

/**
 * Resolve and create a provider, or terminate with a readable error.
 *
 * @param {string} [preferred] Preferred provider name.
 * @param {string} [browser] Optional Cloudflare browser engine.
 * @returns {{ name: string; provider: BrowserProvider }} Resolved name and provider.
 */
export function resolveAndCreate(
  preferred?: string,
  browser?: string,
): { name: string; provider: BrowserProvider } {
  try {
    const name = resolveProvider(browser && !preferred ? "cloudflare" : preferred);
    const selectedBrowser = resolveCloudflareBrowser(name, browser);
    const provider = create(name, { browser: selectedBrowser });
    return { name, provider };
  } catch (error) {
    consola.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
