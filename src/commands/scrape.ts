import { defineCommand } from 'citty'
import { consola } from 'consola'
import { resolveAndCreate } from './_helpers'

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
      description: 'Browser provider name (default: first with API key set)',
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
    const { name: providerName, provider } = resolveAndCreate(args.provider)
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
