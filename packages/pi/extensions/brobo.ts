import { defineTool, defineExtension, type ToolContext } from '@earendil-works/pi-coding-agent'

const builtinProviders = ['steel', 'browserbase', 'kernel', 'browserless', 'hyperbrowser', 'anchor'] as const

function resolveProvider(preferred?: string): string {
  if (preferred && builtinProviders.includes(preferred as typeof builtinProviders[number])) return preferred
  for (const name of builtinProviders) {
    if (process.env[`${name.toUpperCase()}_API_KEY`]) return name
  }
  throw new Error('No browser provider configured. Set an API key (e.g. STEEL_API_KEY, BROWSERBASE_API_KEY, KERNEL_API_KEY).')
}

function getHeaders(provider: string, apiKey: string): Record<string, string> {
  switch (provider) {
    case 'steel': return { 'steel-api-key': apiKey, 'Content-Type': 'application/json' }
    case 'browserbase': return { 'X-BB-API-Key': apiKey, 'Content-Type': 'application/json' }
    case 'kernel': return { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    case 'browserless': return { 'Content-Type': 'application/json' }
    case 'hyperbrowser': return { 'x-api-key': apiKey, 'Content-Type': 'application/json' }
    case 'anchor': return { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
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
    default: throw new Error(`Unknown provider: ${provider}`)
  }
}

function getApiKey(provider: string): string {
  const key = process.env[`${provider.toUpperCase()}_API_KEY`]
  if (!key) throw new Error(`Missing API key for ${provider}. Set ${provider.toUpperCase()}_API_KEY`)
  return key
}

const scrapeTool = defineTool({
  name: 'brobo_scrape',
  description: 'Scrape content from a URL using a cloud browser provider (Steel, Browserbase, Kernel, Browserless, Hyperbrowser, Anchor). Returns markdown/text/html content. Use when a URL needs a real browser to render (JS-heavy SPAs, sites with bot protection).',
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
  description: 'Create a new cloud browser session. Returns session ID and CDP WebSocket URL for Puppeteer/Playwright connection.',
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
  description: 'Unified browser-as-a-service for agents. Providers: Steel, Browserbase, Kernel, Browserless, Hyperbrowser, Anchor.',
  tools: [scrapeTool, sessionTool],
})
