import { ofetch, FetchError } from 'ofetch'
import type { $Fetch } from 'ofetch'
import type { ClientOptions } from './types'
import { HTTPError, RateLimitError, parseRetryAfter } from './errors'
import { version } from '../version'

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BASE_DELAY = 100
const DEFAULT_TIMEOUT = 30_000
const DEFAULT_USER_AGENT = `brobo/${version}`

export class Client {
  readonly maxRetries: number
  readonly baseDelay: number
  readonly timeout: number
  readonly userAgent: string
  private readonly fetch: $Fetch

  constructor(options: ClientOptions = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.baseDelay = options.baseDelay ?? DEFAULT_BASE_DELAY
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT
    this.fetch = ofetch.create({
      timeout: this.timeout,
      retry: this.maxRetries,
      retryDelay: this.baseDelay,
      retryStatusCodes: [408, 429, 500, 502, 503, 504],
      headers: { 'User-Agent': this.userAgent },
    })
  }

  async getJSON<T>(url: string, headers?: Record<string, string>, signal?: AbortSignal): Promise<T> {
    try {
      return await this.fetch<T>(url, { headers, signal })
    }
    catch (error) {
      throw this.mapError(error, url)
    }
  }

  async postJSON<T>(
    url: string,
    body: Record<string, unknown>,
    headers?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return await this.fetch<T>(url, { method: 'POST', body, headers, signal })
    }
    catch (error) {
      throw this.mapError(error, url)
    }
  }

  async deleteJSON<T>(
    url: string,
    headers?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return await this.fetch<T>(url, { method: 'DELETE', headers, signal })
    }
    catch (error) {
      throw this.mapError(error, url)
    }
  }

  private mapError(error: unknown, url: string): Error {
    if (error instanceof FetchError) {
      if (error.statusCode === 429) {
        const retryAfter = parseRetryAfter(error.response?.headers.get('Retry-After'))
        return new RateLimitError(retryAfter)
      }
      const body = typeof error.data === 'string'
        ? error.data
        : JSON.stringify(error.data ?? '')
      return new HTTPError(error.statusCode ?? 0, sanitizeUrl(url), body)
    }
    return error instanceof Error ? error : new Error(String(error))
  }
}

const SENSITIVE_PARAMS = ['api_key', 'key', 'token', 'secret', 'password', 'apikey']
const SENSITIVE_PARAM_SET = new Set(SENSITIVE_PARAMS.map(p => p.toLowerCase()))

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    for (const param of SENSITIVE_PARAMS) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[REDACTED]')
      }
    }
    return parsed.toString()
  }
  catch {
    return url
  }
}

let _defaultClient: Client | undefined

export function defaultClient(): Client {
  if (!_defaultClient) _defaultClient = new Client()
  return _defaultClient
}

export function resetDefaultClientForTests(): void {
  _defaultClient = undefined
}
