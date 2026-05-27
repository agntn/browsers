#!/usr/bin/env node

import { defineCommand, runMain } from 'citty'
import './providers/index'
import { normalizeMainArgs } from './cli-args'
import { version } from './version'

const main = defineCommand({
  meta: {
    name: 'brobo',
    version,
    description: 'Unified browser-as-a-service provider for agents and CLI',
  },
  subCommands: {
    scrape: () => import('./commands/scrape').then(m => m.default),
    screenshot: () => import('./commands/screenshot').then(m => m.default),
    session: () => import('./commands/session').then(m => m.default),
    providers: () => import('./commands/providers').then(m => m.default),
  },
})

await runMain(main, { rawArgs: normalizeMainArgs(process.argv.slice(2)) })
