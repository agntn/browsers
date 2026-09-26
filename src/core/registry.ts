import type { BrowserProvider, ProviderConfig, BrowserProviderFactory } from "./types.ts";
import { UnknownProviderError } from "./errors.ts";
import { builtins } from "../providers/index.ts";

/** One provider the registry knows: static metadata plus a loader for its factory. */
export interface ProviderEntry {
  /** Registry key, also the prefix of the `*_API_KEY` variable. */
  readonly key: string;
  /** Endpoint used when `create()` gets no `baseURL`. */
  readonly defaultURL: string;
  /** Resolves the factory; for a built-in that is a literal `import()` of its module. */
  readonly load: () => Promise<BrowserProviderFactory>;
}

let entries: Map<string, ProviderEntry> | undefined;

/**
 * The registry table, seeded from the built-in manifest on first use.
 *
 * Seeding on first use rather than at module scope keeps this module free of calls a
 * bundler would have to keep, so a consumer that never resolves a provider drops the table too.
 *
 * @returns {Map<string, ProviderEntry>} The seeded table.
 */
function table(): Map<string, ProviderEntry> {
  entries ??= new Map(builtins.map((entry): [string, ProviderEntry] => [entry.key, entry]));
  return entries;
}

/**
 * Register a provider factory.
 *
 * Built-in providers are already listed; this is the entry point for providers living outside
 * the package. Registering a name again replaces the previous factory.
 *
 * @param name - Provider name.
 * @param defaultURL - Endpoint used when `create()` gets no `baseURL`.
 * @param factory - Builds a provider from its resolved configuration.
 */
export function register(name: string, defaultURL: string, factory: BrowserProviderFactory): void {
  table().set(name, { key: name, defaultURL, load: () => Promise.resolve(factory) });
}

/**
 * Create a provider by name.
 *
 * A built-in provider's module is imported here, on the first call for its name; the module
 * map shares one import between parallel callers and answers later calls from cache.
 *
 * @param name - Provider name.
 * @param config - Optional configuration; the API key falls back to `<NAME>_API_KEY`.
 * @returns {Promise<BrowserProvider>} The provider instance.
 * @throws {UnknownProviderError} When nothing is registered under `name`.
 */
export async function create(name: string, config?: ProviderConfig): Promise<BrowserProvider> {
  const entry = table().get(name);
  if (!entry) throw new UnknownProviderError(name);
  const factory = await entry.load();
  const apiKey = config?.apiKey || process.env[`${name.toUpperCase()}_API_KEY`];
  return factory({ ...config, apiKey, baseURL: config?.baseURL || entry.defaultURL });
}

/**
 * List registered providers.
 *
 * @returns {string[]} Provider names, built-ins first in manifest order.
 */
export function providers(): string[] {
  return [...table().keys()];
}

/**
 * Check whether a provider is registered.
 *
 * @param name - Provider name.
 * @returns {boolean} Whether a factory is registered, configured or not.
 */
export function has(name: string): boolean {
  return table().has(name);
}
