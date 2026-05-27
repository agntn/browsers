import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Text } from "@earendil-works/pi-tui"
import { Type } from "typebox"

const builtinProviders = ["steel", "browserbase", "kernel", "browserless", "hyperbrowser", "anchor", "cloudflare"] as const

const specialEnvKeys: Record<string, string[]> = {
  cloudflare: ["CF_API_TOKEN", "CLOUDFLARE_API_TOKEN"],
}

function hasKey(provider: string): boolean {
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
  const key = process.env[`${provider.toUpperCase()}_API_KEY`]
  if (!key) throw new Error(`Missing API key for ${provider}. Set ${provider.toUpperCase()}_API_KEY`)
  return key
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

export default function broboExtension(pi: ExtensionAPI) {

  pi.registerTool({
    name: "brobo_scrape",
    label: "Brobo Scrape",
    description: "Read-only/open-world network fetch: scrape content from a URL using a cloud browser provider (Steel, Browserbase, Kernel, Browserless, Hyperbrowser, Anchor, Cloudflare). Returns rendered HTML/markdown/text after JavaScript execution. Use when a URL needs a real browser to render (JS-heavy SPAs, sites with bot protection, dynamic content).",
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
    async execute(): Promise<AgentToolResult<{ providers: { name: string; configured: boolean; envKey: string }[] }>> {
      const rows = builtinProviders.map(name => {
        const specials = specialEnvKeys[name]
        const envKey = specials ? specials[0] : `${name.toUpperCase()}_API_KEY`
        return { name, configured: hasKey(name), envKey }
      })
      const lines = rows.map(r => `${r.configured ? "●" : "○"} ${r.name} ${r.configured ? "" : `(${r.envKey})`}`)
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { providers: rows },
      }
    },
  })
}
