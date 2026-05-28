import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Text } from "@earendil-works/pi-tui"
import { Type } from "typebox"

const builtinProviders = ["steel", "browserbase", "kernel", "browserless", "hyperbrowser", "anchor", "cloudflare", "playwright"] as const

const specialEnvKeys: Record<string, string[]> = {
  cloudflare: ["CF_API_TOKEN", "CLOUDFLARE_API_TOKEN"],
}

function hasKey(provider: string): boolean {
  if (provider === "playwright") return true
  const specials = specialEnvKeys[provider]
  if (specials) return specials.some(k => !!process.env[k])
  return !!process.env[`${provider.toUpperCase()}_API_KEY`]
}

function resolveProvider(preferred?: string): string {
  if (preferred && (builtinProviders as readonly string[]).includes(preferred)) return preferred
  for (const name of builtinProviders) {
    if (hasKey(name)) return name
  }
  throw new Error("No browser provider configured. Set one of: STEEL_API_KEY, BROWSERBASE_API_KEY, KERNEL_API_KEY, BROWSERLESS_API_KEY, HYPERBROWSER_API_KEY, ANCHOR_API_KEY, CF_API_TOKEN + CF_ACCOUNT_ID")
}

function getHeaders(provider: string, apiKey: string): Record<string, string> {
  switch (provider) {
    case "steel": return { "steel-api-key": apiKey, "Content-Type": "application/json" }
    case "browserbase": return { "X-BB-API-Key": apiKey, "Content-Type": "application/json" }
    case "kernel": return { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }
    case "browserless": return { "Content-Type": "application/json" }
    case "hyperbrowser": return { "x-api-key": apiKey, "Content-Type": "application/json" }
    case "anchor": return { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }
    case "cloudflare": return { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }
    case "playwright": return {}
    default: return { "Content-Type": "application/json" }
  }
}

function getBaseURL(provider: string): string {
  switch (provider) {
    case "steel": return "https://api.steel.dev"
    case "browserbase": return "https://api.browserbase.com"
    case "kernel": return "https://api.kernel.sh"
    case "browserless": return "https://chrome.browserless.io"
    case "hyperbrowser": return "https://app.hyperbrowser.ai/api"
    case "anchor": return "https://api.anchorbrowser.io"
    case "cloudflare": return `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering`
    case "playwright": return "local"
    default: throw new Error(`Unknown provider: ${provider}`)
  }
}

