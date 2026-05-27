import { defineTool, defineExtension, type ToolContext } from '@earendil-works/pi-coding-agent'

const builtinProviders = ['steel', 'browserbase', 'kernel', 'browserless', 'hyperbrowser', 'anchor', 'cloudflare'] as const

const specialEnvKeys: Record<string, string[]> = {
  cloudflare: ['CF_API_TOKEN', 'CLOUDFLARE_API_TOKEN'],
}

function hasKey(provider: string): boolean {
  const specials = specialEnvKeys[provider]
  if (specials) return specials.some(k => !!process.env[k])
  return !!process.env[`${provider.toUpperCase()}_API_KEY`]
}

function resolveProvider(preferred?: string): string {
  if (preferred && builtinProviders.includes(preferred as typeof builtinProviders[number])) return preferred
  for (const name of builtinProviders) {
    if (hasKey(name)) return name
  }
  throw new Error('No browser provider configured. Set an API key (e.g. STEEL_API_KEY, CF_API_TOKEN).')
}

function getHeaders(provider: string, apiKey: string): Record<string, string> {
  switch (provider) {
    case 'steel': return { 'steel-api-key': apiKey, 'Content-Type': 'application/json' }
    case 'browserbase': return { 'X-BB-API-Key': apiKey, 'Content-Type': 'application/json' }
    case 'kernel': return { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    case 'browserless': return { 'Content-Type': 'application/json' }
    case 'hyperbrowser': return { 'x-api-key': apiKey, 'Content-Type': 'application/json' }
    case 'anchor': return { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    case 'cloudflare': return { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    default: return { 'Content-Type': 'application/json' }
  }
}

function getBaseURL(provider: string): string {
  switch (provider) {
    case 'steel': return 'https://api.steel.dev'
    case 'browserbase': return 'https://api.browserbase.com'
    case 'kernel': return 'https://api.kernel.sh'
    case 'browserless': return 'https://chrome.browserless.io'
    case 'hyperbrowser': return 'https://app.hyperbrowser.ai/api'
    case 'anchor': return 'https://api.anchorbrowser.io'
    case 'cloudflare': return `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering`
    default: throw new Error(`Unknown provider: ${provider}`)
  }
}

function getApiKey(provider: string): string {
  if (provider === 'cloudflare') {
    const key = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN
    if (!key) throw new Error('Missing CF_API_TOKEN (or CLOUDFLARE_API_TOKEN)')
    if (!process.env.CF_ACCOUNT_ID && !process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Missing CF_ACCOUNT_ID (or CLOUDFLARE_ACCOUNT_ID)')
    return key
  }
  const key = process.env[`${provider.toUpperCase()}_API_KEY`]
  if (!key) throw new Error(`Missing API key for ${provider}. Set ${provider.toUpperCase()}_API_KEY`)
  return key
}

const scrapeTool = defineTool({
  name: 'brobo_scrape',
  description: 'Scrape content from a URL using a cloud browser provider. Providers: steel, browserbase, kernel, browserless, hyperbrowser, anchor, cloudflare. Returns markdown/text/html. Use for JS-heavy SPAs or bot-protected sites.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to scrape' },
      provider: { type: 'string', description: 'Provider name (auto-detected from env)' },
      waitFor: { type: 'string', description: 'CSS selector to wait for before extraction' },
    },
    required: ['url'],
  },
  async execute(params: { url: string; provider?: string; waitFor?: string }, ctx: ToolContext) {
    const providerName = resolveProvider(params.provider)
    const apiKey = getApiKey(providerName)
    const baseURL = getBaseURL(providerName)
    const headers = getHeaders(providerName, apiKey)

    if (providerName === 'cloudflare') {
      const body: Record<string, unknown> = { url: params.url }
      if (params.waitFor) body.waitForSelector = params.waitFor
      const res = await ctx.fetch(`${baseURL}/content`, { method: 'POST', headers, body: JSON.stringify(body) })
      const data = await res.json() as Record<string, unknown>
      const result = data.result as Record<string, string> | undefined
      return result?.content || 'No content extracted'
    }

    if (providerName === 'steel') {
      const body: Record<string, unknown> = { url: params.url }
      if (params.waitFor) body.waitFor = params.waitFor
      const res = await ctx.fetch(`${baseURL}/v1/scrape`, { method: 'POST', headers, body: JSON.stringify(body) })
      const data = await res.json() as Record<string, unknown>
      const content = data.content as Record<string, string> | undefined
      return content?.markdown || content?.readability || content?.html || 'No content extracted'
    }

    const body: Record<string, unknown> = { url: params.url }
    if (params.waitFor) body.waitFor = params.waitFor
    const res = await ctx.fetch(`${baseURL}/v1/scrape`, { method: 'POST', headers, body: JSON.stringify(body) })
    const data = await res.json() as Record<string, unknown>
    return (data.markdown as string) || (data.text as string) || (data.html as string) || 'No content extracted'
  },
})

const sessionTool = defineTool({
  name: 'brobo_session',
  description: 'Create a new cloud browser session. Returns session ID and CDP WebSocket URL for Puppeteer/Playwright.',
  parameters: {
    type: 'object',
    properties: {
      provider: { type: 'string', description: 'Provider name (auto-detected from env)' },
      region: { type: 'string', description: 'Preferred region (e.g. us-east-1)' },
    },
  },
  async execute(params: { provider?: string; region?: string }, ctx: ToolContext) {
    const providerName = resolveProvider(params.provider)
    const apiKey = getApiKey(providerName)
    const baseURL = getBaseURL(providerName)
    const headers = getHeaders(providerName, apiKey)

    const endpoints: Record<string, string> = {
      steel: '/v1/sessions',
      browserbase: '/v1/sessions',
      kernel: '/v1/browsers',
      browserless: `/sessions?token=${apiKey}`,
      hyperbrowser: '/v1/session',
      anchor: '/v1/sessions',
      cloudflare: '/devtools/browser',
    }

    const body: Record<string, unknown> = {}
    if (params.region) body.region = params.region

    const res = await ctx.fetch(`${baseURL}${endpoints[providerName]}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const data = await res.json() as Record<string, unknown>
    return JSON.stringify(data, null, 2)
  },
})

export default defineExtension({
  name: 'brobo',
  description: 'Unified browser-as-a-service for agents. Providers: steel, browserbase, kernel, browserless, hyperbrowser, anchor, cloudflare.',
  tools: [scrapeTool, sessionTool],
})
