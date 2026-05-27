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

interface CfEnvelope<T = unknown> {
  success: boolean
  result: T
  errors?: Array<{ code: number; message: string }>
  messages?: string[]
}

interface CfSessionResult {
  sessionId?: string
  sessionId2?: string
  closeReason?: string
  connectionStartTime?: number
  connectionEndTime?: number
  connectionId?: string
  [key: string]: unknown
}

interface CfContentResult {
  content?: string
  [key: string]: unknown
}

interface CfScreenshotResult {
  image?: string
  [key: string]: unknown
}

class CloudflareProvider implements BrowserProvider {
  private readonly client: Client
  private readonly accountID: string
  private readonly apiToken: string

  constructor(config: ProviderConfig & { accountID?: string }) {
    const apiToken = config.apiKey || process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN
    const accountID = config.accountID || process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID

    if (!apiToken) {
      throw new AuthError('Missing Cloudflare API token. Set CF_API_TOKEN (or CLOUDFLARE_API_TOKEN)', 'cloudflare')
    }
    if (!accountID) {
      throw new AuthError('Missing Cloudflare account ID. Set CF_ACCOUNT_ID (or CLOUDFLARE_ACCOUNT_ID)', 'cloudflare')
    }

    this.client = defaultClient()
    this.apiToken = apiToken
    this.accountID = accountID
  }

  name(): string { return 'cloudflare' }

  private base(): string {
    return `https://api.cloudflare.com/client/v4/accounts/${this.accountID}/browser-rendering`
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    }
  }

  private unwrap<T>(envelope: CfEnvelope<T>): T {
    if (!envelope.success) {
      const msg = envelope.errors?.map(e => e.message).join('; ') ?? 'Unknown Cloudflare error'
      throw new Error(msg)
    }
    return envelope.result
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const params = new URLSearchParams()
      if (options?.timeout) params.set('keep_alive', String(options.timeout))
      const qs = params.toString() ? `?${params}` : ''

      const res = await this.client.postJSON<CfEnvelope<CfSessionResult>>(
        `${this.base()}/devtools/browser${qs}`,
        {},
        this.headers(),
      )
      const result = this.unwrap(res)

      return {
        id: result.sessionId ?? '',
        provider: 'cloudflare',
        createdAt: Date.now(),
        metadata: { connectionId: result.connectionId },
      }
    }
    catch (error) { throw normalizeError(error, 'cloudflare') }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    try {
      const res = await this.client.getJSON<CfEnvelope<CfSessionResult>>(
        `${this.base()}/devtools/browser/${sessionId}`,
        this.headers(),
      )
      if (!res.success) return null
      return {
        id: sessionId,
        provider: 'cloudflare',
        createdAt: res.result.connectionStartTime ?? Date.now(),
        metadata: res.result,
      }
    }
    catch { return null }
  }

  async listSessions(): Promise<BrowserSession[]> {
    try {
      const res = await this.client.getJSON<CfEnvelope<CfSessionResult[]>>(
        `${this.base()}/devtools/session`,
        this.headers(),
      )
      const sessions = this.unwrap(res)
      return (Array.isArray(sessions) ? sessions : []).map(s => ({
        id: s.sessionId ?? '',
        provider: 'cloudflare',
        createdAt: s.connectionStartTime ?? Date.now(),
        metadata: s,
      }))
    }
    catch { return [] }
  }

  async releaseSession(sessionId: string): Promise<void> {
    try {
      await this.client.deleteJSON(
        `${this.base()}/devtools/browser/${sessionId}`,
        this.headers(),
      )
    }
    catch (error) { throw normalizeError(error, 'cloudflare') }
  }

  async scrape(url: string, options?: ScrapeOptions, _session?: BrowserSession): Promise<ScrapeResult> {
    try {
      const body: Record<string, unknown> = { url }
      if (options?.waitFor) body.waitForSelector = options.waitFor
      if (options?.waitForNetworkIdle) body.waitForSelector = options.waitForNetworkIdle
      if (options?.headers) body.headers = options.headers
      if (options?.script) body.addScriptTag = { content: options.script }

      const res = await this.client.postJSON<CfEnvelope<CfContentResult>>(
        `${this.base()}/content`,
        body,
        this.headers(),
      )
      const result = this.unwrap(res) as CfContentResult | string

      return {
        url,
        html: typeof result === 'string' ? result : result.content,
      }
    }
    catch (error) { throw normalizeError(error, 'cloudflare') }
  }

  async screenshot(options: ScreenshotOptions, _session?: BrowserSession): Promise<ScreenshotResult> {
    try {
      const body: Record<string, unknown> = {}
      if (options.selector) body.selector = options.selector
      if (options.fullPage !== undefined) body.fullPage = options.fullPage
      if (options.format) body.type = options.format
      if (options.quality) body.quality = options.quality

      const res = await this.client.postJSON<CfEnvelope<CfScreenshotResult>>(
        `${this.base()}/screenshot`,
        body,
        this.headers(),
      )
      const result = this.unwrap(res)

      return {
        data: result.image ?? '',
        mimeType: `image/${options.format ?? 'png'}`,
      }
    }
    catch (error) { throw normalizeError(error, 'cloudflare') }
  }

  async navigate(_url: string, _session: BrowserSession): Promise<void> {
    throw new Error('Cloudflare Browser Run does not support navigate on sessions. Use scrape/screenshot for quick actions, or connect via CDP for full automation.')
  }

  async evaluate(_script: string, _session: BrowserSession): Promise<EvaluateResult> {
    throw new Error('Cloudflare Browser Run does not support evaluate via REST. Connect via CDP (Puppeteer/Playwright) for script execution.')
  }

  getCdpUrl(session: BrowserSession): string | undefined {
    if (!session.id) return undefined
    return `wss://cloudflare.com/browser-run/devtools/browser/${session.id}`
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await this.client.getJSON<CfEnvelope<unknown>>(
        `${this.base()}/devtools/session`,
        this.headers(),
      )
      return res.success
    }
    catch { return false }
  }
}

const factory: BrowserProviderFactory = (config) => new CloudflareProvider(config)
register('cloudflare', 'https://api.cloudflare.com', factory)
