import { defineCommand } from 'citty'
import { consola } from 'consola'
import { create } from '../core/registry'
import { resolveProvider } from '../core/resolve'

export default defineCommand({
  meta: {
    name: 'search',
    description: 'Web search via browser provider',
  },
  args: {
    query: {
      type: 'positional',
      description: 'Search query',
      required: true,
    },
    provider: {
      type: 'string',
      alias: 'p',
      description: 'Provider (hyperbrowser)',
    },
    maxResults: {
      type: 'string',
      alias: 'n',
      description: 'Max results (default: 10)',
    },
  },
  async run({ args }) {
    const providerName = resolveProvider(args.provider)
    const provider = create(providerName)
    if (!provider.search) {
      consola.error(`Provider ${providerName} does not support web search.`)
      process.exit(1)
    }
    try {
      const results = await provider.search(args.query, {
        maxResults: args.maxResults ? Number(args.maxResults) : 10,
      })
      for (const r of results) {
        console.log(`\n${r.title}\n  ${r.url}`)
        if (r.snippet) console.log(`  ${r.snippet}`)
      }
    }
    catch (error) {
      consola.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})
