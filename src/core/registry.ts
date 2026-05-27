import type { BrowserProvider, ProviderConfig, BrowserProviderFactory } from './types'
import { UnknownProviderError } from './errors'

const factories = new Map<string, BrowserProviderFactory>()
const defaultURLs = new Map<string, string>()

export function register(name: string, defaultURL: string, factory: BrowserProviderFactory): void {
  factories.set(name, factory)
  defaultURLs.set(name, defaultURL)
}

export function create(name: string, config?: ProviderConfig): BrowserProvider {
  const factory = factories.get(name)
  if (!factory) throw new UnknownProviderError(name)
  const apiKey = config?.apiKey || process.env[`${name.toUpperCase()}_API_KEY`]
  const resolvedConfig: ProviderConfig = {
    ...config,
    apiKey,
    baseURL: config?.baseURL || defaultURLs.get(name),
  }
  return factory(resolvedConfig)
}

export function providers(): string[] {
  return Array.from(factories.keys())
}

export function has(name: string): boolean {
  return factories.has(name)
}
