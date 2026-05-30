import { providers as listProviders } from './registry'
import { UnknownProviderError, NoProviderConfiguredError, AuthError } from './errors'

const specialEnvKeys: Record<string, string[]> = {
  cloudflare: ['CF_API_TOKEN', 'CLOUDFLARE_API_TOKEN'],
}

/** @internal */
export function _hasKey(provider: string): boolean {
  if (provider === 'playwright') return true
  const specials = specialEnvKeys[provider]
  if (specials) return specials.some(k => !!process.env[k])
  return !!process.env[`${provider.toUpperCase()}_API_KEY`]
}

/**
 * Resolve a browser provider name. Throws on missing/unknown provider
 * instead of calling process.exit — callers decide how to handle.
 */
export function resolveProvider(preferred?: string): string {
  const available = listProviders()
  if (preferred) {
    if (!available.includes(preferred)) {
      throw new UnknownProviderError(preferred)
    }
    if (!_hasKey(preferred)) {
      const envHint = specialEnvKeys[preferred]?.[0] ?? `${preferred.toUpperCase()}_API_KEY`
      throw new AuthError(`Missing API key for ${preferred}. Set ${envHint}`, preferred)
    }
    return preferred
  }
  for (const name of available) {
    if (_hasKey(name)) return name
  }
  const allKeys = available.map(n => specialEnvKeys[n]?.[0] ?? `${n.toUpperCase()}_API_KEY`)
  throw new NoProviderConfiguredError()
}

/**
 * Get the env key hint for a provider (for error messages).
 */
export function providerEnvKey(provider: string): string {
  return specialEnvKeys[provider]?.[0] ?? `${provider.toUpperCase()}_API_KEY`
}
