import { defineCommand } from 'citty'
import { consola } from 'consola'
import { create } from '../core/registry'
import { resolveProvider } from '../core/resolve'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineCommand({
  meta: {
    name: 'screenshot',
    description: 'Take a screenshot of a URL using a browser provider',
  },
  args: {
    url: {
      type: 'positional',
      description: 'URL to screenshot',
      required: true,
    },
    provider: {
      type: 'string',
      alias: 'p',
      description: 'Browser provider name (default: first with API key set)',
    },
    output: {
      type: 'string',
      alias: 'o',
      description: 'Output file path (default: screenshot.png)',
      default: 'screenshot.png',
    },
    format: {
      type: 'string',
      alias: 'f',
      description: 'Image format: png, jpeg, webp',
      default: 'png',
    },
    fullPage: {
      type: 'boolean',
      description: 'Capture full page (default: true)',
      default: true,
    },
    width: {
      type: 'string',
      description: 'Viewport width in pixels',
    },
    height: {
      type: 'string',
      description: 'Viewport height in pixels',
    },
  },
  async run({ args }) {
    const providerName = resolveProvider(args.provider)
    const provider = create(providerName)
    consola.info(`Creating session via ${providerName}...`)

    try {
      const session = await provider.createSession({
        viewport: args.width && args.height
          ? { width: Number(args.width), height: Number(args.height) }
          : undefined,
      })
      consola.info(`Session ${session.id}`)

      await provider.navigate(args.url, session)
      consola.info(`Navigated to ${args.url}`)

      const result = await provider.screenshot({
        format: args.format as 'png' | 'jpeg' | 'webp',
        fullPage: args.fullPage,
      }, session)

      const outputPath = resolve(args.output)
      const base64Data = result.data.replace(/^data:image\/\w+;base64,/, '')
      writeFileSync(outputPath, Buffer.from(base64Data, 'base64'))
      consola.success(`Screenshot saved to ${outputPath}`)

      await provider.releaseSession(session.id)
    }
    catch (error) {
      consola.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
  },
})
