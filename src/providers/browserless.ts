import type {
  BrowserProvider,
  BrowserSession,
  CreateSessionOptions,
  ScrapeResult,
  ScrapeOptions,
  ScreenshotResult,
  ScreenshotOptions,
  EvaluateResult,
  PdfResult,
  PdfOptions,
  ProviderConfig,
  BrowserProviderFactory,
} from '../core/types'
import { defaultClient } from '../core/client'
import type { Client } from '../core/client'
import { AuthError, normalizeError } from '../core/errors'
import { register } from '../core/registry'

class BrowserlessProvider implements BrowserProvider {
  private readonly client: Client
  private readonly baseURL: string
  private readonly apiKey: string

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new AuthError('Missing API key for Browserless. Set BROWSERLESS_API_KEY', 'browserless')
    }
    this.client = defaultClient()
    this.baseURL = (config.baseURL ?? 'https://chrome.browserless.io').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  name(): string { return 'browserless' }

  private tokenParam(): string {
    return `token=${this.apiKey}`
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const body: Record<string, unknown> = { timeout: options?.timeout ?? 300_000 }
      if (options?.proxy) body.proxy = options.proxy.server
      if (options?.stealth) body.stealth = true
      if (options?.extra) Object.assign(body, options.extra)

      const res = await this.client.postJSON<{ id?: string; browserWSEndpoint?: string }>(
        `${this.baseURL}/sessions?${this.tokenParam()}`,
        body,
        { 'Content-Type': 'application/json' },
      )

      return {
        id: res.id ?? '',
        cdpUrl: res.browserWSEndpoint,
        provider: 'browserless',
        createdAt: Date.now(),
      }
    }
    catch (error) { throw normalizeError(error, 'browserless') }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    try {
      const res = await this.client.getJSON<{ id?: string; browserWSEndpoint?: string }>(
        `${this.baseURL}/sessions/${sessionId}?${this.tokenParam()}`,
      )
      if (!res.id) return null
      return {
        id: res.id,
        cdpUrl: res.browserWSEndpoint,
        provider: 'browserless',
        createdAt: Date.now(),
      }
    }
    catch { return null }
  }

  async listSessions(): Promise<BrowserSession[]> {
    try {
      const res = await this.client.getJSON<Array<{ id?: string; browserWSEndpoint?: string }>>(
        `${this.baseURL}/sessions?${this.tokenParam()}`,
      )
      return res.map(s => ({
        id: s.id ?? '',
        cdpUrl: s.browserWSEndpoint,
        provider: 'browserless',
        createdAt: Date.now(),
      }))
    }
    catch { return [] }
  }

  async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.client.deleteJSON(
        `${this.baseURL}/sessions/${sessionId}?${this.tokenParam()}`,
      )
    }
    catch (error) { throw normalizeError(error, 'browserless') }
  }

  async scrape(url: string, options?: ScrapeOptions, _session?: BrowserSession): Promise<ScrapeResult> {
    try {
      const res = await fetch(
        `${this.baseURL}/content?${this.tokenParam()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const html = await res.text()
      return { url, html }
    }
    catch (error) { throw normalizeError(error, 'browserless') }
  }

  async screenshot(options: ScreenshotOptions, session?: BrowserSession): Promise<ScreenshotResult> {
    try {
      if (!options.url && !session?.id) {
        throw new Error('Browserless screenshot requires either options.url or a session')
      }

      const body: Record<string, unknown> = {}
      if (options.url) body.url = options.url

      const res = await fetch(
        `${this.baseURL}/screenshot?${this.tokenParam()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const png = await res.arrayBuffer()

      return {
        data: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
        mimeType: 'image/png',
      }
    }
    catch (error) { throw normalizeError(error, 'browserless') }
  }

  async navigate(url: string, session: BrowserSession): Promise<void> {
    await this.evaluate(`await page.goto(${JSON.stringify(url)})`, session)
  }

  async evaluate(script: string, session: BrowserSession): Promise<EvaluateResult> {
    try {
      const res = await this.client.postJSON<{ data?: unknown }>(
        `${this.baseURL}/function?${this.tokenParam()}`,
        { code: script },
        { 'Content-Type': 'application/json' },
      )
      return { value: res.data }
    }
    catch (error) { throw normalizeError(error, 'browserless') }
  }

  getCdpUrl(session: BrowserSession): string {
    if (session.cdpUrl) return session.cdpUrl
    return `wss://chrome.browserless.io?token=${this.apiKey}`
  }

  async pdf(url: string, options?: PdfOptions, _session?: BrowserSession): Promise<PdfResult> {
    try {
      const body: Record<string, unknown> = { url }
      if (options?.landscape !== undefined) body.landscape = options.landscape
      if (options?.printBackground !== undefined) body.printBackground = options.printBackground

      const res = await fetch(
        `${this.baseURL}/pdf?${this.tokenParam()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) throw new Error(`Browserless PDF HTTP ${res.status}`)
      const pdf = await res.arrayBuffer()
      return {
        data: `data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}`,
        mimeType: 'application/pdf',
      }
    }
    catch (error) { throw normalizeError(error, 'browserless') }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.getJSON<{ status?: string }>(
        `${this.baseURL}/stats?${this.tokenParam()}`,
      )
      return true
    }
    catch { return false }
  }
}

const factory: BrowserProviderFactory = (config) => new BrowserlessProvider(config)
register('browserless', 'https://chrome.browserless.io', factory)
