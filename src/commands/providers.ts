import { defineCommand } from 'citty'
import { providers as listProviders } from '../core/registry'

const caps: Record<string, { scrape: boolean; screenshot: boolean; navigate: boolean; evaluate: boolean; sessions: boolean; cdp: boolean; statelessScrape: boolean; statelessScreenshot: boolean; crawl: boolean; pdf: boolean; links: boolean; search: boolean; extract: boolean }> = {
  steel:        { scrape: true, screenshot: true, navigate: false, evaluate: false, sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: false, crawl: false, pdf: false, links: false, search: false, extract: false },
  browserbase:  { scrape: true, screenshot: true, navigate: false, evaluate: false, sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: false, crawl: false, pdf: false, links: false, search: false, extract: false },
  kernel:       { scrape: true, screenshot: true, navigate: true,  evaluate: true,  sessions: true,  cdp: true,  statelessScrape: false, statelessScreenshot: false, crawl: false, pdf: false, links: false, search: false, extract: false },
  browserless:  { scrape: true, screenshot: true, navigate: true,  evaluate: true,  sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: true,  crawl: false, pdf: true,  links: false, search: false, extract: false },
  hyperbrowser: { scrape: true, screenshot: true, navigate: false, evaluate: false, sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: false, crawl: true,  pdf: false, links: false, search: true,  extract: true },
  anchor:       { scrape: false, screenshot: true, navigate: false, evaluate: false, sessions: true,  cdp: true,  statelessScrape: false, statelessScreenshot: false, crawl: false, pdf: false, links: false, search: false, extract: false },
  cloudflare:   { scrape: true, screenshot: true, navigate: false, evaluate: false, sessions: true,  cdp: true,  statelessScrape: true,  statelessScreenshot: true,  crawl: true,  pdf: true,  links: true,  search: false, extract: true },
  playwright:   { scrape: true, screenshot: true, navigate: true,  evaluate: true,  sessions: true,  cdp: false, statelessScrape: true,  statelessScreenshot: false, crawl: true,  pdf: true,  links: true,  search: false, extract: false },
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
      const hasKey = name === 'playwright'
        ? true
        : envKeys[name]
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
        c?.crawl ? 'crawl' : null,
        c?.pdf ? 'pdf' : null,
        c?.links ? 'links' : null,
        c?.search ? 'search' : null,
        c?.extract ? 'extract' : null,
      ].filter(Boolean).join(' ')

      console.log(`${hasKey ? '●' : '○'} ${name.padEnd(14)} ${hasKey ? '' : `(${(envKeys[name]?.[0] ?? `${name.toUpperCase()}_API_KEY`).padEnd(25)})`}  ${tags}`)
    }
  },
})
