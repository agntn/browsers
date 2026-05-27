import { defineCommand } from 'citty'
import { consola } from 'consola'
import { create, providers as listProviders } from '../core/registry'

export default defineCommand({
  meta: {
    name: 'scrape',
    description: 'Scrape content from a URL using a browser provider',
  },
  args: {
    url: {
      type: 'positional',
      description: 'URL to scrape',
      required: true,
    },
    provider: {
      type: 'string',
      alias: 'p',
      description: 'Browser provider name (default: first available)',
    },
    format: {
      type: 'string',
      alias: 'f',
      description: 'Output format: markdown, text, html',
      default: 'markdown',
    },
    waitFor: {
      type: 'string',
      description: 'CSS selector to wait for before extraction',
    },
    maxChars: {
      type: 'string',
      description: 'Maximum content length in characters',
    },
  },
  async run({ args }) {
    const available = listProviders()
    const providerName = args.provider || available[0]
    if (!providerName) {
      consola.error('No providers available. Set an API key (e.g. STEEL_API_KEY).')
      process.exit(1)
    }

    const provider = create(providerName)
    consola.info(`Scraping via ${providerName}...`)

    try {
      const result = await provider.scrape(args.url, {
        waitFor: args.waitFor,
        maxChars: args.maxChars ? Number(args.maxChars) : undefined,
      })

      switch (args.format) {
        case 'html':
          console.log(result.html ?? '')
          break
        case 'text':
          console.log(result.text ?? '')
          break
        default:
          console.log(result.markdown ?? result.text ?? result.html ?? '')
      }
    }
    catch (error) {
      consola.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})