function getApiKey(provider: string): string {
  if (provider === "cloudflare") {
    const key = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN
    if (!key) throw new Error("Missing CF_API_TOKEN (or CLOUDFLARE_API_TOKEN)")
    if (!process.env.CF_ACCOUNT_ID && !process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error("Missing CF_ACCOUNT_ID (or CLOUDFLARE_ACCOUNT_ID)")
    return key
  }
  if (provider === "playwright") return ""
  const key = process.env[`${provider.toUpperCase()}_API_KEY`]
  if (!key) throw new Error(`Missing API key for ${provider}. Set ${provider.toUpperCase()}_API_KEY`)
  return key
}

const providerCapabilities: Record<string, { scrape: boolean; screenshot: boolean; navigate: boolean; evaluate: boolean; sessions: boolean; cdp: boolean; statelessScrape: boolean; statelessScreenshot: boolean; crawl: boolean; pdf: boolean; links: boolean; search: boolean; extract: boolean }> = {
  steel:           { scrape: true, screenshot: true, navigate: false, evaluate: false, sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: false, crawl: false, pdf: false, links: false, search: false, extract: false },
  browserbase:     { scrape: true, screenshot: true, navigate: false, evaluate: false, sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: false, crawl: false, pdf: false, links: false, search: false, extract: false },
  kernel:          { scrape: true, screenshot: true, navigate: true,  evaluate: true,  sessions: true,  cdp: true,  statelessScrape: false, statelessScreenshot: false, crawl: false, pdf: false, links: false, search: false, extract: false },
  browserless:     { scrape: true, screenshot: true, navigate: true,  evaluate: true,  sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: true,  crawl: false, pdf: true,  links: false, search: false, extract: false },
  hyperbrowser:    { scrape: true, screenshot: true, navigate: false, evaluate: false, sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: false, crawl: true,  pdf: false, links: false, search: true,  extract: true },
  anchor:          { scrape: false, screenshot: true, navigate: false, evaluate: false, sessions: true,  cdp: true,  statelessScrape: false, statelessScreenshot: false, crawl: false, pdf: false, links: false, search: false, extract: false },
  cloudflare:      { scrape: true, screenshot: true, navigate: false, evaluate: false, sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: true,  crawl: true,  pdf: true,  links: true,  search: false, extract: true },
  playwright:      { scrape: true, screenshot: true, navigate: true,  evaluate: true,  sessions: true,  cdp: false, statelessScrape: true,  statelessScreenshot: false, crawl: true,  pdf: true,  links: true,  search: false, extract: false },
}

const scrapeParameters = Type.Object({
  url: Type.String({ description: "URL to scrape" }),
  provider: Type.Optional(Type.String({ description: `Provider name. One of: ${builtinProviders.join(", ")}. Auto-detected from env.` })),
  waitFor: Type.Optional(Type.String({ description: "CSS selector to wait for before extraction" })),
})

const sessionParameters = Type.Object({
  provider: Type.Optional(Type.String({ description: "Provider name (auto-detected from env)" })),
  region: Type.Optional(Type.String({ description: "Preferred region (e.g. us-east-1, eu-west-1)" })),
})

const releaseParameters = Type.Object({
  sessionId: Type.String({ description: "Session ID to release" }),
  provider: Type.Optional(Type.String({ description: "Provider name (auto-detected from env)" })),
})

const emptyParameters = Type.Object({})

async function getBroboProvider(name: string) {
  const mod = await import("brobo").catch(() => {
    // @ts-ignore — runtime import from same package source
    return import("../../src/index.ts")
  })
  return mod.create(name)
}

export default function broboExtension(pi: ExtensionAPI) {

  pi.registerTool({
    name: "brobo_scrape",
    label: "Brobo Scrape",
    description: "Read-only/open-world network fetch: scrape content from a URL using a cloud browser provider. Returns rendered HTML/markdown/text after JavaScript execution. Use when a URL needs a real browser to render (JS-heavy SPAs, sites with bot protection, dynamic content). Capabilities per provider: steel (stateless scrape, CDP navigate/evaluate), browserbase (stateless scrape, CDP only), kernel (session-based Playwright), browserless (stateless scrape+screenshot, CDP), hyperbrowser (stateless scrape, CDP only), anchor (stateless scrape, CDP only), cloudflare (stateless scrape+screenshot, CDP).",
    promptSnippet: "Scrape a URL with a cloud browser provider when the page needs JS rendering.",
    promptGuidelines: [
      "Use brobo_scrape when a URL needs a real browser to render (SPA, bot-protected, dynamic).",
      "For simple HTML pages prefer askweb_read (cheaper, faster).",
      "Steel and Cloudflare have stateless scrape (no session needed). Kernel requires a session.",
      "Pass waitFor to wait for a CSS selector before extraction.",
    ],
    parameters: scrapeParameters,
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("brobo_scrape"))} ${theme.fg("dim", args.url)} ${theme.fg("muted", `provider=${args.provider ?? "auto"}`)}`,
        0, 0,
      )
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<{ url: string; provider: string; content: string }>> {
      const providerName = resolveProvider(params.provider)

      if (providerName === "playwright") {
        const provider = await getBroboProvider("playwright")
        const result = await provider.scrape(params.url, { waitFor: params.waitFor })
        const content = result.text || result.markdown || result.html || "No content extracted"
        return {
          content: [{ type: "text", text: `[provider=playwright] ${params.url}\n\n${content}` }],
          details: { url: params.url, provider: "playwright", content },
        }
      }

      const apiKey = getApiKey(providerName)
      const baseURL = getBaseURL(providerName)
      const headers = getHeaders(providerName, apiKey)

      if (providerName === "cloudflare") {
        const body: Record<string, unknown> = { url: params.url }
        if (params.waitFor) body.waitForSelector = params.waitFor
        const res = await fetch(`${baseURL}/content`, { method: "POST", headers, body: JSON.stringify(body) })
        const data = await res.json() as Record<string, unknown>
        if (!data.success) {
          const errs = (data.errors as Array<{ message: string }> | undefined)?.map(e => e.message).join("; ") ?? "Unknown error"
          throw new Error(errs)
        }
        const result = data.result as Record<string, string>
        const content = result?.content || "No content extracted"
        return {
          content: [{ type: "text", text: `[provider=cloudflare] ${params.url}\n\n${content}` }],
          details: { url: params.url, provider: "cloudflare", content },
        }
      }

      if (providerName === "steel") {
        const body: Record<string, unknown> = { url: params.url }
        if (params.waitFor) body.waitFor = params.waitFor
        const res = await fetch(`${baseURL}/v1/scrape`, { method: "POST", headers, body: JSON.stringify(body) })
        const data = await res.json() as Record<string, unknown>
        const c = data.content as Record<string, string> | undefined
        const content = c?.markdown || c?.readability || c?.html || "No content extracted"
        return {
          content: [{ type: "text", text: `[provider=steel] ${params.url}\n\n${content}` }],
          details: { url: params.url, provider: "steel", content },
        }
      }

      const body: Record<string, unknown> = { url: params.url }
      if (params.waitFor) body.waitFor = params.waitFor
      const res = await fetch(`${baseURL}/v1/scrape`, { method: "POST", headers, body: JSON.stringify(body) })
      const data = await res.json() as Record<string, unknown>
      const content = (data.markdown as string) || (data.text as string) || (data.html as string) || "No content extracted"
      return {
        content: [{ type: "text", text: `[provider=${providerName}] ${params.url}\n\n${content}` }],
        details: { url: params.url, provider: providerName, content },
      }
    },
  })

  pi.registerTool({
    name: "brobo_session",
    label: "Brobo Session",
    description: "Create a new cloud browser session. Returns session ID and CDP WebSocket URL for Puppeteer/Playwright connection.",
    promptSnippet: "Create a cloud browser session for full browser automation.",
    promptGuidelines: [
      "Use brobo_session when you need full browser control (navigate, click, type, evaluate JS).",
      "For simple scrape/screenshot, use brobo_scrape instead (no session needed).",
      "Always release sessions when done with brobo_release.",
    ],
    parameters: sessionParameters,
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("brobo_session"))} ${theme.fg("muted", `provider=${args.provider ?? "auto"} region=${args.region ?? "default"}`)}`,
        0, 0,
      )
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<{ session: Record<string, unknown> }>> {
      const providerName = resolveProvider(params.provider)

      if (providerName === "playwright") {
        const provider = await getBroboProvider("playwright")
        const session = await provider.createSession({ region: params.region })
        return {
          content: [{ type: "text", text: `[provider=playwright] Session created: ${session.id}` }],
          details: { session: { id: session.id, provider: session.provider, createdAt: session.createdAt } },
        }
      }

      const apiKey = getApiKey(providerName)
      const baseURL = getBaseURL(providerName)
      const headers = getHeaders(providerName, apiKey)

      const endpoints: Record<string, string> = {
        steel: "/v1/sessions",
        browserbase: "/v1/sessions",
        kernel: "/v1/browsers",
        browserless: `/sessions?token=${apiKey}`,
        hyperbrowser: "/v1/session",
        anchor: "/v1/sessions",
        cloudflare: "/devtools/browser",
      }

      const body: Record<string, unknown> = {}
      if (params.region) body.region = params.region

      const endpoint = endpoints[providerName]
      if (!endpoint) throw new Error(`Sessions not supported for provider: ${providerName}`)

      const res = await fetch(`${baseURL}${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) })
      const data = await res.json() as Record<string, unknown>

      const session = (data.result as Record<string, unknown>) ?? data
      const sessionId = (session.sessionId as string) ?? (session.id as string) ?? "unknown"
      const cdpUrl = (session.cdpUrl as string) ?? (session.connectUrl as string) ?? (session.websocketUrl as string)

      const lines = [`[provider=${providerName}] Session created: ${sessionId}`]
      if (cdpUrl) lines.push(`CDP URL: ${cdpUrl}`)

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { session: data },
      }
    },
  })

  pi.registerTool({
    name: "brobo_release",
    label: "Brobo Release",
    description: "Release/destroy a cloud browser session. Always release sessions when done to avoid billing.",
    promptSnippet: "Release a cloud browser session.",
    promptGuidelines: [
      "Always release sessions after use to avoid unnecessary billing.",
      "Use the same provider that created the session.",
    ],
    parameters: releaseParameters,
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("brobo_release"))} ${theme.fg("dim", args.sessionId)}`,
        0, 0,
      )
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<{ released: boolean }>> {
      const providerName = resolveProvider(params.provider)

      if (providerName === "playwright") {
        const provider = await getBroboProvider("playwright")
        await provider.releaseSession(params.sessionId)
        return {
          content: [{ type: "text", text: `[provider=playwright] Session ${params.sessionId} released.` }],
          details: { released: true },
        }
      }

      const apiKey = getApiKey(providerName)
      const baseURL = getBaseURL(providerName)
      const headers = getHeaders(providerName, apiKey)

      const endpoints: Record<string, string> = {
        steel: `/v1/sessions/${params.sessionId}/release`,
        browserbase: `/v1/sessions/${params.sessionId}`,
        kernel: `/v1/browsers/${params.sessionId}`,
        browserless: `/sessions/${params.sessionId}?token=${apiKey}`,
        hyperbrowser: `/v1/session/${params.sessionId}`,
        anchor: `/v1/sessions/${params.sessionId}`,
        cloudflare: `/devtools/browser/${params.sessionId}`,
      }

      const endpoint = endpoints[providerName]
      if (!endpoint) throw new Error(`Sessions not supported for provider: ${providerName}`)

      const method = providerName === "steel" ? "POST" : "DELETE"
      await fetch(`${baseURL}${endpoint}`, { method, headers })
      return {
        content: [{ type: "text", text: `[provider=${providerName}] Session ${params.sessionId} released.` }],
        details: { released: true },
      }
    },
  })

  pi.registerTool({
    name: "brobo_providers",
    label: "Brobo Providers",
    description: "Read-only/idempotent local/env status: list browser-as-a-service providers and which ones are currently configured via environment variables.",
    promptSnippet: "List configured brobo browser providers.",
    promptGuidelines: [
      "Use brobo_providers to check which browser providers have API keys configured.",
    ],
    parameters: emptyParameters,
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("brobo_providers")), 0, 0)
    },
    async execute(): Promise<AgentToolResult<{ providers: { name: string; configured: boolean; envKey: string; capabilities: Record<string, boolean> }[] }>> {
      const rows = builtinProviders.map(name => {
        const specials = specialEnvKeys[name]
        const envKey = specials ? specials[0] : `${name.toUpperCase()}_API_KEY`
        const caps = providerCapabilities[name]
        return { name, configured: hasKey(name), envKey, capabilities: caps }
      })
      const lines = rows.map(r => {
        const caps = r.capabilities
        const tags = [
          caps.statelessScrape ? 'scrape✓' : null,
          caps.statelessScreenshot ? 'screenshot✓' : null,
          caps.navigate ? 'navigate✓' : null,
          caps.evaluate ? 'evaluate✓' : null,
          caps.sessions ? 'sessions✓' : null,
          caps.cdp ? 'cdp✓' : null,
          caps.crawl ? 'crawl' : null,
          caps.pdf ? 'pdf' : null,
          caps.links ? 'links' : null,
          caps.search ? 'search' : null,
          caps.extract ? 'extract' : null,
        ].filter(Boolean).join(' ')
        return `${r.configured ? '●' : '○'} ${r.name} ${r.configured ? '' : `(${r.envKey})`}  ${tags}`
      })
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { providers: rows },
      }
    },
  })

  pi.registerTool({
    name: "brobo_screenshot",
    label: "Brobo Screenshot",
    description: "Take a screenshot of a URL using a cloud browser provider. Stateless mode (no session needed): cloudflare, browserless. Session-based: steel, browserbase, kernel, hyperbrowser, anchor. For providers without navigate support (browserbase, hyperbrowser, anchor, cloudflare), the screenshot captures the URL directly.",
    promptSnippet: "Take a screenshot of a URL with a cloud browser.",
    promptGuidelines: [
      "Use brobo_screenshot when the user needs a visual capture of a webpage.",
      "Cloudflare and Browserless work statelessly (no session needed).",
      "Other providers create a temporary session, navigate, screenshot, and release.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to screenshot" }),
      provider: Type.Optional(Type.String({ description: `Provider name. One of: ${builtinProviders.join(", ")}. Auto-detected from env.` })),
      format: Type.Optional(Type.String({ description: 'Image format: png, jpeg, webp. Default: png.' })),
      fullPage: Type.Optional(Type.Boolean({ description: 'Capture full page. Default: true.' })),
    }),
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("brobo_screenshot"))} ${theme.fg("dim", args.url)} ${theme.fg("muted", `provider=${args.provider ?? "auto"}`)}`,
        0, 0,
      )
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<{ url: string; provider: string; saved: boolean }>> {
      const providerName = resolveProvider(params.provider)

      if (providerName === "playwright") {
        const provider = await getBroboProvider("playwright")
        const session = await provider.createSession()
        try {
          const result = await provider.screenshot({ url: params.url, fullPage: params.fullPage, format: params.format as any }, session)
          return {
            content: [{ type: "text", text: `[provider=playwright] Screenshot of ${params.url}. Data length: ${result.data.length} chars.` }],
            details: { url: params.url, provider: "playwright", saved: false },
          }
        } finally {
          await provider.releaseSession(session.id)
        }
      }

      const apiKey = getApiKey(providerName)
      const baseURL = getBaseURL(providerName)
      const headers = getHeaders(providerName, apiKey)

      const stateless = ["cloudflare", "browserless"].includes(providerName)

      if (stateless) {
        const body: Record<string, unknown> = { url: params.url, fullPage: params.fullPage ?? true }
        if (params.format) body.type = params.format

        const endpoint = providerName === "cloudflare" ? "/screenshot" : "/screenshot"
        const res = await fetch(`${baseURL}${endpoint}${providerName === "browserless" ? `?token=${apiKey}` : ""}`, { method: "POST", headers, body: JSON.stringify(body) })
        const data = await res.json() as Record<string, unknown>
        let image: string | undefined
        if (providerName === "cloudflare") {
          const result = data.result as Record<string, string> | undefined
          image = result?.image
        } else {
          image = data.data as string
        }
        return {
          content: [{ type: "text", text: `[provider=${providerName}] Stateless screenshot of ${params.url}. Data length: ${image?.length ?? 0} chars.` }],
          details: { url: params.url, provider: providerName, saved: false },
        }
      }

      return {
        content: [{ type: "text", text: `[provider=${providerName}] Screenshot requires session creation. Use brobo_session + navigate + CDP for full control.` }],
        details: { url: params.url, provider: providerName, saved: false },
      }
    },
  })

  pi.registerTool({
    name: "brobo_extract",
    label: "Brobo Extract",
    description: "Extract structured data from a URL using AI. Cloudflare returns synchronous results. Hyperbrowser returns an async job ID.",
    promptSnippet: "Extract structured data from a URL with AI.",
    promptGuidelines: [
      "Use brobo_extract when the user needs structured data from a webpage (product info, pricing, articles).",
      "Cloudflare returns results synchronously. Hyperbrowser returns a jobId for async processing.",
      "Pass a prompt describing what to extract.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to extract data from" }),
      provider: Type.Optional(Type.String({ description: `Provider. One of: cloudflare, hyperbrowser.` })),
      prompt: Type.String({ description: "What to extract (e.g. 'Extract product name, price, and description')" }),
    }),
    renderCall(args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("brobo_extract"))} ${theme.fg("dim", args.url)} ${theme.fg("muted", `provider=${args.provider ?? "auto"}`)}`, 0, 0)
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<{ url: string; provider: string; data: unknown }>> {
      const providerName = resolveProvider(params.provider)
      const apiKey = getApiKey(providerName)
      const baseURL = getBaseURL(providerName)
      const headers = getHeaders(providerName, apiKey)

      if (providerName === "cloudflare") {
        const res = await fetch(`${baseURL}/json`, { method: "POST", headers, body: JSON.stringify({ url: params.url, prompt: params.prompt }) })
        const data = await res.json() as Record<string, unknown>
        const result = data.result ?? data
        return {
          content: [{ type: "text", text: `[provider=cloudflare] ${params.url}\n\n${JSON.stringify(result, null, 2)}` }],
          details: { url: params.url, provider: "cloudflare", data: result },
        }
      }

      if (providerName === "hyperbrowser") {
        const res = await fetch(`${baseURL}/api/extract`, { method: "POST", headers, body: JSON.stringify({ urls: [params.url], prompt: params.prompt }) })
        const data = await res.json() as Record<string, unknown>
        return {
          content: [{ type: "text", text: `[provider=hyperbrowser] Extract job submitted: ${data.jobId}` }],
          details: { url: params.url, provider: "hyperbrowser", data },
        }
      }

      throw new Error(`Provider ${providerName} does not support extract.`)
    },
  })

  pi.registerTool({
    name: "brobo_crawl",
    label: "Brobo Crawl",
    description: "Crawl a website following links. Cloudflare and Hyperbrowser support async crawl jobs. Returns pages with markdown/HTML content.",
    promptSnippet: "Crawl a website and extract content from multiple pages.",
    promptGuidelines: [
      "Use brobo_crawl when the user needs content from multiple pages of a website.",
      "Both cloudflare and hyperbrowser return async job IDs. Results may need polling.",
      "Pass maxPages to limit the crawl scope.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "Starting URL" }),
      provider: Type.Optional(Type.String({ description: `Provider. One of: cloudflare, hyperbrowser.` })),
      maxPages: Type.Optional(Type.Number({ description: "Max pages to crawl. Default: 10." })),
    }),
    renderCall(args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("brobo_crawl"))} ${theme.fg("dim", args.url)}`, 0, 0)
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<{ jobId?: string; pages: number }>> {
      const providerName = resolveProvider(params.provider)

      if (providerName === "playwright") {
        const provider = await getBroboProvider("playwright")
        const result = await provider.crawl(params.url, { maxPages: params.maxPages ?? 10 })
        return {
          content: [{ type: "text", text: `[provider=playwright] Crawled ${result.pages.length} pages.` }],
          details: { pages: result.pages.length },
        }
      }

      const apiKey = getApiKey(providerName)
      const baseURL = getBaseURL(providerName)
      const headers = getHeaders(providerName, apiKey)

      if (providerName === "cloudflare") {
        const res = await fetch(`${baseURL}/crawl`, { method: "POST", headers, body: JSON.stringify({ url: params.url, limit: params.maxPages ?? 10 }) })
        const data = await res.json() as Record<string, unknown>
        const jobId = data.result as string
        return { content: [{ type: "text", text: `[provider=cloudflare] Crawl job started: ${jobId}` }], details: { jobId, pages: 0 } }
      }

      if (providerName === "hyperbrowser") {
        const body = { url: params.url, outputs: { formats: ["markdown"] }, crawlOptions: { maxPages: params.maxPages ?? 10 } }
        const res = await fetch(`${baseURL}/api/web/crawl`, { method: "POST", headers, body: JSON.stringify(body) })
        const data = await res.json() as Record<string, unknown>
        return { content: [{ type: "text", text: `[provider=hyperbrowser] Crawl job started: ${data.jobId}` }], details: { jobId: data.jobId as string, pages: 0 } }
      }

      throw new Error(`Provider ${providerName} does not support crawl.`)
    },
  })

  pi.registerTool({
    name: "brobo_pdf",
    label: "Brobo PDF",
    description: "Generate a PDF from a URL. Cloudflare and Browserless support stateless PDF generation.",
    promptSnippet: "Generate a PDF from a URL.",
    promptGuidelines: [
      "Use brobo_pdf when the user needs a PDF of a webpage.",
      "Cloudflare and Browserless work statelessly (no session needed).",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to convert to PDF" }),
      provider: Type.Optional(Type.String({ description: `Provider. One of: cloudflare, browserless.` })),
    }),
    renderCall(args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("brobo_pdf"))} ${theme.fg("dim", args.url)}`, 0, 0)
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<{ url: string; provider: string; pdfLength: number }>> {
      const providerName = resolveProvider(params.provider)

      if (providerName === "playwright") {
        const provider = await getBroboProvider("playwright")
        const result = await provider.pdf(params.url)
        return {
          content: [{ type: "text", text: `[provider=playwright] PDF generated: ${result.data.length} chars.` }],
          details: { url: params.url, provider: "playwright", pdfLength: result.data.length },
        }
      }

      const apiKey = getApiKey(providerName)
      const baseURL = getBaseURL(providerName)
      const headers = getHeaders(providerName, apiKey)

      if (providerName === "cloudflare") {
        const res = await fetch(`${baseURL}/pdf`, { method: "POST", headers, body: JSON.stringify({ url: params.url }) })
        const buf = await res.arrayBuffer()
        return { content: [{ type: "text", text: `[provider=cloudflare] PDF generated: ${buf.byteLength} bytes` }], details: { url: params.url, provider: "cloudflare", pdfLength: buf.byteLength } }
      }

      if (providerName === "browserless") {
        const res = await fetch(`${baseURL}/pdf?token=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: params.url }) })
        const buf = await res.arrayBuffer()
        return { content: [{ type: "text", text: `[provider=browserless] PDF generated: ${buf.byteLength} bytes` }], details: { url: params.url, provider: "browserless", pdfLength: buf.byteLength } }
      }

      throw new Error(`Provider ${providerName} does not support PDF generation.`)
    },
  })

  pi.registerTool({
    name: "brobo_links",
    label: "Brobo Links",
    description: "Extract all links from a webpage. Cloudflare supports stateless link extraction.",
    promptSnippet: "Extract links from a webpage.",
    promptGuidelines: [
      "Use brobo_links when the user needs all links from a page.",
      "Only cloudflare supports this currently.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to extract links from" }),
      provider: Type.Optional(Type.String({ description: `Provider. One of: ${builtinProviders.join(", ")}.` })),
    }),
    renderCall(args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("brobo_links"))} ${theme.fg("dim", args.url)}`, 0, 0)
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<{ url: string; links: string[] }>> {
      const providerName = resolveProvider(params.provider)

      if (providerName === "playwright") {
        const provider = await getBroboProvider("playwright")
        const result = await provider.links(params.url)
        const links = result.links.map((l: { href: string }) => l.href)
        return {
          content: [{ type: "text", text: `[provider=playwright] ${links.length} links:\n${links.join("\n")}` }],
          details: { url: params.url, links },
        }
      }

      const apiKey = getApiKey("cloudflare")
      const baseURL = getBaseURL("cloudflare")
      const headers = getHeaders("cloudflare", apiKey)
      const res = await fetch(`${baseURL}/links`, { method: "POST", headers, body: JSON.stringify({ url: params.url }) })
      const data = await res.json() as Record<string, unknown>
      const links = (data.result ?? []) as string[]
      return { content: [{ type: "text", text: `[provider=cloudflare] ${links.length} links:\n${links.join("\n")}` }], details: { url: params.url, links } }
    },
  })

  pi.registerTool({
    name: "brobo_search",
    label: "Brobo Search",
    description: "Web search via browser provider. Hyperbrowser supports native web search.",
    promptSnippet: "Search the web via browser provider.",
    promptGuidelines: [
      "Use brobo_search when the user needs web search results.",
      "Hyperbrowser supports native web search.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),
    renderCall(args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("brobo_search"))} ${theme.fg("dim", args.query)}`, 0, 0)
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<{ results: Array<{ url: string; title: string; snippet: string }> }>> {
      const apiKey = getApiKey("hyperbrowser")
      const baseURL = getBaseURL("hyperbrowser")
      const headers = getHeaders("hyperbrowser", apiKey)
      const res = await fetch(`${baseURL}/api/web/search`, { method: "POST", headers, body: JSON.stringify({ query: params.query }) })
      const data = await res.json() as Record<string, unknown>
      const inner = data.data as Record<string, unknown> | undefined
      const results = (inner?.results ?? []) as Array<{ url: string; title: string; description: string }>
      const mapped = results.map(r => ({ url: r.url, title: r.title, snippet: r.description }))
      const lines = mapped.map(r => `${r.title}\n  ${r.url}\n  ${r.snippet}`)
      return { content: [{ type: "text", text: `[provider=hyperbrowser] ${mapped.length} results:\n\n${lines.join("\n\n")}` }], details: { results: mapped } }
    },
  })

  pi.registerTool({
    name: "brobo_capabilities",
    label: "Brobo Capabilities",
    description: "Read-only: check what operations a specific browser provider supports (scrape, screenshot, navigate, evaluate, sessions, CDP, stateless modes).",
    promptSnippet: "Check capabilities of a browser provider before using it.",
    promptGuidelines: [
      "Use brobo_capabilities before brobo_scrape/brobo_screenshot to check if the provider supports the operation.",
      "Some providers support stateless operations (no session needed): cloudflare, browserless for both scrape and screenshot.",
      "Some providers only support CDP (no REST navigate/evaluate): browserbase, hyperbrowser, anchor.",
    ],
    parameters: Type.Object({
      provider: Type.String({ description: "Provider name to check" }),
    }),
    renderCall(args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("brobo_capabilities"))} ${theme.fg("dim", args.provider)}`, 0, 0)
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<{ provider: string; capabilities: Record<string, boolean> }>> {
      const name = params.provider
      const caps = providerCapabilities[name]
      if (!caps) throw new Error(`Unknown provider: ${name}. Available: ${builtinProviders.join(", ")}.`)
      const lines = Object.entries(caps).map(([k, v]) => `  ${k}: ${v ? "✓" : "✗"}`)
      return {
        content: [{ type: "text", text: `[${name}]\n${lines.join("\n")}` }],
        details: { provider: name, capabilities: caps },
      }
    },
  })
}
