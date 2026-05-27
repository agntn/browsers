import './providers/index'

export { version } from './version'

export { builtinProviders, type BrowserProviderName } from './core/providers'

export type {
  BrowserSession,
  CreateSessionOptions,
  ScrapeResult,
  ScrapeOptions,
  ScreenshotResult,
  ScreenshotOptions,
  EvaluateResult,
  BrowserProvider,
  ProviderConfig,
  BrowserProviderFactory,
  ClientOptions,
} from './core/types'

export {
  BroboError,
  HTTPError,
  AuthError,
  RateLimitError,
  UnknownProviderError,
  SessionError,
  SessionNotFoundError,
  SessionLimitError,
  NoProviderConfiguredError,
  NoProviderAvailableError,
  EmptyUrlError,
  ScrapeNotSupportedError,
  normalizeError,
} from './core/errors'

export { Client, defaultClient } from './core/client'
export { register, create, providers, has } from './core/registry'
export { resolveProvider } from './core/resolve'
