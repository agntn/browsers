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
  CrawlResult,
  CrawlOptions,
  PdfResult,
  PdfOptions,
} from '../core/types'
import { BroboError, SessionNotFoundError, normalizeError } from '../core/errors'
import { register } from '../core/registry'
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import type { Browser, Page } from 'playwright'

function resolveSystemChromium(): string | undefined {
  const candidates = [
    'google-chrome-stable',
    'google-chrome',
    'chromium',
    'chromium-browser',
    'microsoft-edge',
  ]
  for (const name of candidates) {
    try {
      const path = execSync(`which ${name}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
      if (path) return path
    } catch {
      // not found
    }
  }
  return undefined
}

interface PlaywrightSession {
  browser: Browser
  page: Page
}

class PlaywrightProvider implements BrowserProvider {
  private readonly sessions = new Map<string, PlaywrightSession>()

  constructor(_config: ProviderConfig) {
    // Playwright is local; no API key required.
  }

  name(): string {
    return 'playwright'
  }

  private getSessionData(sessionId: string): PlaywrightSession {
    const data = this.sessions.get(sessionId)
    if (!data) throw new SessionNotFoundError(sessionId, 'playwright')
    return data
  }

  private getPage(session: BrowserSession): Page {
    return this.getSessionData(session.id).page
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const { chromium } = await import('playwright')
      const browser = await chromium.launch({
        headless: options?.headless ?? true,
      })
      const context = await browser.newContext({
        viewport: options?.viewport ?? { width: 1280, height: 720 },
      })
      const page = await context.newPage()
      const id = randomUUID()
      this.sessions.set(id, { browser, page })
      return {
        id,
        provider: 'playwright',
        createdAt: Date.now(),
        metadata: { headless: options?.headless ?? true },
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('executable') || message.includes('browserType.launch')) {
        throw new BroboError(
          `Playwright browser not found. Run: npx playwright install chromium`,
        )
      }
      throw normalizeError(error, 'playwright')
    }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    const data = this.sessions.get(sessionId)
    if (!data) return null
    return {
      id: sessionId,
      provider: 'playwright',
      createdAt: Date.now(),
      metadata: {},
    }
  }

  async listSessions(): Promise<BrowserSession[]> {
    return Array.from(this.sessions.keys()).map(id => ({
      id,
      provider: 'playwright',
      createdAt: Date.now(),
      metadata: {},
    }))
  }

  async releaseSession(sessionId: string): Promise<void> {
    const data = this.sessions.get(sessionId)
    if (!data) throw new SessionNotFoundError(sessionId, 'playwright')
    this.sessions.delete(sessionId)
    await data.browser.close().catch(() => {})
  }

  async scrape(url: string, options?: ScrapeOptions, session?: BrowserSession): Promise<ScrapeResult> {
    let browser: Browser | undefined
    let page: Page
    let owns = false

    try {
      if (session) {
        page = this.getPage(session)
      }
      else {
        const { chromium } = await import('playwright')
        browser = await chromium.launch({ headless: true, executablePath: resolveSystemChromium() })
        page = await browser.newPage()
        owns = true
      }

      await page.goto(url, {
        waitUntil: options?.waitForNetworkIdle ? 'networkidle' : 'load',
      })

      if (options?.waitFor) {
        await page.waitForSelector(options.waitFor, { timeout: options.timeout ?? 25000 })
      }

      const [title, html, text, links] = await Promise.all([
        page.title(),
        page.content(),
        page.evaluate(() => document.body?.innerText || '').catch(() => undefined),
        page
          .evaluate(() =>
            Array.from(document.querySelectorAll('a[href]')).map(
              (a) => (a as HTMLAnchorElement).href,
            ),
          )
          .catch(() => []),
      ])

      if (owns && browser) {
        await browser.close()
      }

      let resultText = text
      if (options?.maxChars && resultText && resultText.length > options.maxChars) {
        resultText = resultText.slice(0, options.maxChars)
      }

      return {
        url,
        title,
        html,
        text: resultText,
        links: [...new Set(links)],
      }
    }
    catch (error) {
      if (owns && browser) {
        await browser.close().catch(() => {})
      }
      throw normalizeError(error, 'playwright')
    }
  }

  async screenshot(options: ScreenshotOptions, session?: BrowserSession): Promise<ScreenshotResult> {
    if (!session) {
      throw new Error('Playwright screenshot requires a session. Create one first with createSession().')
    }

    try {
      const page = this.getPage(session)

      if (options.url) {
        await page.goto(options.url, { waitUntil: 'load' })
      }

      const type = options.format === 'jpeg' ? 'jpeg' : 'png'
      const screenshotOptions: { type: 'png' | 'jpeg'; fullPage?: boolean; quality?: number } = {
        type,
        fullPage: options.fullPage ?? false,
      }
      if (type === 'jpeg' && options.quality) {
        screenshotOptions.quality = options.quality
      }

      const buffer = await page.screenshot(screenshotOptions)
      return {
        data: buffer.toString('base64'),
        mimeType: `image/${type}`,
      }
    }
    catch (error) {
      throw normalizeError(error, 'playwright')
    }
  }

  async navigate(url: string, session: BrowserSession): Promise<void> {
    try {
      const page = this.getPage(session)
      await page.goto(url, { waitUntil: 'load' })
    }
    catch (error) {
      throw normalizeError(error, 'playwright')
    }
  }

  async evaluate(script: string, session: BrowserSession): Promise<EvaluateResult> {
    try {
      const page = this.getPage(session)
      const value = await page.evaluate((s) => {
        return (0, eval)(s)
      }, script)
      return { value }
    }
    catch (error) {
      throw normalizeError(error, 'playwright')
    }
  }

  async pdf(url: string, options?: PdfOptions, session?: BrowserSession): Promise<PdfResult> {
    let browser: Browser | undefined
    let page: Page
    let owns = false

    try {
      if (session) {
        page = this.getPage(session)
      }
      else {
        const { chromium } = await import('playwright')
        browser = await chromium.launch({ headless: true, executablePath: resolveSystemChromium() })
        page = await browser.newPage()
        owns = true
      }

      if (!session || url !== page.url()) {
        await page.goto(url, { waitUntil: 'networkidle' })
      }

      const buffer = await page.pdf({
        format: options?.format ?? 'A4',
        landscape: options?.landscape ?? false,
        printBackground: options?.printBackground ?? true,
      })

      if (owns && browser) {
        await browser.close()
      }

      return {
        data: buffer.toString('base64'),
        mimeType: 'application/pdf',
      }
    }
    catch (error) {
      if (owns && browser) {
        await browser.close().catch(() => {})
      }
      throw normalizeError(error, 'playwright')
    }
  }

  async crawl(url: string, options?: CrawlOptions, session?: BrowserSession): Promise<CrawlResult> {
    const maxPages = options?.maxPages ?? 10
    const maxDepth = options?.maxDepth ?? 2
    const sameDomain = options?.sameDomain ?? true
    const visited = new Set<string>()
    const pages: Array<{
      url: string
      title?: string
      html?: string
      text?: string
      links?: string[]
      depth?: number
    }> = []

    const baseHostname = new URL(url).hostname

    let browser: Browser | undefined
    let page: Page
    let owns = false

    try {
      if (session) {
        page = this.getPage(session)
      }
      else {
        const { chromium } = await import('playwright')
        browser = await chromium.launch({ headless: true, executablePath: resolveSystemChromium() })
        page = await browser.newPage()
        owns = true
      }

      const queue: Array<{ url: string; depth: number }> = [{ url, depth: 0 }]

      while (queue.length > 0 && visited.size < maxPages) {
        const { url: currentUrl, depth } = queue.shift()!
        if (visited.has(currentUrl)) continue
        if (depth > maxDepth) continue

        try {
          await page.goto(currentUrl, { waitUntil: 'load', timeout: 15000 })
          const [title, html, text, links] = await Promise.all([
            page.title().catch(() => undefined),
            page.content().catch(() => undefined),
            page.evaluate(() => document.body?.innerText || '').catch(() => undefined),
            page
              .evaluate(() =>
                Array.from(document.querySelectorAll('a[href]')).map(
                  (a) => (a as HTMLAnchorElement).href,
                ),
              )
              .catch(() => []),
          ])

          visited.add(currentUrl)
          pages.push({ url: currentUrl, title, html, text, links, depth })

          if (depth < maxDepth) {
            for (const link of links) {
              try {
                const parsed = new URL(link, currentUrl)
                const normalized = parsed.toString()
                if (visited.has(normalized)) continue
                if (sameDomain && parsed.hostname !== baseHostname) continue
                queue.push({ url: normalized, depth: depth + 1 })
              }
              catch {
                // ignore malformed URLs
              }
            }
          }
        }
        catch {
          // skip pages that fail to load
        }
      }

      if (owns && browser) {
        await browser.close()
      }

      return {
        pages: pages.map(p => ({
          url: p.url,
          title: p.title,
          html: p.html,
          text: p.text,
          links: p.links,
          depth: p.depth,
        })),
        totalFound: visited.size,
      }
    }
    catch (error) {
      if (owns && browser) {
        await browser.close().catch(() => {})
      }
      throw normalizeError(error, 'playwright')
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { chromium } = await import('playwright')
      const browser = await chromium.launch({ headless: true, executablePath: resolveSystemChromium() })
      await browser.close()
      return true
    }
    catch {
      return false
    }
  }
}

const factory: BrowserProviderFactory = (config) => new PlaywrightProvider(config)
register('playwright', 'local', factory)
