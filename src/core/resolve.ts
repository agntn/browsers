import { create, providers as listProviders } from "./registry.ts";
import { UnknownProviderError, NoProviderConfiguredError, AuthError } from "./errors.ts";
import type { BrowserProvider } from "./types.ts";
import { resolveCloudflareBrowser } from "./utils.ts";

type ProviderEnvRequirements = readonly (readonly [string, ...string[]])[];

const specialEnvRequirements: Readonly<Record<string, ProviderEnvRequirements>> = {
  cloudflare: [
    ["CF_API_TOKEN", "CLOUDFLARE_API_TOKEN"],
    ["CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"],
  ],
};

/**
 * Check whether a provider can run with the current environment.
 *
 * @param {string} provider Provider name.
 * @returns {boolean} Whether credentials are available or unnecessary.
 * @internal
 */
export function _hasKey(provider: string): boolean {
  if (provider === "playwright") return true;
  const requirements = specialEnvRequirements[provider];
  if (requirements) {
    return requirements.every((group) => group.some((key) => Boolean(process.env[key])));
  }
  return Boolean(process.env[`${provider.toUpperCase()}_API_KEY`]);
}

/**
 * Resolve a provider or reject a missing explicit choice.
 *
 * @param {string} [preferred] Preferred provider name.
 * @returns {string} Resolved provider name.
 */
export function resolveProvider(preferred?: string): string {
  const available = listProviders();
  if (preferred) {
    if (!available.includes(preferred)) {
      throw new UnknownProviderError(preferred);
    }
    if (!_hasKey(preferred)) {
      const requirements = specialEnvRequirements[preferred];
      const message = requirements
        ? `Missing configuration for ${preferred}. Set ${providerEnvHint(preferred)}`
        : `Missing API key for ${preferred}. Set ${providerEnvKey(preferred)}`;
      throw new AuthError(message, preferred);
    }
    return preferred;
  }
  for (const name of available) {
    if (_hasKey(name)) return name;
  }
  throw new NoProviderConfiguredError();
}

/** Optional operations a provider may leave unimplemented. */
export type ProviderOperation = "crawl" | "pdf" | "search" | "extract" | "links";

/** A provider known to implement `O`. */
export type ProviderWith<O extends ProviderOperation> = BrowserProvider &
  Required<Pick<BrowserProvider, O>>;

const operationLabels: Readonly<Record<ProviderOperation, string>> = {
  crawl: "crawl",
  pdf: "PDF generation",
  search: "web search",
  extract: "structured extraction",
  links: "link extraction",
};

function supports<O extends ProviderOperation>(
  provider: Readonly<BrowserProvider>,
  operation: O,
): provider is ProviderWith<O> {
  return typeof provider[operation] === "function";
}

/**
 * Build the first configured provider, in registry order, that `accepts`.
 *
 * @param {(provider: BrowserProvider) => provider is P} accepts Test the provider has to pass.
 * @param {string} label What the provider has to support, for the error.
 * @returns {Promise<{ name: string; provider: P }>} Resolved name and provider.
 */
async function firstProvider<P extends BrowserProvider>(
  accepts: (provider: Readonly<BrowserProvider>) => provider is P,
  label: string,
): Promise<{ name: string; provider: P }> {
  const checked: string[] = [];
  for (const name of listProviders()) {
    if (!_hasKey(name)) continue;
    const provider = await create(name);
    if (accepts(provider)) return { name, provider };
    checked.push(name);
  }
  if (checked.length === 0) throw new NoProviderConfiguredError();
  throw new Error(`No configured provider supports ${label} (checked: ${checked.join(", ")}).`);
}

/**
 * Resolve and build the provider for one call.
 *
 * A Cloudflare `browser` without a provider selects Cloudflare. With an `operation` and no
 * provider, the first configured provider that implements it wins; a named provider that lacks
 * it is rejected rather than replaced.
 *
 * @param {string} [preferred] Preferred provider name.
 * @param {string} [browser] Optional Cloudflare browser engine.
 * @returns {Promise<{ name: string; provider: BrowserProvider }>} Resolved name and provider.
 */
export async function createProvider(
  preferred?: string,
  browser?: string,
): Promise<{ name: string; provider: BrowserProvider }>;
export async function createProvider<O extends ProviderOperation>(
  preferred: string | undefined,
  browser: string | undefined,
  operation: O,
): Promise<{ name: string; provider: ProviderWith<O> }>;
export async function createProvider(
  preferred?: string,
  browser?: string,
  operation?: ProviderOperation,
): Promise<{ name: string; provider: BrowserProvider }> {
  if (operation && !preferred && !browser) {
    return firstProvider(
      (provider): provider is ProviderWith<typeof operation> => supports(provider, operation),
      operationLabels[operation],
    );
  }
  const name = resolveProvider(browser && !preferred ? "cloudflare" : preferred);
  const provider = await create(name, { browser: resolveCloudflareBrowser(name, browser) });
  if (operation && !supports(provider, operation)) {
    throw new Error(`Provider ${name} does not support ${operationLabels[operation]}.`);
  }
  return { name, provider };
}

/**
 * Resolve and build the provider for one screenshot.
 *
 * A `selector` without a provider or browser picks the first configured provider that can
 * capture one element, instead of one that would refuse it.
 *
 * @param {string} [preferred] Preferred provider name.
 * @param {string} [browser] Optional Cloudflare browser engine.
 * @param {string} [selector] Element the screenshot is limited to.
 * @returns {Promise<{ name: string; provider: BrowserProvider }>} Resolved name and provider.
 */
export async function createScreenshotProvider(
  preferred?: string,
  browser?: string,
  selector?: string,
): Promise<{ name: string; provider: BrowserProvider }> {
  if (selector === undefined || preferred || browser) return createProvider(preferred, browser);
  return firstProvider(
    (provider): provider is BrowserProvider => provider.capabilities().elementScreenshot === true,
    "element screenshots",
  );
}

/**
 * Get the environment key hint for a provider.
 *
 * @param {string} provider Provider name.
 * @returns {string} Primary environment key.
 */
export function providerEnvKey(provider: string): string {
  return specialEnvRequirements[provider]?.[0]?.[0] ?? `${provider.toUpperCase()}_API_KEY`;
}

/**
 * Describe the environment values required by a provider.
 *
 * @param {string} provider Provider name.
 * @returns {string} Readable environment requirement.
 */
export function providerEnvHint(provider: string): string {
  const requirements = specialEnvRequirements[provider];
  return requirements
    ? requirements.map(([primary]) => primary).join(" and ")
    : providerEnvKey(provider);
}
