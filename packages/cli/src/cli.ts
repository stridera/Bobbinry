#!/usr/bin/env node
import { Command } from 'commander'
import { resolveApiKey, resolveApiUrl } from './lib/config.js'
import { BobbinryClient } from './api/client.js'
import { handleError } from './lib/errors.js'
import { registerConfigCommand } from './commands/config.js'
import { registerProjectsCommand } from './commands/projects.js'
import { registerEntitiesCommand } from './commands/entities.js'
import { registerStatsCommand } from './commands/stats.js'
import { registerWhoamiCommand } from './commands/whoami.js'
import { registerDiscoverCommand } from './commands/discover.js'
import { registerReadCommand } from './commands/read.js'
import { registerExportCommand } from './commands/export.js'

const program = new Command()

program
  .name('bobbinry')
  .description('CLI for the Bobbinry writing platform')
  .version('0.1.1')
  .option('--json', 'Output raw JSON (for scripts and AI agents)')
  .option('--api-url <url>', 'Override API base URL')
  .option('--api-key <key>', 'Override API key')
  .option('--verbose', 'Show request/response details')
  .option('--no-color', 'Disable colored output')

export interface GlobalOpts {
  json?: boolean
  apiUrl?: string
  apiKey?: string
  verbose?: boolean
}

export function getGlobalOpts(): GlobalOpts {
  return program.opts() as GlobalOpts
}

export function createClient(opts?: GlobalOpts): BobbinryClient {
  const g = opts || getGlobalOpts()
  return new BobbinryClient({
    apiKey: resolveApiKey(g.apiKey),
    apiUrl: resolveApiUrl(g.apiUrl),
    verbose: g.verbose,
  })
}

// Register commands
registerConfigCommand(program)
registerProjectsCommand(program)
registerEntitiesCommand(program)
registerStatsCommand(program)
registerWhoamiCommand(program)
registerDiscoverCommand(program)
registerReadCommand(program)
registerExportCommand(program)

// Welcome message when invoked with no arguments and no config
program.action(() => {
  const opts = getGlobalOpts()
  const apiKey = resolveApiKey(opts.apiKey)

  if (!apiKey) {
    console.log(`
  Welcome to Bobbinry CLI!

  Get started:
    1. Create an API key at https://bobbinry.com/settings/api-keys
    2. Configure it:  bobbinry config set api-key bby_your_key_here

  Then try:
    bobbinry projects          List your projects
    bobbinry stats             Dashboard stats
    bobbinry discover          Browse published projects

  Run bobbinry --help for all commands.
`)
  } else {
    program.help()
  }
})

program.parseAsync(process.argv).catch(err => handleError(err, !!getGlobalOpts().json))
