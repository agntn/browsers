export { version } from "./version";

export { builtinProviders, type BrowserProviderName } from "./core/providers";

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
} from "./core/types";

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
} from "./core/errors";

export { Client, defaultClient } from "./core/client";
export { register, create, providers, has, type ProviderEntry } from "./core/registry";
export { resolveProvider, providerEnvKey } from "./core/resolve";
export {
  isNotFoundError,
  assertSessionId,
  assertUrlOrSession,
  notSupportedViaRest,
} from "./core/utils";
