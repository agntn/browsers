import type {
  BrowserProvider,
  BrowserSession,
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
  LinksResult,
  ExtractResult,
  ExtractOptions,
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

  async screenshot(options: ScreenshotOptions, session?: BrowserSession): Promise<ScreenshotResult> {
    try {
      if (!options.url && !session?.id) {
        throw new Error('Cloudflare screenshot requires either options.url or a session')
      }

      const body: Record<string, unknown> = {}
      if (options.url) body.url = options.url
      if (session?.id) body.sessionId = session.id
      if (options.selector) body.selector = options.selector
      if (options.fullPage !== undefined) body.fullPage = options.fullPage

      const res = await fetch(
        `${this.base()}/screenshot`,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
        },
      )

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Cloudflare screenshot HTTP ${res.status}: ${errText.slice(0, 200)}`)
      }

      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('image')) {
        const png = await res.arrayBuffer()
        return {
          data: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
          mimeType: 'image/png',
        }
      }

      const data = await res.json() as CfEnvelope<CfScreenshotResult>
      const result = this.unwrap(data)
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

  async crawl(url: string, options?: CrawlOptions, _session?: BrowserSession): Promise<CrawlResult> {
    try {
      const body: Record<string, unknown> = { url }
      if (options?.maxDepth) body.depth = options.maxDepth
      if (options?.maxPages) body.limit = options.maxPages
      if (options?.formats) body.output_format = options.formats[0]

      const res = await this.client.postJSON<CfEnvelope<string | Record<string, unknown>>>(
        `${this.base()}/crawl`,
        body,
        this.headers(),
      )
      const result = this.unwrap(res)

      if (typeof result === 'string') {
        return { pages: [], totalFound: 0, jobId: result, status: 'running' }
      }

      const pages = (result.pages ?? result.data ?? []) as Array<Record<string, unknown>>
      return {
        pages: pages.map(p => ({ url: (p.url ?? '') as string, html: p.html as string, markdown: p.markdown as string, title: p.title as string })),
        totalFound: pages.length,
        jobId: result.jobId as string,
        status: result.status as 'completed' | 'running' | 'failed',
      }
    }
    catch (error) { throw normalizeError(error, 'cloudflare') }
  }

  async pdf(url: string, options?: PdfOptions, _session?: BrowserSession): Promise<PdfResult> {
    try {
      const body: Record<string, unknown> = { url }
      if (options?.format) body.format = options.format
      if (options?.landscape !== undefined) body.landscape = options.landscape
      if (options?.printBackground !== undefined) body.printBackground = options.printBackground
      if (options?.css) body.css = options.css

      const res = await fetch(
        `${this.base()}/pdf`,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) throw new Error(`Cloudflare PDF HTTP ${res.status}`)

      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('pdf')) {
        const buf = await res.arrayBuffer()
        return { data: `data:application/pdf;base64,${Buffer.from(buf).toString('base64')}`, mimeType: 'application/pdf' }
      }
      const data = await res.json() as CfEnvelope<Record<string, unknown>>
      const result = this.unwrap(data)
      return { data: (result.data ?? result.content ?? '') as string, mimeType: 'application/pdf' }
    }
    catch (error) { throw normalizeError(error, 'cloudflare') }
  }

  async links(url: string, _session?: BrowserSession): Promise<LinksResult> {
    try {
      const res = await this.client.postJSON<CfEnvelope<string[]>>(
        `${this.base()}/links`,
        { url },
        this.headers(),
      )
      const result = this.unwrap(res)
      const rawLinks = Array.isArray(result) ? result : []
      return {
        url,
        links: rawLinks.map(href => ({ href })),
      }
    }
    catch (error) { throw normalizeError(error, 'cloudflare') }
  }

  async extract(url: string, options?: ExtractOptions, _session?: BrowserSession): Promise<ExtractResult> {
    try {
      const body: Record<string, unknown> = { url }
      if (options?.prompt) body.prompt = options.prompt
      if (options?.schema) body.response_format = { type: 'json_schema', json_schema: options.schema }

      const res = await this.client.postJSON<CfEnvelope<Record<string, unknown>>>(
        `${this.base()}/json`,
        body,
        this.headers(),
      )
      const result = this.unwrap(res)
      return {
        url,
        data: result.data ?? result,
        markdown: result.markdown as string | undefined,
      }
    }
    catch (error) { throw normalizeError(error, 'cloudflare') }
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
