import { defineCommand } from 'citty'
import { consola } from 'consola'
import { create, providers as listProviders } from '../core/registry'

export default defineCommand({
  meta: {
    name: 'session',
    description: 'Manage browser sessions',
  },
  subCommands: {
    create: defineCommand({
      meta: { name: 'create', description: 'Create a new browser session' },
      args: {
        provider: {
          type: 'string',
          alias: 'p',
          description: 'Browser provider name',
        },
        region: {
          type: 'string',
          alias: 'r',
          description: 'Preferred region',
        },
      },
      async run({ args }) {
        const available = listProviders()
        const providerName = args.provider || available[0]
        if (!providerName) {
          consola.error('No providers available.')
          process.exit(1)
        }
        const provider = create(providerName)
        try {
          const session = await provider.createSession({ region: args.region })
          consola.success(`Session created: ${session.id}`)
          if (session.cdpUrl) consola.info(`CDP URL: ${session.cdpUrl}`)
          console.log(JSON.stringify(session, null, 2))
        }
        catch (error) {
          consola.error(error instanceof Error ? error.message : String(error))
          process.exit(1)
        }
      },
    }),
    release: defineCommand({
      meta: { name: 'release', description: 'Release a browser session' },
      args: {
        sessionId: {
          type: 'positional',
          description: 'Session ID to release',
          required: true,
        },
        provider: {
          type: 'string',
          alias: 'p',
          description: 'Browser provider name',
        },
      },
      async run({ args }) {
        const available = listProviders()
        const providerName = args.provider || available[0]
        if (!providerName) {
          consola.error('No providers available.')
          process.exit(1)
        }
        const provider = create(providerName)
        try {
          await provider.releaseSession(args.sessionId)
          consola.success(`Session ${args.sessionId} released.`)
        }
        catch (error) {
          consola.error(error instanceof Error ? error.message : String(error))
          process.exit(1)
        }
      },
    }),
    list: defineCommand({
      meta: { name: 'list', description: 'List active sessions' },
      args: {
        provider: {
          type: 'string',
          alias: 'p',
          description: 'Browser provider name',
        },
      },
      async run({ args }) {
        const available = listProviders()
        const providerName = args.provider || available[0]
        if (!providerName) {
          consola.error('No providers available.')
          process.exit(1)
        }
        const provider = create(providerName)
        try {
          const sessions = await provider.listSessions()
          if (sessions.length === 0) {
            consola.info('No active sessions.')
            return
          }
          console.log(JSON.stringify(sessions, null, 2))
        }
        catch (error) {
          consola.error(error instanceof Error ? error.message : String(error))
          process.exit(1)
        }
      },
    }),
  },
})
