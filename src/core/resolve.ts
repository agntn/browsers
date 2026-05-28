import { consola } from 'consola'
import { providers as listProviders } from './registry'

const specialEnvKeys: Record<string, string[]> = {
  cloudflare: ['CF_API_TOKEN', 'CLOUDFLARE_API_TOKEN'],
}

function hasKey(provider: string): boolean {
  if (provider === 'playwright') return true
  const specials = specialEnvKeys[provider]
  if (specials) {
    for (const key of specials) {
      if (process.env[key]) return true
    }
    return false
  }
  return !!process.env[`${provider.toUpperCase()}_API_KEY`]
}

export function resolveProvider(preferred?: string): string {
  const available = listProviders()
  if (preferred) {
    if (!available.includes(preferred)) {
      consola.error(`Unknown provider: ${preferred}. Available: ${available.join(', ')}`)
      process.exit(1)
    }
    if (!hasKey(preferred)) {
      const envHint = specialEnvKeys[preferred]?.[0] ?? `${preferred.toUpperCase()}_API_KEY`
      consola.error(`Missing API key for ${preferred}. Set ${envHint}`)
      process.exit(1)
    }
    return preferred
  }
  for (const name of available) {
    if (hasKey(name)) return name
  }
  const allKeys = available.map(n => specialEnvKeys[n]?.[0] ?? `${n.toUpperCase()}_API_KEY`)
  consola.error('No provider configured. Set one of: ' + allKeys.join(', '))
  process.exit(1)
}
