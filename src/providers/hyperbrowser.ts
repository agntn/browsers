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

interface HyperbrowserSessionResponse {
  id: string
  cdpUrl?: string
  wsEndpoint?: string
  status?: string
  createdAt?: string
  [key: string]: unknown
}

class HyperbrowserProvider implements BrowserProvider {
  private readonly client: Client
  private readonly baseURL: string
  private readonly apiKey: string

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new AuthError('Missing API key for Hyperbrowser. Set HYPERBROWSER_API_KEY', 'hyperbrowser')
    }
    this.client = defaultClient()
    this.baseURL = (config.baseURL ?? 'https://app.hyperbrowser.ai/api').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  name(): string { return 'hyperbrowser' }

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
    }
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const body: Record<string, unknown> = {}
      if (options?.region) body.region = options.region
      if (options?.proxy) body.proxy = options.proxy
      if (options?.stealth) body.stealth = true
      if (options?.extra) Object.assign(body, options.extra)

      const res = await this.client.postJSON<HyperbrowserSessionResponse>(
        `${this.baseURL}/v1/session`,
        body,
        this.headers(),
      )

      return {
        id: res.id,
        cdpUrl: res.cdpUrl ?? res.wsEndpoint,
        provider: 'hyperbrowser',
        createdAt: Date.now(),
        metadata: { status: res.status },
      }
    }
    catch (error) { throw normalizeError(error, 'hyperbrowser') }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    try {
      const res = await this.client.getJSON<HyperbrowserSessionResponse>(
        `${this.baseURL}/v1/session/${sessionId}`,
        this.headers(),
      )
      return {
        id: res.id,
        cdpUrl: res.cdpUrl ?? res.wsEndpoint,
        provider: 'hyperbrowser',
        createdAt: res.createdAt ? new Date(res.createdAt).getTime() : Date.now(),
        metadata: { status: res.status },
      }
    }
    catch (error: unknown) {
      if (error instanceof Error && 'statusCode' in error && (error as { statusCode: number }).statusCode === 404) return null
      throw normalizeError(error, 'hyperbrowser')
    }
  }

  async listSessions(): Promise<BrowserSession[]> {
    try {
      const res = await this.client.getJSON<HyperbrowserSessionResponse[]>(
        `${this.baseURL}/v1/sessions`,
        this.headers(),
      )
      return res.map(s => ({
        id: s.id,
        cdpUrl: s.cdpUrl ?? s.wsEndpoint,
        provider: 'hyperbrowser',
        createdAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
        metadata: { status: s.status },
      }))
    }
    catch { return [] }
  }

  async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.client.deleteJSON(
        `${this.baseURL}/v1/session/${sessionId}`,
        this.headers(),
      )
    }
    catch (error) { throw normalizeError(error, 'hyperbrowser') }
  }

  async scrape(url: string, options?: ScrapeOptions, _session?: BrowserSession): Promise<ScrapeResult> {
    try {
      const body: Record<string, unknown> = { url }
      if (options?.waitFor) body.waitFor = options.waitFor
      if (options?.headers) body.headers = options.headers
      if (options?.script) body.js = options.script

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
    catch (error) { throw normalizeError(error, 'hyperbrowser') }
  }

  async screenshot(options: ScreenshotOptions, session: BrowserSession): Promise<ScreenshotResult> {
    try {
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
    catch (error) { throw normalizeError(error, 'hyperbrowser') }
  }

  async navigate(url: string, session: BrowserSession): Promise<void> {
    await this.evaluate(`window.location.href = ${JSON.stringify(url)}`, session)
  }

  async evaluate(script: string, session: BrowserSession): Promise<EvaluateResult> {
    try {
      const res = await this.client.postJSON<{ value?: unknown; logs?: string[] }>(
        `${this.baseURL}/v1/session/${session.id}/execute`,
        { code: script },
        this.headers(),
      )
      return { value: res.value, logs: res.logs }
    }
    catch (error) { throw normalizeError(error, 'hyperbrowser') }
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

const factory: BrowserProviderFactory = (config) => new HyperbrowserProvider(config)
register('hyperbrowser', 'https://app.hyperbrowser.ai/api', factory)
