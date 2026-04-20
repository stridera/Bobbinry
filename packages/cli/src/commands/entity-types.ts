import { Command } from 'commander'
import { createClient, getGlobalOpts } from '../cli.js'
import { output, formatTable, timeAgo } from '../lib/output.js'
import { handleError, CliError } from '../lib/errors.js'
import { loadConfig } from '../lib/config.js'

function resolveProjectId(cmdProject?: string): string {
  if (cmdProject) return cmdProject
  const config = loadConfig()
  if (config.defaultProject) return config.defaultProject
  throw new CliError(
    'No project specified',
    'MISSING_PROJECT',
    'Pass --project <id> or set a default: bobbinry config set default-project <id>'
  )
}

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

export function registerEntityTypesCommand(program: Command): void {
  const types = program
    .command('entity-types')
    .description('Manage entity type definitions (schemas for custom entity types)')

  types
    .command('list')
    .description('List entity types in a project')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .action(async (cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const client = createClient(opts)
        const data = await client.listEntityTypes(projectId)

        if (opts.json) {
          output(data, true)
          return
        }

        const list = data.entityTypes || []
        console.log(`  ${data.total ?? list.length} entity types in project`)
        if (list.length === 0) {
          console.log('  (none)')
          return
        }

        console.log(formatTable(
          list.map((t: any) => ({
            type_id: t.type_id,
            label: `${t.icon || ''} ${t.label || ''}`.trim(),
            fields: Array.isArray(t.custom_fields) ? t.custom_fields.length : 0,
            updated: t._meta?.updatedAt ? timeAgo(t._meta.updatedAt) : '-',
          })),
          [
            { key: 'type_id', label: 'Type ID', width: 30 },
            { key: 'label', label: 'Label', width: 40 },
            { key: 'fields', label: 'Fields' },
            { key: 'updated', label: 'Updated' },
          ]
        ))
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  types
    .command('get')
    .description('Get a single entity type (includes full schema)')
    .argument('<type_id>', 'Type identifier (e.g., characters)')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .action(async (typeId: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const client = createClient(opts)
        const data = await client.getEntityType(projectId, typeId)

        if (opts.json) {
          output(data, true)
          return
        }

        console.log(`  Type ID:    ${data.type_id}`)
        console.log(`  Label:      ${data.icon || ''} ${data.label}`)
        console.log(`  Schema ver: ${data.schema_version ?? 1}`)
        if (data._meta?.updatedAt) console.log(`  Updated:    ${timeAgo(data._meta.updatedAt)}`)
        if (Array.isArray(data.base_fields)) {
          console.log(`  Base:       ${data.base_fields.join(', ')}`)
        }
        const customFields = Array.isArray(data.custom_fields) ? data.custom_fields : []
        console.log(`  Custom fields (${customFields.length}):`)
        for (const f of customFields) {
          const flags = [f.required ? 'required' : null, f.multiline ? 'multiline' : null].filter(Boolean).join(', ')
          const flagStr = flags ? ` [${flags}]` : ''
          const optStr = Array.isArray(f.options) && f.options.length ? ` options=${f.options.join('|')}` : ''
          console.log(`    - ${f.name} (${f.type}): ${f.label}${flagStr}${optStr}`)
        }
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  types
    .command('create')
    .description('Create an entity type')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .option('-d, --data <json>', 'Type definition as JSON string')
    .action(async (cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const data = cmdOpts.data ? JSON.parse(cmdOpts.data) : await readStdinJson()

        const client = createClient(opts)
        const result = await client.createEntityType(projectId, data)

        if (opts.json) {
          output(result, true)
          return
        }

        console.log(`  Created entity type: ${result.icon || ''} ${result.label}`)
        console.log(`  Type ID: ${result.type_id}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  types
    .command('update')
    .description('Update an entity type (type_id is immutable)')
    .argument('<type_id>', 'Type identifier')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .option('-d, --data <json>', 'Partial type definition as JSON string')
    .action(async (typeId: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const data = cmdOpts.data ? JSON.parse(cmdOpts.data) : await readStdinJson()

        const client = createClient(opts)
        const result = await client.updateEntityType(projectId, typeId, data)

        if (opts.json) {
          output(result, true)
          return
        }

        console.log(`  Updated entity type: ${result.type_id}`)
        console.log(`  Schema version: ${result.schema_version ?? 1}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  types
    .command('detach')
    .description('Detach an entity type from its shared template (future upstream updates will no longer apply)')
    .argument('<type_id>', 'Type identifier')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .action(async (typeId: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const client = createClient(opts)
        const result = await client.detachEntityTypeTemplate(projectId, typeId)

        if (opts.json) {
          output(result, true)
          return
        }

        if (result.was_linked) {
          console.log(`  Detached "${typeId}" from template "${result.previous_template_id}".`)
        } else {
          console.log(`  "${typeId}" was not linked to a template; nothing to do.`)
        }
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  types
    .command('delete')
    .description('Delete an entity type (existing entities are NOT deleted)')
    .argument('<type_id>', 'Type identifier')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .action(async (typeId: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const client = createClient(opts)
        await client.deleteEntityType(projectId, typeId)

        if (opts.json) {
          output({ success: true, deleted: typeId }, true)
          return
        }

        console.log(`  Deleted entity type ${typeId}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })
}
