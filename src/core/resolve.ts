import { providers as listProviders } from "./registry";
import { UnknownProviderError, NoProviderConfiguredError, AuthError } from "./errors";

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
