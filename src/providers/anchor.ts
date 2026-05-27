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

interface AnchorSessionResponse {
  id: string
  cdpUrl?: string
  wsEndpoint?: string
  status?: string
  createdAt?: string
  [key: string]: unknown
}

class AnchorProvider implements BrowserProvider {
  private readonly client: Client
  private readonly baseURL: string
  private readonly apiKey: string

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new AuthError('Missing API key for Anchor Browser. Set ANCHOR_API_KEY', 'anchor')
    }
    this.client = defaultClient()
    this.baseURL = (config.baseURL ?? 'https://api.anchorbrowser.io').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  name(): string { return 'anchor' }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const body: Record<string, unknown> = {}
      if (options?.region) body.region = options.region
      if (options?.proxy) body.proxy = options.proxy
      if (options?.stealth) body.stealth = true
      if (options?.headless !== undefined) body.headless = options.headless
      if (options?.viewport) body.viewport = options.viewport
      if (options?.extra) Object.assign(body, options.extra)

      const res = await this.client.postJSON<AnchorSessionResponse>(
        `${this.baseURL}/v1/sessions`,
        body,
        this.headers(),
      )

      return {
        id: res.id,
        cdpUrl: res.cdpUrl ?? res.wsEndpoint,
        provider: 'anchor',
        createdAt: Date.now(),
        metadata: { status: res.status },
      }
    }
    catch (error) { throw normalizeError(error, 'anchor') }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    try {
      const res = await this.client.getJSON<AnchorSessionResponse>(
        `${this.baseURL}/v1/sessions/${sessionId}`,
        this.headers(),
      )
      return {
        id: res.id,
        cdpUrl: res.cdpUrl ?? res.wsEndpoint,
        provider: 'anchor',
        createdAt: res.createdAt ? new Date(res.createdAt).getTime() : Date.now(),
        metadata: { status: res.status },
      }
    }
    catch (error: unknown) {
      if (error instanceof Error && 'statusCode' in error && (error as { statusCode: number }).statusCode === 404) return null
      throw normalizeError(error, 'anchor')
    }
  }

  async listSessions(): Promise<BrowserSession[]> {
    try {
      const res = await this.client.getJSON<AnchorSessionResponse[]>(
        `${this.baseURL}/v1/sessions`,
        this.headers(),
      )
      return res.map(s => ({
        id: s.id,
        cdpUrl: s.cdpUrl ?? s.wsEndpoint,
        provider: 'anchor',
        createdAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
        metadata: { status: s.status },
      }))
    }
    catch { return [] }
  }

  async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.client.deleteJSON(
        `${this.baseURL}/v1/sessions/${sessionId}`,
        this.headers(),
      )
    }
    catch (error) { throw normalizeError(error, 'anchor') }
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
    catch (error) { throw normalizeError(error, 'anchor') }
  }

  async screenshot(options: ScreenshotOptions, session: BrowserSession): Promise<ScreenshotResult> {
    try {
      const body: Record<string, unknown> = {
        sessionId: session.id,
        fullPage: options.fullPage ?? true,
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
    catch (error) { throw normalizeError(error, 'anchor') }
  }

  async navigate(_url: string, _session: BrowserSession): Promise<void> {
    throw new Error('Anchor Browser does not support navigate via REST. Connect via CDP for full automation.')
  }

  async evaluate(_script: string, _session: BrowserSession): Promise<EvaluateResult> {
    throw new Error('Anchor Browser does not support evaluate via REST. Connect via CDP (Puppeteer/Playwright) for script execution.')
  }

  getCdpUrl(session: BrowserSession): string | undefined {
    return session.cdpUrl
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

const factory: BrowserProviderFactory = (config) => new AnchorProvider(config)
register('anchor', 'https://api.anchorbrowser.io', factory)
