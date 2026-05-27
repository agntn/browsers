import type {
  BrowserProvider,
  BrowserSession,
  CreateSessionOptions,
  ScrapeResult,
  ScrapeOptions,
  ScreenshotResult,
  ScreenshotOptions,
  EvaluateResult,
  ProviderConfig,
  BrowserProviderFactory,
} from '../core/types'
import { defaultClient } from '../core/client'
import type { Client } from '../core/client'
import { AuthError, normalizeError } from '../core/errors'
import { register } from '../core/registry'

interface BrowserbaseSessionResponse {
  id: string
  connectUrl?: string
  status?: string
  createdAt?: string
  [key: string]: unknown
}

class BrowserbaseProvider implements BrowserProvider {
  private readonly client: Client
  private readonly baseURL: string
  private readonly apiKey: string

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new AuthError('Missing API key for Browserbase. Set BROWSERBASE_API_KEY', 'browserbase')
    }
    this.client = defaultClient()
    this.baseURL = (config.baseURL ?? 'https://api.browserbase.com').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  name(): string { return 'browserbase' }

  private headers(): Record<string, string> {
    return {
      'X-BB-API-Key': this.apiKey,
      'Content-Type': 'application/json',
    }
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const body: Record<string, unknown> = {}
      if (options?.region) body.region = options.region
      if (options?.proxy) body.proxy = options.proxy
      if (options?.stealth) body.stealth = options.stealth
      if (options?.extra) Object.assign(body, options.extra)

      const res = await this.client.postJSON<BrowserbaseSessionResponse>(
        `${this.baseURL}/v1/sessions`,
        body,
        this.headers(),
      )

      return {
        id: res.id,
        cdpUrl: res.connectUrl,
        provider: 'browserbase',
        createdAt: Date.now(),
        metadata: { status: res.status },
      }
    }
    catch (error) { throw normalizeError(error, 'browserbase') }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    try {
      const res = await this.client.getJSON<BrowserbaseSessionResponse>(
        `${this.baseURL}/v1/sessions/${sessionId}`,
        this.headers(),
      )
      return {
        id: res.id,
        cdpUrl: res.connectUrl,
        provider: 'browserbase',
        createdAt: res.createdAt ? new Date(res.createdAt).getTime() : Date.now(),
        metadata: { status: res.status },
      }
    }
    catch (error: unknown) {
      if (error instanceof Error && 'statusCode' in error && (error as { statusCode: number }).statusCode === 404) return null
      throw normalizeError(error, 'browserbase')
    }
  }

  async listSessions(): Promise<BrowserSession[]> {
    const res = await this.client.getJSON<BrowserbaseSessionResponse[]>(
      `${this.baseURL}/v1/sessions`,
      this.headers(),
    )
    return res.map(s => ({
      id: s.id,
      cdpUrl: s.connectUrl,
      provider: 'browserbase',
      createdAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
      metadata: { status: s.status },
    }))
  }

  async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.client.deleteJSON(
        `${this.baseURL}/v1/sessions/${sessionId}`,
        this.headers(),
      )
    }
    catch (error) { throw normalizeError(error, 'browserbase') }
  }

  async scrape(url: string, options?: ScrapeOptions, _session?: BrowserSession): Promise<ScrapeResult> {
    try {
      const body: Record<string, unknown> = { url }
      if (options?.waitFor) body.waitFor = options.waitFor
      if (options?.headers) body.headers = options.headers

      const res = await this.client.postJSON<Record<string, unknown>>(
        `${this.baseURL}/v1/scrape`,
        body,
        this.headers(),
      )

      return {
        url,
        title: res.title as string | undefined,
        html: res.html as string | undefined,
        markdown: res.markdown as string | undefined,
        text: res.text as string | undefined,
        statusCode: res.statusCode as number | undefined,
      }
    }
    catch (error) { throw normalizeError(error, 'browserbase') }
  }

  async screenshot(options: ScreenshotOptions, session?: BrowserSession): Promise<ScreenshotResult> {
    try {
      if (!session?.id) throw new Error('Browserbase screenshot requires a session.')
      const body: Record<string, unknown> = {
        sessionId: session.id,
        fullPage: options.fullPage ?? true,
        format: options.format ?? 'png',
      }
      if (options.selector) body.selector = options.selector

      const res = await this.client.postJSON<{ data?: string; screenshot?: string }>(
        `${this.baseURL}/v1/screenshot`,
        body,
        this.headers(),
      )

      return {
        data: res.data ?? res.screenshot ?? '',
        mimeType: `image/${options.format ?? 'png'}`,
      }
    }
    catch (error) { throw normalizeError(error, 'browserbase') }
  }

  async navigate(_url: string, _session: BrowserSession): Promise<void> {
    throw new Error('Browserbase does not support navigate via REST. Connect via CDP for full automation.')
  }

  async evaluate(_script: string, _session: BrowserSession): Promise<EvaluateResult> {
    throw new Error('Browserbase does not support evaluate via REST. Connect via CDP (Puppeteer/Playwright) for script execution.')
  }

  getCdpUrl(session: BrowserSession): string {
    if (session.cdpUrl) return session.cdpUrl
    return `wss://connect.browserbase.com?sessionId=${session.id}`
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.getJSON<Record<string, unknown>>(
        `${this.baseURL}/v1/sessions`,
        this.headers(),
      )
      return true
    }
    catch { return false }
  }
}

const factory: BrowserProviderFactory = (config) => new BrowserbaseProvider(config)
register('browserbase', 'https://api.browserbase.com', factory)
