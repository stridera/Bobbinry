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
    .option('--variant <id>', 'Show the entity resolved at the given variant id (e.g. book-5)')
    .action(async (id: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const client = createClient(opts)
        const data = await client.getEntity(id, {
          projectId,
          collection: cmdOpts.collection,
          variant: cmdOpts.variant,
        })

        if (opts.json) {
          output(data, true)
          return
        }

        const entity = data.entity || data
        // When --variant was passed, the API returns the full entity plus a
        // `resolvedData` view with variant overrides applied. Prefer that
        // view for the field listing so users see the merged picture.
        const displayFields = (cmdOpts.variant && entity.resolvedData)
          ? { id: entity.id, ...entity.resolvedData, _meta: entity._meta }
          : entity

        console.log(`  ID:         ${entity.id}`)
        console.log(`  Collection: ${entity._meta?.collection || cmdOpts.collection}`)
        if (displayFields.title) console.log(`  Title:      ${displayFields.title}`)
        if (displayFields.name) console.log(`  Name:       ${displayFields.name}`)
        if (entity._meta?.version) console.log(`  Version:    ${entity._meta.version}`)
        if (entity.resolvedVariant) console.log(`  Variant:    ${entity.resolvedVariant}`)
        if (entity._meta?.updatedAt) console.log(`  Updated:    ${timeAgo(entity._meta.updatedAt)}`)

        const skip = new Set(['id', 'title', 'name', '_meta', '_variants', 'resolvedData', 'resolvedVariant'])
        const fields = Object.entries(displayFields).filter(([k]) => !skip.has(k))
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

  registerVariantsCommand(entities)
}

// ── Variant helpers ─────────────────────────────────────────────────────────

interface Variants {
  axis_id?: string | null
  active?: string | null
  order: string[]
  items: Record<string, { label: string; axis_value?: number | string | null; overrides: Record<string, any> }>
}

function getVariants(entity: Record<string, any>): Variants {
  const raw = entity?._variants
  if (!raw || typeof raw !== 'object' || !raw.items) {
    return { axis_id: null, active: null, order: [], items: {} }
  }
  return {
    axis_id: typeof raw.axis_id === 'string' ? raw.axis_id : null,
    active: typeof raw.active === 'string' ? raw.active : null,
    order: Array.isArray(raw.order) ? raw.order.filter((x: unknown) => typeof x === 'string') : Object.keys(raw.items),
    items: raw.items,
  }
}

function slugifyVariantId(label: string): string {
  const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return base || `variant-${Date.now().toString(36)}`
}

function ensureUniqueVariantId(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base
  let i = 2
  while (existing.includes(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/** Read the entity, apply the variant mutation, PUT it back with optimistic
 * locking via expectedVersion. Returns the updated entity response. */
async function mutateVariants(
  client: ReturnType<typeof createClient>,
  params: { projectId: string; collection: string; entityId: string },
  mutate: (current: Variants) => Variants,
): Promise<any> {
  const entity = await client.getEntity(params.entityId, { projectId: params.projectId, collection: params.collection })
  const source = entity.entity || entity
  const nextVariants = mutate(getVariants(source))
  return client.updateEntity(params.entityId, {
    projectId: params.projectId,
    collection: params.collection,
    data: { _variants: nextVariants },
    expectedVersion: source._meta?.version,
  })
}

function registerVariantsCommand(parent: Command): void {
  const variants = parent
    .command('variants')
    .description('Manage entity variants (named per-entity overlays, e.g. Book 1 vs Book 5)')

  variants
    .command('list')
    .description('List an entity\'s variants')
    .argument('<id>', 'Entity ID')
    .requiredOption('-c, --collection <name>', 'Collection name')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .action(async (id: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const client = createClient(opts)
        const entity = await client.getEntity(id, { projectId, collection: cmdOpts.collection })
        const source = entity.entity || entity
        const v = getVariants(source)

        if (opts.json) {
          output(v, true)
          return
        }

        if (v.order.length === 0) {
          console.log('  (no variants)')
          return
        }
        console.log(formatTable(
          v.order.map(variantId => ({
            id: variantId,
            label: v.items[variantId]?.label ?? '',
            axis: v.items[variantId]?.axis_value ?? '',
            default: v.active === variantId ? '★' : '',
            overrides: Object.keys(v.items[variantId]?.overrides ?? {}).join(', ') || '—',
          })),
          [
            { key: 'id', label: 'Variant' },
            { key: 'label', label: 'Label', width: 30 },
            { key: 'axis', label: 'Axis' },
            { key: 'default', label: 'Default' },
            { key: 'overrides', label: 'Overrides', width: 40 },
          ]
        ))
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  variants
    .command('add')
    .description('Add a new variant to an entity')
    .argument('<id>', 'Entity ID')
    .requiredOption('-c, --collection <name>', 'Collection name')
    .requiredOption('--label <label>', 'Human-readable label (e.g. "Book 1", "Cat form")')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .option('--id <variant-id>', 'Explicit variant id (default: slugified from --label)')
    .option('--axis-value <value>', 'Sort value when the type axis is ordered (e.g. 1 for Book 1)')
    .option('--default', 'Make this the default variant shown to readers')
    .option('--overrides <json>', 'Initial field overrides for this variant')
    .action(async (id: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const client = createClient(opts)
        const overrides = cmdOpts.overrides ? JSON.parse(cmdOpts.overrides) : {}
        let newId = ''
        const updated = await mutateVariants(client, { projectId, collection: cmdOpts.collection, entityId: id }, v => {
          const base = cmdOpts.id || slugifyVariantId(cmdOpts.label)
          newId = ensureUniqueVariantId(base, v.order)
          const axisValue = cmdOpts.axisValue !== undefined
            ? (isNaN(Number(cmdOpts.axisValue)) ? cmdOpts.axisValue : Number(cmdOpts.axisValue))
            : undefined
          const item: Variants['items'][string] = { label: cmdOpts.label, overrides }
          if (axisValue !== undefined) item.axis_value = axisValue
          return {
            axis_id: v.axis_id,
            active: cmdOpts.default || !v.active ? newId : v.active,
            order: [...v.order, newId],
            items: { ...v.items, [newId]: item },
          }
        })
        if (opts.json) {
          output({ id: newId, entity: updated }, true)
          return
        }
        console.log(`  Added variant ${newId} ("${cmdOpts.label}") to entity ${shortId(id)}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  variants
    .command('set')
    .description('Set field overrides on a variant (merges with existing)')
    .argument('<id>', 'Entity ID')
    .requiredOption('-c, --collection <name>', 'Collection name')
    .requiredOption('--variant <variant-id>', 'Variant id to update')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .option('-d, --data <json>', 'JSON object of field overrides (merged with existing)')
    .option('--replace', 'Replace overrides instead of merging')
    .action(async (id: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const client = createClient(opts)

        let newOverrides: Record<string, any>
        if (cmdOpts.data) {
          newOverrides = JSON.parse(cmdOpts.data)
        } else {
          const chunks: Buffer[] = []
          for await (const chunk of process.stdin) chunks.push(chunk)
          const input = Buffer.concat(chunks).toString('utf-8').trim()
          if (!input) throw new CliError('No overrides provided', 'MISSING_DATA', 'Pass --data \'{"level":20}\' or pipe JSON to stdin')
          newOverrides = JSON.parse(input)
        }

        await mutateVariants(client, { projectId, collection: cmdOpts.collection, entityId: id }, v => {
          const existing = v.items[cmdOpts.variant]
          if (!existing) throw new CliError(`Variant "${cmdOpts.variant}" not found on entity`, 'NOT_FOUND')
          const merged = cmdOpts.replace ? newOverrides : { ...existing.overrides, ...newOverrides }
          return { ...v, items: { ...v.items, [cmdOpts.variant]: { ...existing, overrides: merged } } }
        })
        if (opts.json) {
          output({ success: true, variant: cmdOpts.variant }, true)
          return
        }
        console.log(`  Updated variant ${cmdOpts.variant} on entity ${shortId(id)}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  variants
    .command('rename')
    .description('Rename a variant\'s display label')
    .argument('<id>', 'Entity ID')
    .requiredOption('-c, --collection <name>', 'Collection name')
    .requiredOption('--variant <variant-id>', 'Variant id to rename')
    .requiredOption('--label <label>', 'New label')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .action(async (id: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const client = createClient(opts)
        await mutateVariants(client, { projectId, collection: cmdOpts.collection, entityId: id }, v => {
          const existing = v.items[cmdOpts.variant]
          if (!existing) throw new CliError(`Variant "${cmdOpts.variant}" not found on entity`, 'NOT_FOUND')
          return { ...v, items: { ...v.items, [cmdOpts.variant]: { ...existing, label: cmdOpts.label } } }
        })
        if (opts.json) {
          output({ success: true, variant: cmdOpts.variant, label: cmdOpts.label }, true)
          return
        }
        console.log(`  Renamed ${cmdOpts.variant} → "${cmdOpts.label}"`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  variants
    .command('default')
    .description('Set (or clear) the default variant shown to readers')
    .argument('<id>', 'Entity ID')
    .requiredOption('-c, --collection <name>', 'Collection name')
    .option('--variant <variant-id>', 'Variant id to set as default (omit or pass "none" to clear)')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .action(async (id: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const client = createClient(opts)
        const target = (!cmdOpts.variant || cmdOpts.variant === 'none') ? null : cmdOpts.variant
        await mutateVariants(client, { projectId, collection: cmdOpts.collection, entityId: id }, v => {
          if (target !== null && !v.items[target]) {
            throw new CliError(`Variant "${target}" not found on entity`, 'NOT_FOUND')
          }
          return { ...v, active: target }
        })
        if (opts.json) {
          output({ success: true, active: target }, true)
          return
        }
        console.log(target ? `  Default variant: ${target}` : '  Default variant cleared')
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  variants
    .command('delete')
    .description('Delete a variant from an entity')
    .argument('<id>', 'Entity ID')
    .requiredOption('-c, --collection <name>', 'Collection name')
    .requiredOption('--variant <variant-id>', 'Variant id to delete')
    .option('-p, --project <id>', 'Project ID (uses default if set)')
    .action(async (id: string, cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const projectId = resolveProjectId(cmdOpts.project)
        const client = createClient(opts)
        await mutateVariants(client, { projectId, collection: cmdOpts.collection, entityId: id }, v => {
          if (!v.items[cmdOpts.variant]) {
            throw new CliError(`Variant "${cmdOpts.variant}" not found on entity`, 'NOT_FOUND')
          }
          const { [cmdOpts.variant]: _dropped, ...rest } = v.items
          const nextOrder = v.order.filter(x => x !== cmdOpts.variant)
          return {
            ...v,
            active: v.active === cmdOpts.variant ? (nextOrder[0] ?? null) : v.active,
            order: nextOrder,
            items: rest,
          }
        })
        if (opts.json) {
          output({ success: true, deleted: cmdOpts.variant }, true)
          return
        }
        console.log(`  Deleted variant ${cmdOpts.variant} from entity ${shortId(id)}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })
}
