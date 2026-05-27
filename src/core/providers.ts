export const builtinProviders = [
  'steel',
  'browserbase',
  'kernel',
  'browserless',
  'hyperbrowser',
  'anchor',
  'cloudflare',
] as const

export type BrowserProviderName = typeof builtinProviders[number]
