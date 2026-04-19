import { Command } from 'commander'
import { createClient, getGlobalOpts } from '../cli.js'
import { output, formatTable, timeAgo } from '../lib/output.js'
import { handleError, CliError } from '../lib/errors.js'

async function readStdinJson(): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  const input = Buffer.concat(chunks).toString('utf-8').trim()
  if (!input) {
    throw new CliError('No data provided', 'MISSING_DATA', 'Pass --data \'{...}\' or pipe JSON to stdin')
  }
  return JSON.parse(input)
}

export function registerTemplatesCommand(program: Command): void {
  const templates = program
    .command('templates')
    .description('Browse and publish shared entity templates')

  templates
    .command('list')
    .description('Browse published templates')
    .option('-s, --search <query>', 'Search label and description')
    .option('-t, --tag <tag>', 'Filter by tag')
    .option('--official <bool>', 'Filter official-only (true/false)')
    .option('-l, --limit <n>', 'Results per page', '50')
    .option('-o, --offset <n>', 'Pagination offset', '0')
    .action(async (cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        const data = await client.listTemplates({
          q: cmdOpts.search,
          tag: cmdOpts.tag,
          official: cmdOpts.official,
          limit: cmdOpts.limit ? parseInt(cmdOpts.limit) : undefined,
          offset: cmdOpts.offset ? parseInt(cmdOpts.offset) : undefined,
        })

        if (opts.json) {
          output(data, true)
          return
        }

        const list = data.templates || []
        console.log(`  ${data.total ?? list.length} templates${data.hasMore ? ' (more available)' : ''}`)
        if (list.length === 0) {
          console.log('  (none)')
          return
        }

        console.log(formatTable(
          list.map((t: any) => ({
            share_id: t.share_id,
            label: `${t.icon || ''} ${t.label || ''}`.trim(),
            author: t.author_name || '-',
            installs: t.installs ?? 0,
            official: t.official ? 'yes' : '',
          })),
          [
            { key: 'share_id', label: 'Share ID' },
            { key: 'label', label: 'Label', width: 40 },
            { key: 'author', label: 'Author', width: 20 },
            { key: 'installs', label: 'Installs' },
            { key: 'official', label: 'Official' },
          ]
        ))
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  templates
    .command('get')
    .description('Get a single template (full schema)')
    .argument('<shareId>', 'Template share ID')
    .action(async (shareId: string) => {
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        const data = await client.getTemplate(shareId)

        if (opts.json) {
          output(data, true)
          return
        }

        console.log(`  Share ID:   ${data.share_id}`)
        console.log(`  Label:      ${data.icon || ''} ${data.label}`)
        console.log(`  Author:     ${data.author_name || '-'}`)
        console.log(`  Official:   ${data.official ? 'yes' : 'no'}`)
        console.log(`  Installs:   ${data.installs ?? 0}`)
        console.log(`  Version:    ${data.version ?? 1}`)
        if (data.published_at) console.log(`  Published:  ${timeAgo(data.published_at)}`)
        if (data.description) console.log(`  Description: ${data.description}`)
        if (Array.isArray(data.tags) && data.tags.length) {
          console.log(`  Tags:       ${data.tags.join(', ')}`)
        }
        const customFields = Array.isArray(data.custom_fields) ? data.custom_fields : []
        console.log(`  Custom fields (${customFields.length}):`)
        for (const f of customFields) {
          console.log(`    - ${f.name} (${f.type}): ${f.label}`)
        }
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  templates
    .command('publish')
    .description('Publish an entity type as a shared template')
    .option('-d, --data <json>', 'Template data as JSON string')
    .action(async (cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const data = cmdOpts.data ? JSON.parse(cmdOpts.data) : await readStdinJson()
        const client = createClient(opts)
        const result = await client.publishTemplate(data)

        if (opts.json) {
          output(result, true)
          return
        }

        console.log(`  Published template: ${result.icon || ''} ${result.label}`)
        console.log(`  Share ID: ${result.share_id}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  templates
    .command('unpublish')
    .description('Hide a published template (existing installs keep working)')
    .argument('<shareId>', 'Template share ID')
    .action(async (shareId: string) => {
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        await client.unpublishTemplate(shareId)

        if (opts.json) {
          output({ success: true, shareId }, true)
          return
        }

        console.log(`  Unpublished template ${shareId}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })
}
