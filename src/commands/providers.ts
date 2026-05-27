import { defineCommand } from 'citty'
import { providers as listProviders } from '../core/registry'

const caps: Record<string, { scrape: boolean; screenshot: boolean; navigate: boolean; evaluate: boolean; sessions: boolean; cdp: boolean; statelessScrape: boolean; statelessScreenshot: boolean }> = {
  steel:        { scrape: true, screenshot: true, navigate: true,  evaluate: true,  sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: false },
  browserbase:  { scrape: true, screenshot: true, navigate: false, evaluate: false, sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: false },
  kernel:       { scrape: true, screenshot: true, navigate: true,  evaluate: true,  sessions: true,  cdp: true,  statelessScrape: false, statelessScreenshot: false },
  browserless:  { scrape: true, screenshot: true, navigate: true,  evaluate: true,  sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: true  },
  hyperbrowser: { scrape: true, screenshot: true, navigate: false, evaluate: false, sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: false },
  anchor:       { scrape: true, screenshot: true, navigate: false, evaluate: false, sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: false },
  cloudflare:   { scrape: true, screenshot: true, navigate: false, evaluate: false, sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: true  },
}

export default defineCommand({
  meta: {
    name: 'providers',
    description: 'List available browser providers with capabilities',
  },
  args: {
    check: {
      type: 'boolean',
      alias: 'c',
      description: 'Check provider availability (requires API keys)',
      default: false,
    },
  },
  async run({ args }) {
    const all = listProviders()

    if (args.check) {
      const { create } = await import('../core/registry')
      for (const name of all) {
        try {
          const provider = create(name)
          const available = provider.isAvailable ? await provider.isAvailable() : true
          console.log(`${available ? '✓' : '✗'} ${name}`)
        }
        catch {
          console.log(`✗ ${name} (not configured)`)
        }
      }
      return
    }

    const envKeys: Record<string, string[]> = {
      cloudflare: ['CF_API_TOKEN', 'CLOUDFLARE_API_TOKEN'],
    }

    for (const name of all) {
      const hasKey = envKeys[name]
        ? envKeys[name].some(k => !!process.env[k])
        : !!process.env[`${name.toUpperCase()}_API_KEY`]
      const c = caps[name]
      const tags = [
        c?.scrape ? 'scrape' : null,
        c?.screenshot ? 'screenshot' : null,
        c?.navigate ? 'navigate' : null,
        c?.evaluate ? 'evaluate' : null,
        c?.sessions ? 'sessions' : null,
        c?.cdp ? 'cdp' : null,
        c?.statelessScrape ? '(stateless)' : null,
        c?.statelessScreenshot ? '(stateless-shot)' : null,
      ].filter(Boolean).join(' ')

      console.log(`${hasKey ? '●' : '○'} ${name.padEnd(14)} ${hasKey ? '' : `(${(envKeys[name]?.[0] ?? `${name.toUpperCase()}_API_KEY`).padEnd(25)})`}  ${tags}`)
    }
  },
})
