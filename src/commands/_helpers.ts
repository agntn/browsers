import { consola } from "./_logger.ts";
import {
  createCapableProvider,
  createProvider,
  createScreenshotProvider,
} from "../core/resolve.ts";
import type { ProviderCapability, ProviderOperation, ProviderWith } from "../core/resolve.ts";
import type { BrowserProvider } from "../core/types.ts";

/**
 * Resolve and create a provider, or terminate with a readable error.
 *
 * @param {string} [preferred] Preferred provider name.
 * @param {string} [browser] Optional Cloudflare browser engine.
 * @param {ProviderOperation} [operation] Operation the provider has to implement.
 * @returns {Promise<{ name: string; provider: BrowserProvider }>} Resolved name and provider.
 */
export async function resolveAndCreate(
  preferred?: string,
  browser?: string,
): Promise<{ name: string; provider: BrowserProvider }>;
export async function resolveAndCreate<O extends ProviderOperation>(
  preferred: string | undefined,
  browser: string | undefined,
  operation: O,
): Promise<{ name: string; provider: ProviderWith<O> }>;
export async function resolveAndCreate(
  preferred?: string,
  browser?: string,
  operation?: ProviderOperation,
): Promise<{ name: string; provider: BrowserProvider }> {
  try {
    return operation
      ? await createProvider(preferred, browser, operation)
      : await createProvider(preferred, browser);
  } catch (error) {
    consola.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Resolve a provider with `capability`, or terminate with a readable error.
 *
 * @param {string | undefined} preferred Preferred provider name.
 * @param {string | undefined} browser Optional Cloudflare browser engine.
 * @param {ProviderCapability} capability Flag the provider has to set in `capabilities()`.
 * @returns {Promise<{ name: string; provider: BrowserProvider }>} Resolved name and provider.
 */
export async function resolveCapableProvider(
  preferred: string | undefined,
  browser: string | undefined,
  capability: ProviderCapability,
): Promise<{ name: string; provider: BrowserProvider }> {
  try {
    return await createCapableProvider(preferred, browser, capability);
  } catch (error) {
    consola.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Resolve the screenshot provider, or terminate with a readable error.
 *
 * @param {string} [preferred] Preferred provider name.
 * @param {string} [browser] Optional Cloudflare browser engine.
 * @param {string} [selector] Element the screenshot is limited to.
 * @returns {Promise<{ name: string; provider: BrowserProvider }>} Resolved name and provider.
 */
export async function resolveScreenshotProvider(
  preferred?: string,
  browser?: string,
  selector?: string,
): Promise<{ name: string; provider: BrowserProvider }> {
  try {
    return await createScreenshotProvider(preferred, browser, selector);
  } catch (error) {
    consola.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
