import { consola } from 'consola'
import { providers as listProviders } from './registry'

export function resolveProvider(preferred?: string): string {
  const available = listProviders()
  if (preferred) {
    if (!available.includes(preferred)) {
      consola.error(`Unknown provider: ${preferred}. Available: ${available.join(', ')}`)
      process.exit(1)
    }
    if (!process.env[`${preferred.toUpperCase()}_API_KEY`]) {
      consola.error(`Missing API key for ${preferred}. Set ${preferred.toUpperCase()}_API_KEY`)
      process.exit(1)
    }
    return preferred
  }
  for (const name of available) {
    if (process.env[`${name.toUpperCase()}_API_KEY`]) return name
  }
  consola.error('No provider configured. Set one of: ' + available.map(n => `${n.toUpperCase()}_API_KEY`).join(', '))
  process.exit(1)
}
