import { defineCommand } from 'citty'
import { providers as listProviders } from '../core/registry'

export default defineCommand({
  meta: {
    name: 'providers',
    description: 'List available browser providers',
  },
  args: {
    check: {
      type: 'boolean',
      alias: 'c',
      description: 'Check provider availability',
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
    }
    else {
      for (const name of all) {
        const hasKey = !!process.env[`${name.toUpperCase()}_API_KEY`]
        console.log(`${hasKey ? '●' : '○'} ${name}${hasKey ? '' : ' (no API key)'}`)
      }
    }
  },
})
