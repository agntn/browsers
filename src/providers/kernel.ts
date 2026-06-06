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

interface KernelSessionResponse {
  id: string
  cdpUrl?: string
  websocketUrl?: string
  status?: string
  createdAt?: string
  [key: string]: unknown
}

class KernelProvider implements BrowserProvider {
  private readonly client: Client
  private readonly baseURL: string
  private readonly apiKey: string

  constructor(config: ProviderConfig) {
    if (!config.apiKey) {
      throw new AuthError('Missing API key for Kernel. Set KERNEL_API_KEY', 'kernel')
    }
    this.client = defaultClient()
    this.baseURL = (config.baseURL ?? 'https://api.kernel.sh').replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  name(): string { return 'kernel' }

  capabilities(): ProviderCapabilities {
    return {
      scrape: true, screenshot: true, navigate: true, evaluate: true,
      sessions: true, cdp: true, statelessScrape: false, statelessScreenshot: false,
      crawl: false, pdf: false, links: false, search: false, extract: false,
    }
  }

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
      if (options?.timeout) body.timeout_seconds = Math.floor(options.timeout / 1000)
      if (options?.viewport) body.viewport = options.viewport
      if (options?.extra) Object.assign(body, options.extra)

      const res = await this.client.postJSON<KernelSessionResponse>(
        `${this.baseURL}/v1/browsers`,
        body,
        this.headers(),
      )

      return {
        id: res.id,
        cdpUrl: res.cdpUrl ?? res.websocketUrl,
        provider: 'kernel',
        createdAt: Date.now(),
        metadata: { status: res.status },
      }
    }
    catch (error) { throw normalizeError(error, 'kernel') }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    try {
      const res = await this.client.getJSON<KernelSessionResponse>(
        `${this.baseURL}/v1/browsers/${sessionId}`,
        this.headers(),
      )
      return {
        id: res.id,
        cdpUrl: res.cdpUrl ?? res.websocketUrl,
        provider: 'kernel',
        createdAt: res.createdAt ? new Date(res.createdAt).getTime() : Date.now(),
        metadata: { status: res.status },
      }
    }
    catch (error: unknown) {
      if (isNotFoundError(error)) return null
      throw normalizeError(error, 'kernel')
    }
  }

  async listSessions(): Promise<BrowserSession[]> {
    const res = await this.client.getJSON<KernelSessionResponse[]>(
      `${this.baseURL}/v1/browsers`,
      this.headers(),
    )
    return res.map(s => ({
      id: s.id,
      cdpUrl: s.cdpUrl ?? s.websocketUrl,
      provider: 'kernel',
      createdAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
      metadata: { status: s.status },
    }))
  }

  async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.client.deleteJSON(
        `${this.baseURL}/v1/browsers/${sessionId}`,
        this.headers(),
      )
    }
    catch (error) { throw normalizeError(error, 'kernel') }
  }

  async scrape(url: string, options?: ScrapeOptions, session?: BrowserSession): Promise<ScrapeResult> {
    try {
      assertSessionId(session?.id, 'kernel', 'scrape')

      const result = await this.evaluate(
        `await page.goto(${JSON.stringify(url)}, { waitUntil: 'networkidle' }); return { html: await page.content(), title: await page.title() }`,
        session!,
      )

      const data = result.value as { html?: string; title?: string } | undefined
      return {
        url,
        title: data?.title,
        html: data?.html,
      }
    }
    catch (error) { throw normalizeError(error, 'kernel') }
  }

  async screenshot(options: ScreenshotOptions, session?: BrowserSession): Promise<ScreenshotResult> {
    try {
      assertSessionId(session?.id, 'kernel', 'screenshot')
      const body: Record<string, unknown> = {
        fullPage: options.fullPage ?? true,
      }
      if (options.selector) body.selector = options.selector

      const res = await this.client.postJSON<{ data?: string; screenshot?: string }>(
        `${this.baseURL}/v1/browsers/${session.id}/screenshot`,
        body,
        this.headers(),
      )

      return {
        data: res.data ?? res.screenshot ?? '',
        mimeType: `image/${options.format ?? 'png'}`,
      }
    }
    catch (error) { throw normalizeError(error, 'kernel') }
  }

  async navigate(url: string, session: BrowserSession): Promise<void> {
    await this.evaluate(
      `await page.goto(${JSON.stringify(url)})`,
      session,
    )
  }

  async evaluate(script: string, session: BrowserSession): Promise<EvaluateResult> {
    try {
      const res = await this.client.postJSON<{ result?: { value?: unknown }; value?: unknown; logs?: string[] }>(
        `${this.baseURL}/v1/browsers/${session.id}/playwright`,
        { code: script },
        this.headers(),
      )
      return {
        value: res.result?.value ?? res.value,
        logs: res.logs,
      }
    }
    catch (error) { throw normalizeError(error, 'kernel') }
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

const factory: BrowserProviderFactory = (config) => new KernelProvider(config)
register('kernel', 'https://api.kernel.sh', factory)
