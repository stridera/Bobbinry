import { Command } from 'commander'
import { createClient, getGlobalOpts } from '../cli.js'
import { output } from '../lib/output.js'
import { handleError } from '../lib/errors.js'

export function registerStatsCommand(program: Command): void {
  program
    .command('stats')
    .description('Show dashboard stats')
    .action(async () => {
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        const data = await client.getStats()

        if (opts.json) {
          output(data, true)
          return
        }

        const s = data.stats || data
        console.log('  Dashboard Stats')
        console.log('  ─────────────────')
        if (s.projects) {
          console.log(`  Projects:  ${s.projects.total} total, ${s.projects.active} active`)
        }
        if (s.collections) console.log(`  Collections: ${s.collections.total}`)
        if (s.entities) console.log(`  Entities:    ${s.entities.total}`)
        if (s.trashed) console.log(`  Trashed:     ${s.trashed.total}`)
        // Writing stats (if present from activity endpoints)
        if (s.totalWords !== undefined) console.log(`  Total words: ${Number(s.totalWords).toLocaleString()}`)
        if (s.wordsToday !== undefined) console.log(`  Words today: ${Number(s.wordsToday).toLocaleString()}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })
}
