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
  CrawlPage,
  CrawlOptions,
  PdfResult,
  PdfOptions,
  ProviderCapabilities,
  LinksResult,
} from "../core/types";
import { BrowserError, SessionNotFoundError, normalizeError } from "../core/errors";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import type { Browser, Page } from "playwright-core";

function resolveSystemChromium(): string | undefined {
  const candidates = [
    "google-chrome-stable",
    "google-chrome",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
  ];
  for (const name of candidates) {
    try {
      const path = execSync(`which ${name}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      if (path) return path;
    } catch {
      // not found
    }
  }
  return undefined;
}

interface PlaywrightSessionRecord {
  readonly session: BrowserSession;
  readonly browser: Browser;
  readonly page: Page;
}

/**
 * Live Chromium sessions keyed by session ID, shared by every provider
 * instance the way the Browserless store is: agent tools build a new provider
 * per call, so an instance field stranded the browser process on release.
 */
const playwrightSessions = new Map<string, PlaywrightSessionRecord>();

interface PageLease {
  readonly page: Page;
  readonly browser?: Browser;
}

function normalizePlaywrightError(error: unknown): BrowserError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("executable") || message.includes("browserType.launch")) {
    return new BrowserError(
      "Playwright browser not found. Run: npx playwright-core install chromium",
    );
  }
  return normalizeError(error, "playwright");
}

function truncateText(text: string | undefined, maxChars: number | undefined): string | undefined {
  if (!maxChars || !text || text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

async function scrapePage(page: Page, url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
  await page.goto(url, {
    waitUntil: options?.waitForNetworkIdle ? "networkidle" : "domcontentloaded",
  });
  if (options?.waitFor) {
    await page.waitForSelector(options.waitFor, { timeout: options.timeout ?? 25000 });
  }

  const [title, html, text, links] = await Promise.all([
    page.title(),
    page.content(),
    page.evaluate(() => document.body?.innerText || "").catch(() => undefined),
    page
      .evaluate(() =>
        Array.from(document.querySelectorAll("a[href]")).map(
          (anchor) => (anchor as HTMLAnchorElement).href,
        ),
      )
      .catch(() => []),
  ]);

  return {
    url,
    title,
    html,
    text: truncateText(text, options?.maxChars),
    links: [...new Set(links)],
  };
}

async function renderPdf(
  page: Page,
  url: string,
  options: PdfOptions | undefined,
  hasSession: boolean,
): Promise<PdfResult> {
  if (!hasSession || url !== page.url()) {
    await page.goto(url, { waitUntil: "networkidle" });
  }
  const buffer = await page.pdf({
    format: options?.format ?? "A4",
    landscape: options?.landscape ?? false,
    printBackground: options?.printBackground ?? true,
  });
  return {
    data: buffer.toString("base64"),
    mimeType: "application/pdf",
  };
}

async function readLinks(page: Page, url: string): Promise<LinksResult> {
  await page.goto(url, { waitUntil: "load", timeout: 15000 });
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((anchor) => {
      const element = anchor as HTMLAnchorElement;
      return {
        href: element.href,
        text: element.textContent?.trim() || undefined,
        rel: element.rel || undefined,
      };
    }),
  );
  return { url, links };
}

async function readCrawlPage(page: Page, url: string, depth: number): Promise<CrawlPage> {
  await page.goto(url, { waitUntil: "load", timeout: 15000 });
  const [title, html, text, links] = await Promise.all([
    page.title().catch(() => undefined),
    page.content().catch(() => undefined),
    page.evaluate(() => document.body?.innerText || "").catch(() => undefined),
    page
      .evaluate(() =>
        Array.from(document.querySelectorAll("a[href]")).map(
          (anchor) => (anchor as HTMLAnchorElement).href,
        ),
      )
      .catch(() => []),
  ]);
  return { url, title, html, text, links, depth };
}

interface CrawlSettings {
  readonly maxPages: number;
  readonly maxDepth: number;
  readonly sameDomain: boolean;
}

function resolveCrawlSettings(options?: CrawlOptions): CrawlSettings {
  return {
    maxPages: options?.maxPages ?? 10,
    maxDepth: options?.maxDepth ?? 2,
    sameDomain: options?.sameDomain ?? true,
  };
}

async function crawlPage(
  page: Page,
  url: string,
  baseHostname: string,
  options?: CrawlOptions,
): Promise<CrawlResult> {
  const { maxPages, maxDepth, sameDomain } = resolveCrawlSettings(options);
  const visited = new Set<string>();
  const pages: CrawlPage[] = [];
  const queue: Array<{ url: string; depth: number }> = [{ url, depth: 0 }];

  function enqueueLinks(links: readonly string[], currentUrl: string, depth: number): void {
    if (depth >= maxDepth) return;
    for (const link of links) {
      try {
        const parsed = new URL(link, currentUrl);
        const normalized = parsed.toString();
        if (visited.has(normalized)) continue;
        if (sameDomain && parsed.hostname !== baseHostname) continue;
        queue.push({ url: normalized, depth: depth + 1 });
      } catch {}
    }
  }

  while (queue.length > 0 && visited.size < maxPages) {
    const next = queue.shift();
    if (!next) break;
    if (visited.has(next.url) || next.depth > maxDepth) continue;
    try {
      const crawled = await readCrawlPage(page, next.url, next.depth);
      visited.add(next.url);
      pages.push(crawled);
      enqueueLinks(crawled.links ?? [], next.url, next.depth);
    } catch {}
  }

  return { pages, totalFound: visited.size };
}

class PlaywrightProvider implements BrowserProvider {
  constructor(_config: ProviderConfig) {
    // Playwright is local; no API key required.
  }

  name(): string {
    return "playwright";
  }

  capabilities(): ProviderCapabilities {
    return {
      scrape: true,
      screenshot: true,
      navigate: true,
      evaluate: true,
      sessions: true,
      cdp: false,
      statelessScrape: true,
      statelessScreenshot: false,
      elementScreenshot: true,
      crawl: true,
      pdf: true,
      links: true,
      search: false,
      extract: false,
    };
  }

  private getSessionData(sessionId: string): PlaywrightSessionRecord {
    const record = playwrightSessions.get(sessionId);
    if (!record) throw new SessionNotFoundError(sessionId, "playwright");
    return record;
  }

  private getPage(session: BrowserSession): Page {
    return this.getSessionData(session.id).page;
  }

  private async acquirePage(session?: BrowserSession): Promise<PageLease> {
    if (session) return { page: this.getPage(session) };
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({
      headless: true,
      executablePath: resolveSystemChromium(),
    });
    return { browser, page: await browser.newPage() };
  }

  private async withPage<T>(
    session: BrowserSession | undefined,
    operation: (page: Page) => Promise<T>,
  ): Promise<T> {
    let lease: PageLease | undefined;
    try {
      lease = await this.acquirePage(session);
      const result = await operation(lease.page);
      if (lease.browser) await lease.browser.close();
      return result;
    } catch (error) {
      if (lease?.browser) await lease.browser.close().catch(() => {});
      throw normalizeError(error, "playwright");
    }
  }

  async createSession(options?: CreateSessionOptions): Promise<BrowserSession> {
    try {
      const { chromium } = await import("playwright-core");
      const browser = await chromium.launch({
        headless: options?.headless ?? true,
        executablePath: resolveSystemChromium(),
      });
      const context = await browser.newContext({
        viewport: options?.viewport ?? { width: 1280, height: 720 },
      });
      const page = await context.newPage();
      const session: BrowserSession = {
        id: randomUUID(),
        provider: "playwright",
        createdAt: Date.now(),
        metadata: { headless: options?.headless ?? true },
      };
      playwrightSessions.set(session.id, { session, browser, page });
      return { ...session };
    } catch (error) {
      throw normalizePlaywrightError(error);
    }
  }

  async getSession(sessionId: string): Promise<BrowserSession | null> {
    const record = playwrightSessions.get(sessionId);
    return record ? { ...record.session } : null;
  }

  async listSessions(): Promise<BrowserSession[]> {
    return Array.from(playwrightSessions.values(), ({ session }) => ({ ...session }));
  }

  async releaseSession(sessionId: string): Promise<void> {
    const record = this.getSessionData(sessionId);
    playwrightSessions.delete(sessionId);
    await record.browser.close().catch(() => {});
  }

  async scrape(
    url: string,
    options?: ScrapeOptions,
    session?: BrowserSession,
  ): Promise<ScrapeResult> {
    return this.withPage(session, (page) => scrapePage(page, url, options));
  }

  async screenshot(
    options: ScreenshotOptions,
    session?: BrowserSession,
  ): Promise<ScreenshotResult> {
    if (!session) {
      throw new Error(
        "Playwright screenshot requires a session. Create one first with createSession().",
      );
    }

    try {
      const page = this.getPage(session);

      if (options.url) {
        await page.goto(options.url, { waitUntil: "load" });
      }

      const type = options.format === "jpeg" ? "jpeg" : "png";
      const screenshotOptions: { type: "png" | "jpeg"; quality?: number } = { type };
      if (type === "jpeg" && options.quality) {
        screenshotOptions.quality = options.quality;
      }

      const buffer =
        options.selector !== undefined
          ? await page.locator(options.selector).screenshot(screenshotOptions)
          : await page.screenshot({ ...screenshotOptions, fullPage: options.fullPage ?? false });
      return {
        data: buffer.toString("base64"),
        mimeType: `image/${type}`,
      };
    } catch (error) {
      throw normalizeError(error, "playwright");
    }
  }

  async navigate(url: string, session: BrowserSession): Promise<void> {
    try {
      const page = this.getPage(session);
      await page.goto(url, { waitUntil: "load" });
    } catch (error) {
      throw normalizeError(error, "playwright");
    }
  }

  async evaluate(script: string, session: BrowserSession): Promise<EvaluateResult> {
    try {
      const page = this.getPage(session);
      const value: unknown = await page.evaluate((source): unknown => {
        const result: unknown = globalThis.eval(source);
        return result;
      }, script);
      return { value };
    } catch (error) {
      throw normalizeError(error, "playwright");
    }
  }

  async pdf(url: string, options?: PdfOptions, session?: BrowserSession): Promise<PdfResult> {
    return this.withPage(session, (page) => renderPdf(page, url, options, session !== undefined));
  }

  async links(url: string, session?: BrowserSession): Promise<LinksResult> {
    return this.withPage(session, (page) => readLinks(page, url));
  }

  async crawl(url: string, options?: CrawlOptions, session?: BrowserSession): Promise<CrawlResult> {
    const baseHostname = new URL(url).hostname;
    return this.withPage(session, (page) => crawlPage(page, url, baseHostname, options));
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { chromium } = await import("playwright-core");
      const browser = await chromium.launch({
        headless: true,
        executablePath: resolveSystemChromium(),
      });
      await browser.close();
      return true;
    } catch {
      return false;
    }
  }
}

export const factory: BrowserProviderFactory = (config) => new PlaywrightProvider(config);
