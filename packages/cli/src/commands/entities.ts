import { Command } from 'commander'
import { createClient, getGlobalOpts } from '../cli.js'
import { output, formatTable, timeAgo, shortId } from '../lib/output.js'
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

export function registerEntitiesCommand(program: Command): void {
  const entities = program
    .command('entities')
    .description('Manage entities')

  entities
    .command('list')
    .description('List entities in a collection')
    .argument('<collection>', 'Collection name (e.g., content, characters, locations)')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .option('-l, --limit <n>', 'Results per page', '50')
    .option('-o, --offset <n>', 'Pagination offset', '0')
    .option('-s, --search <query>', 'Full-text search')
    .option('-f, --filters <json>', 'JSON field-level filters')
    .option('--fields <list>', 'Comma-separated fields to return (e.g., title,notes,updated_at)')
    .action(async (collection: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const client = createClient(opts)
        const data = await client.queryEntities(collection, {
          projectId,
          limit: parseInt(cmdOpts.limit),
          offset: parseInt(cmdOpts.offset),
          search: cmdOpts.search,
          filters: cmdOpts.filters ? JSON.parse(cmdOpts.filters) : undefined,
          fields: cmdOpts.fields ? String(cmdOpts.fields).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
        })

        if (opts.json) {
          output(data, true)
          return
        }

        const list = data.entities || []
        console.log(`  ${data.total ?? list.length} entities in "${collection}"`)
        if (list.length === 0) {
          console.log('  (none)')
          return
        }

        console.log(formatTable(
          list.map((e: any) => ({
            id: shortId(e.id),
            title: e.title || e.name || e.label || '(untitled)',
            updated: e._meta?.updatedAt ? timeAgo(e._meta.updatedAt) : '-',
          })),
          [
            { key: 'id', label: 'ID' },
            { key: 'title', label: 'Title', width: 50 },
            { key: 'updated', label: 'Updated' },
          ]
        ))
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  entities
    .command('get')
    .description('Get a single entity')
    .argument('<id>', 'Entity ID')
    .requiredOption('-c, --collection <name>', 'Collection name')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .action(async (id: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const client = createClient(opts)
        const data = await client.getEntity(id, {
          projectId,
          collection: cmdOpts.collection,
        })

        if (opts.json) {
          output(data, true)
          return
        }

        const entity = data.entity || data
        console.log(`  ID:         ${entity.id}`)
        console.log(`  Collection: ${entity._meta?.collection || cmdOpts.collection}`)
        if (entity.title) console.log(`  Title:      ${entity.title}`)
        if (entity.name) console.log(`  Name:       ${entity.name}`)
        if (entity._meta?.version) console.log(`  Version:    ${entity._meta.version}`)
        if (entity._meta?.updatedAt) console.log(`  Updated:    ${timeAgo(entity._meta.updatedAt)}`)

        // Show data fields (excluding known meta)
        const skip = new Set(['id', 'title', 'name', '_meta'])
        const fields = Object.entries(entity).filter(([k]) => !skip.has(k))
        if (fields.length > 0) {
          console.log('  Fields:')
          for (const [key, value] of fields) {
            const display = typeof value === 'string' && value.length > 80
              ? value.slice(0, 77) + '...'
              : JSON.stringify(value)
            console.log(`    ${key}: ${display}`)
          }
        }
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  entities
    .command('create')
    .description('Create an entity')
    .argument('<collection>', 'Collection name')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .option('-d, --data <json>', 'Entity data as JSON string')
    .action(async (collection: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)

        let data: Record<string, any>
        if (cmdOpts.data) {
          data = JSON.parse(cmdOpts.data)
        } else {
          // Read from stdin
          const chunks: Buffer[] = []
          for await (const chunk of process.stdin) {
            chunks.push(chunk)
          }
          const input = Buffer.concat(chunks).toString('utf-8').trim()
          if (!input) {
            throw new CliError('No data provided', 'MISSING_DATA', 'Pass --data \'{"title":"My Entity"}\' or pipe JSON to stdin')
          }
          data = JSON.parse(input)
        }

        const client = createClient(opts)
        const result = await client.createEntity(collection, projectId, data)

        if (opts.json) {
          output(result, true)
          return
        }

        const entity = result.entity || result
        console.log(`  Created entity: ${entity.title || entity.name || entity.id}`)
        console.log(`  ID: ${entity.id}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  entities
    .command('update')
    .description('Update an entity')
    .argument('<id>', 'Entity ID')
    .requiredOption('-c, --collection <name>', 'Collection name')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .option('-d, --data <json>', 'Entity data as JSON string')
    .option('-v, --expected-version <n>', 'Expected version for optimistic locking')
    .action(async (id: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)

        let data: Record<string, any>
        if (cmdOpts.data) {
          data = JSON.parse(cmdOpts.data)
        } else {
          const chunks: Buffer[] = []
          for await (const chunk of process.stdin) {
            chunks.push(chunk)
          }
          const input = Buffer.concat(chunks).toString('utf-8').trim()
          if (!input) {
            throw new CliError('No data provided', 'MISSING_DATA', 'Pass --data \'{"title":"Updated"}\' or pipe JSON to stdin')
          }
          data = JSON.parse(input)
        }

        const client = createClient(opts)
        const result = await client.updateEntity(id, {
          collection: cmdOpts.collection,
          projectId,
          data,
          expectedVersion: cmdOpts.expectedVersion ? parseInt(cmdOpts.expectedVersion) : undefined,
        })

        if (opts.json) {
          output(result, true)
          return
        }

        const entity = result.entity || result
        console.log(`  Updated entity: ${entity.title || entity.name || entity.id}`)
        if (entity._meta?.version) console.log(`  Version: ${entity._meta.version}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  entities
    .command('delete')
    .description('Delete an entity')
    .argument('<id>', 'Entity ID')
    .requiredOption('-c, --collection <name>', 'Collection name')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .action(async (id: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const client = createClient(opts)
        await client.deleteEntity(id, {
          projectId,
          collection: cmdOpts.collection,
        })

        if (opts.json) {
          output({ success: true, deleted: id }, true)
          return
        }

        console.log(`  Deleted entity ${shortId(id)}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })
}
