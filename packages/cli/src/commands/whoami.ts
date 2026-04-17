import { Command } from 'commander'
import { createClient, getGlobalOpts } from '../cli.js'
import { output } from '../lib/output.js'
import { handleError } from '../lib/errors.js'

export function registerWhoamiCommand(program: Command): void {
  program
    .command('whoami')
    .description('Show current user info')
    .action(async () => {
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        const data = await client.whoami()

        if (opts.json) {
          output(data, true)
          return
        }

        if (data.user?.name) console.log(`  Name:     ${data.user.name}`)
        if (data.user?.email) console.log(`  Email:    ${data.user.email}`)
        if (data.user?.id) console.log(`  ID:       ${data.user.id}`)
        console.log(`  Tier:     ${data.tier || 'free'}`)
        if (data.badges && data.badges.length > 0) {
          console.log(`  Badges:   ${data.badges.join(', ')}`)
        }
        if (data.emailVerified !== undefined) {
          console.log(`  Verified: ${data.emailVerified ? 'yes' : 'no'}`)
        }
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })
}
