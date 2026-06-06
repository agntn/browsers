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
  ProviderCapabilities,
} from '../core/types'
import { defaultClient } from '../core/client'
import type { Client } from '../core/client'
import { AuthError, normalizeError } from '../core/errors'
import { register } from '../core/registry'
import { isNotFoundError, assertSessionId, notSupportedViaRest } from '../core/utils'

interface SteelSessionResponse {
  id: string
  websocketUrl?: string
  status?: string
  createdAt?: string
  [key: string]: unknown
}

interface SteelScrapeResponse {
  content?: {
    html?: string
    markdown?: string
    cleaned_html?: string
    readability?: string
  }
  metadata?: {
    status_code?: number
    title?: string
  }
  links?: string[]
  [key: string]: unknown
}

class SteelProvider implements BrowserProvider {
  private readonly client: Client
  private readonly baseURL: string
  private readonly apiKey: string

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new AuthError('Missing API key for Steel. Set STEEL_API_KEY', 'steel')
    }
    this.client = defaultClient()
    this.baseURL = (config.baseURL ?? 'https://api.steel.dev').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  name(): string { return 'steel' }

  capabilities(): ProviderCapabilities {
    return {
      scrape: true, screenshot: true, navigate: false, evaluate: false,
      sessions: true, cdp: true, statelessScrape: true, statelessScreenshot: false,
      crawl: false, pdf: false, links: false, search: false, extract: false,
    }
  }

  private headers(): Record<string, string> {
    return {
      'steel-api-key': this.apiKey,
      'Content-Type': 'application/json',
    }
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const body: Record<string, unknown> = {}
      if (options?.region) body.proxy_region = options.region
      if (options?.stealth) body.stealth = true
      if (options?.timeout) body.timeout = options.timeout
      if (options?.proxy) body.proxy = options.proxy
      if (options?.profileId) body.profiles = [options.profileId]
      if (options?.captchaSolving) body.solve_captchas = true
      if (options?.extra) Object.assign(body, options.extra)

      const res = await this.client.postJSON<SteelSessionResponse>(
        `${this.baseURL}/v1/sessions`,
        body,
        this.headers(),
      )

      return {
        id: res.id,
        cdpUrl: res.websocketUrl,
        provider: 'steel',
        createdAt: Date.now(),
        metadata: { status: res.status },
      }
    }
    catch (error) { throw normalizeError(error, 'steel') }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    try {
      const res = await this.client.getJSON<SteelSessionResponse>(
        `${this.baseURL}/v1/sessions/${sessionId}`,
        this.headers(),
      )
      return {
        id: res.id,
        cdpUrl: res.websocketUrl,
        provider: 'steel',
        createdAt: res.createdAt ? new Date(res.createdAt).getTime() : Date.now(),
        metadata: { status: res.status },
      }
    }
    catch (error: unknown) {
      if (isNotFoundError(error)) return null
      throw normalizeError(error, 'steel')
    }
  }

  async listSessions(): Promise<BrowserSession[]> {
    const res = await this.client.getJSON<SteelSessionResponse[]>(
      `${this.baseURL}/v1/sessions`,
      this.headers(),
    )
    return res.map(s => ({
      id: s.id,
      cdpUrl: s.websocketUrl,
      provider: 'steel',
      createdAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
      metadata: { status: s.status },
    }))
  }

  async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.client.postJSON(
        `${this.baseURL}/v1/sessions/${sessionId}/release`,
        {},
        this.headers(),
      )
    }
    catch (error) { throw normalizeError(error, 'steel') }
  }

  async scrape(url: string, options?: ScrapeOptions, _session?: BrowserSession): Promise<ScrapeResult> {
    try {
      const body: Record<string, unknown> = { url }
      if (options?.waitFor) body.waitFor = options.waitFor
      if (options?.headers) body.headers = options.headers

      const res = await this.client.postJSON<SteelScrapeResponse>(
        `${this.baseURL}/v1/scrape`,
        body,
        this.headers(),
      )

      return {
        url,
        title: res.metadata?.title,
        html: res.content?.html,
        cleanedHtml: res.content?.cleaned_html,
        markdown: res.content?.markdown,
        text: res.content?.readability,
        statusCode: res.metadata?.status_code,
        links: res.links,
      }
    }
    catch (error) { throw normalizeError(error, 'steel') }
  }

  async screenshot(options: ScreenshotOptions, session?: BrowserSession): Promise<ScreenshotResult> {
    try {
      assertSessionId(session?.id, 'steel', 'screenshot')

      const body: Record<string, unknown> = {
        sessionId: session.id,
        fullPage: options.fullPage ?? true,
      }
      if (options.url) body.url = options.url
      if (options.selector) body.selector = options.selector

      const res = await this.client.postJSON<Record<string, unknown>>(
        `${this.baseURL}/v1/screenshot`,
        body,
        this.headers(),
      )

      const data = (res.url ?? res.screenshot ?? res.data ?? '') as string
      return {
        data,
        mimeType: `image/${options.format ?? 'png'}`,
      }
    }
    catch (error) { throw normalizeError(error, 'steel') }
  }

  async navigate(_url: string, _session: BrowserSession): Promise<void> {
    notSupportedViaRest('steel', 'navigate')
  }

  async evaluate(_script: string, _session: BrowserSession): Promise<EvaluateResult> {
    notSupportedViaRest('steel', 'evaluate')
  }

  getCdpUrl(session: BrowserSession): string {
    if (session.cdpUrl) return session.cdpUrl
    return `wss://connect.steel.dev?apiKey=${this.apiKey}&sessionId=${session.id}`
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.getJSON<{ status?: string }>(
        `${this.baseURL}/v1/health`,
        this.headers(),
      )
      return true
    }
    catch { return false }
  }
}

const factory: BrowserProviderFactory = (config) => new SteelProvider(config)
register('steel', 'https://api.steel.dev', factory)
