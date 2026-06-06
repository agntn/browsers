export class BroboError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BroboError'
  }
}

export class HTTPError extends BroboError {
  readonly statusCode: number
  readonly url: string
  readonly body: string

  constructor(statusCode: number, url: string, body: string) {
    super(`HTTP ${statusCode}: ${url}`)
    this.name = 'HTTPError'
    this.statusCode = statusCode
    this.url = url
    this.body = body
  }

  isNotFound(): boolean { return this.statusCode === 404 }
  isRateLimit(): boolean { return this.statusCode === 429 }
  isServerError(): boolean { return this.statusCode >= 500 }
}

export class AuthError extends BroboError {
  readonly provider: string
  constructor(message: string, provider: string) {
    super(message)
    this.name = 'AuthError'
    this.provider = provider
  }
}

export class RateLimitError extends BroboError {
  readonly retryAfter: number
  constructor(retryAfter: number) {
    super(`Rate limited. Retry after ${retryAfter}s`)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

export class UnknownProviderError extends BroboError {
  readonly provider: string
  constructor(provider: string) {
    super(`Unknown provider: ${provider}`)
    this.name = 'UnknownProviderError'
    this.provider = provider
  }
}

export class SessionError extends BroboError {
  readonly sessionId: string
  readonly provider: string
  constructor(message: string, sessionId: string, provider: string) {
    super(message)
    this.name = 'SessionError'
    this.sessionId = sessionId
    this.provider = provider
  }
}

export class SessionNotFoundError extends SessionError {
  constructor(sessionId: string, provider: string) {
    super(`Session not found: ${sessionId}`, sessionId, provider)
    this.name = 'SessionNotFoundError'
  }
}

export class SessionLimitError extends SessionError {
  constructor(provider: string) {
    super(`Session limit reached for provider: ${provider}`, '', provider)
    this.name = 'SessionLimitError'
  }
}

export class NoProviderConfiguredError extends BroboError {
  constructor() {
    super('No browser provider configured. Set an API key env var or register a provider.')
    this.name = 'NoProviderConfiguredError'
  }
}

export class NoProviderAvailableError extends BroboError {
  readonly providers: readonly string[]
  constructor(providers: readonly string[]) {
    const list = providers.length > 0 ? providers.join(', ') : 'unknown'
    super(`No configured browser provider is currently reachable: ${list}`)
    this.name = 'NoProviderAvailableError'
    this.providers = providers
  }
}

export class EmptyUrlError extends BroboError {
  constructor() {
    super('URL cannot be empty')
    this.name = 'EmptyUrlError'
  }
}

export class ScrapeNotSupportedError extends BroboError {
  readonly provider: string
  constructor(provider: string) {
    super(`Provider does not support stateless scrape: ${provider}`)
    this.name = 'ScrapeNotSupportedError'
    this.provider = provider
  }
}

export class InvalidInputError extends BroboError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidInputError'
  }
}

export class UnsupportedOperationError extends BroboError {
  readonly provider: string
  constructor(message: string, provider: string) {
    super(message)
    this.name = 'UnsupportedOperationError'
    this.provider = provider
  }
}

export class PaymentError extends BroboError {
  readonly statusCode: number
  readonly provider: string
  constructor(message: string, statusCode: number, provider: string) {
    super(message)
    this.name = 'PaymentError'
    this.statusCode = statusCode
    this.provider = provider
  }
}

export const DEFAULT_RETRY_AFTER = 60

export function parseRetryAfter(header: string | null | undefined): number {
  if (header == null) return DEFAULT_RETRY_AFTER
  const trimmed = header.trim()
  if (!/^\d+$/.test(trimmed)) return DEFAULT_RETRY_AFTER
  const parsed = Number.parseInt(trimmed, 10)
  return parsed > 0 && parsed < 3600 ? parsed : DEFAULT_RETRY_AFTER
}

export function normalizeError(error: unknown, provider?: string): BroboError {
  if (error instanceof HTTPError && error.statusCode === 401) {
    return new AuthError(
      `Authentication failed: ${error.body || 'Invalid or missing API key'}`,
      provider || 'unknown',
    )
  }
  if (error instanceof BroboError) return error
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    'message' in error
  ) {
    const fetchError = error as {
      status: number
      message: string
      response?: { headers?: { get: (key: string) => string | null } }
    }
    const status = fetchError.status
    const message = fetchError.message || `HTTP ${status}`
    switch (status) {
      case 401:
        return new AuthError(
          `Authentication failed: ${message}`,
          provider || 'unknown',
        )
      case 402:
      case 403:
        return new PaymentError(
          `Payment required: ${message}`,
          status,
          provider || 'unknown',
        )
      case 429: {
        const retryAfter = parseRetryAfter(
          fetchError.response?.headers?.get('Retry-After'),
        )
        return new RateLimitError(retryAfter)
      }
      default:
        if (status >= 500) return new HTTPError(status, '', message)
        return new BroboError(message)
    }
  }
  if (error instanceof Error) return new BroboError(error.message)
  return new BroboError(String(error))
}
