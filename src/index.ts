export { version } from "./version.ts";

export { builtinProviders, type BrowserProviderName } from "./core/providers.ts";

export type {
  BrowserSession,
  CloudflareBrowser,
  CreateSessionOptions,
  ScrapeResult,
  ScrapeOptions,
  ScreenshotResult,
  ScreenshotOptions,
  EvaluateResult,
  CrawlResult,
  CrawlPage,
  CrawlOptions,
  PdfResult,
  PdfOptions,
  WebSearchResult,
  WebSearchOptions,
  ExtractResult,
  ExtractOptions,
  LinksResult,
  LinkItem,
  BrowserProvider,
  ProviderCapabilities,
  ProviderConfig,
  BrowserProviderFactory,
  ClientOptions,
} from "./core/types.ts";

export {
  BrowserError,
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
  InvalidInputError,
  UnsupportedOperationError,
  PaymentError,
  normalizeError,
} from "./core/errors.ts";

export { Client, defaultClient } from "./core/client.ts";
export { register, create, providers, has, type ProviderEntry } from "./core/registry.ts";
export { resolveProvider, providerEnvKey } from "./core/resolve.ts";
export {
  isNotFoundError,
  assertSessionId,
  assertUrlOrSession,
  notSupportedViaRest,
} from "./core/utils.ts";
