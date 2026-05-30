import { defineCommand } from 'citty'
import { providers as listProviders, create } from '../core/registry'
import { _hasKey, providerEnvKey } from '../core/resolve'

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

    for (const name of all) {
      const hasKey = _hasKey(name)
      const envKey = providerEnvKey(name)

      let tags = ''
      try {
        const provider = create(name)
        const c = provider.capabilities()
        tags = [
          c.statelessScrape ? 'scrape' : (c.scrape ? 'scrape(sess)' : null),
          c.statelessScreenshot ? 'screenshot' : (c.screenshot ? 'screenshot(sess)' : null),
          c.navigate ? 'navigate' : null,
          c.evaluate ? 'evaluate' : null,
          c.sessions ? 'sessions' : null,
          c.cdp ? 'cdp' : null,
          c.crawl ? 'crawl' : null,
          c.pdf ? 'pdf' : null,
          c.links ? 'links' : null,
          c.search ? 'search' : null,
          c.extract ? 'extract' : null,
        ].filter(Boolean).join(' ')
      }
      catch {
        tags = '(cannot instantiate)'
      }

      console.log(`${hasKey ? '●' : '○'} ${name.padEnd(14)} ${hasKey ? '' : `(${envKey})`.padEnd(27)} ${tags}`)
    }
  },
})
