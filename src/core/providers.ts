export const builtinProviders = [
  'steel',
  'browserbase',
  'kernel',
  'browserless',
  'hyperbrowser',
  'anchor',
] as const

export type BrowserProviderName = typeof builtinProviders[number]
