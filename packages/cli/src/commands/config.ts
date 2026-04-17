import { Command } from 'commander'
import { getConfigPath, getConfigValue, setConfigValue, loadConfig } from '../lib/config.js'
import { output } from '../lib/output.js'
import { handleError } from '../lib/errors.js'
import type { GlobalOpts } from '../cli.js'

export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description('Manage CLI configuration')

  config
    .command('set')
    .description('Set a config value')
    .argument('<key>', 'Config key (api-key, api-url, default-project)')
    .argument('<value>', 'Config value')
    .action((key: string, value: string) => {
      const opts = program.opts() as GlobalOpts
      try {
        setConfigValue(key, value)
        if (!opts.json) {
          console.log(`Set ${key} successfully.`)
          if (key === 'api-key') {
            console.log(`Key prefix: ${value.slice(0, 8)}...`)
          }
        } else {
          output({ success: true, key, set: key === 'api-key' ? `${value.slice(0, 8)}...` : value }, true)
        }
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  config
    .command('get')
    .description('Get a config value')
    .argument('<key>', 'Config key (api-key, api-url, default-project)')
    .action((key: string) => {
      const opts = program.opts() as GlobalOpts
      const value = getConfigValue(key)
      if (opts.json) {
        output({ key, value: value ?? null }, true)
      } else if (value) {
        // Mask API key
        if (key === 'api-key') {
          console.log(`${value.slice(0, 8)}...${'*'.repeat(8)}`)
        } else {
          console.log(value)
        }
      } else {
        console.log(`(not set)`)
      }
    })

  config
    .command('list')
    .description('Show all config values')
    .action(() => {
      const opts = program.opts() as GlobalOpts
      const cfg = loadConfig()
      if (opts.json) {
        output({
          apiKey: cfg.apiKey ? `${cfg.apiKey.slice(0, 8)}...` : null,
          apiUrl: cfg.apiUrl ?? null,
          defaultProject: cfg.defaultProject ?? null,
        }, true)
      } else {
        console.log(`  api-key:         ${cfg.apiKey ? `${cfg.apiKey.slice(0, 8)}...${'*'.repeat(8)}` : '(not set)'}`)
        console.log(`  api-url:         ${cfg.apiUrl ?? '(default: https://api.bobbinry.com)'}`)
        console.log(`  default-project: ${cfg.defaultProject ?? '(not set)'}`)
      }
    })

  config
    .command('path')
    .description('Print the config file path')
    .action(() => {
      const opts = program.opts() as GlobalOpts
      const p = getConfigPath()
      if (opts.json) {
        output({ path: p }, true)
      } else {
        console.log(p)
      }
    })
}
