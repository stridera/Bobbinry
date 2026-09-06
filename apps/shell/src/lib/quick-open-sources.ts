/**
 * Builds the Ctrl+K quick-open index from the bobbins' manifest `quickOpen`
 * declarations. The palette itself knows nothing about which bobbins exist:
 * each declaration names the collections to list, the title field, an
 * optional parent field (for "Book › Part" path subtitles), and how a pick
 * navigates.
 */
import type { EntityAPI } from '@bobbinry/sdk'
import type { QuickOpenDeclaration, QuickOpenSource } from '@bobbinry/types'

export interface QuickOpenItem {
  id: string
  title: string
  /** Declaring bobbin — items are grouped by it. */
  kind: string
  subtitle: string
  navDetail: {
    entityType: string
    entityId: string
    bobbinId: string
    metadata?: Record<string, any>
  }
}

export interface QuickOpenGroup {
  kind: string
  label: string
  icon: NonNullable<QuickOpenDeclaration['icon']>
}

type AnyRecord = Record<string, any>
type Query = (collection: string) => Promise<AnyRecord[]>

/** A source expanded to one concrete collection, with its records loaded. */
interface LoadedCollection {
  collection: string
  source: QuickOpenSource
  records: AnyRecord[]
  byId: Map<string, AnyRecord>
  /** Subtitle for flat (non-hierarchical) sources. */
  subtitle: string
  extraMetadata: AnyRecord
}

function field(record: AnyRecord, name: string): any {
  if (record[name] !== undefined) return record[name]
  // Accept camelCase spellings of snake_case fields (container_id / containerId).
  const camel = name.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  return record[camel]
}

/** A declared titleField still falls back to `title` so mixed records read sensibly. */
function titleOf(record: AnyRecord, source: QuickOpenSource): string {
  return field(record, source.titleField ?? 'title') || record.title || 'Untitled'
}

async function loadCollection(
  query: Query,
  source: QuickOpenSource,
  collection: string,
  subtitle: string,
  extraMetadata: AnyRecord = {},
): Promise<LoadedCollection> {
  const records = (await query(collection)).filter(r => r?.id)
  return { collection, source, records, byId: new Map(records.map(r => [r.id as string, r])), subtitle, extraMetadata }
}

/** Expand a declaration's sources into concrete collections (discover → one per definition record). */
async function loadDeclaration(query: Query, quickOpen: QuickOpenDeclaration): Promise<LoadedCollection[]> {
  const perSource = await Promise.all(quickOpen.sources.map(async source => {
    if (source.discover) {
      const { collection, idField, labelField } = source.discover
      const defs = await query(collection)
      const types = defs
        .map(d => ({ id: field(d, idField) as string | undefined, label: labelField ? (field(d, labelField) as string | undefined) : undefined }))
        .filter(t => t.id)
      return Promise.all(types.map(t =>
        loadCollection(query, source, t.id!, t.label || t.id!, { typeId: t.id, typeLabel: t.label || t.id }),
      ))
    }
    if (source.collection) return [await loadCollection(query, source, source.collection, quickOpen.label)]
    return []
  }))
  return perSource.flat()
}

/**
 * Walk parent links for a "Book › Part" path. Each hop reads the current
 * collection's `parentField` and continues in `parentCollection` (or the same
 * collection) — so chapters resolve through containers, and containers nest.
 */
function pathTo(index: Map<string, LoadedCollection>, collection: string, startId: string | null): string {
  const parts: string[] = []
  let cursor = startId
  let where = index.get(collection)
  for (let i = 0; cursor && where && i < 32; i++) {
    const rec = where.byId.get(cursor)
    if (!rec) break
    parts.unshift(titleOf(rec, where.source))
    const { parentField, parentCollection } = where.source
    cursor = parentField ? field(rec, parentField) || null : null
    where = parentCollection ? index.get(parentCollection) : where
  }
  return parts.join(' › ')
}

function itemsFor(bobbinId: string, loaded: LoadedCollection, index: Map<string, LoadedCollection>): QuickOpenItem[] {
  const { source, collection } = loaded
  const entityType = !source.entityType || source.entityType === '$collection' ? collection : source.entityType
  return loaded.records.map(record => {
    const parentId = source.parentField ? field(record, source.parentField) || null : null
    return {
      id: record.id,
      title: titleOf(record, source),
      kind: bobbinId,
      // Hierarchical sources show their path (empty at the root); flat ones show the group/type name.
      subtitle: source.parentField ? pathTo(index, source.parentCollection ?? collection, parentId) : loaded.subtitle,
      navDetail: {
        entityType,
        entityId: record.id,
        bobbinId,
        metadata: {
          ...(source.metadata ?? {}),
          ...loaded.extraMetadata,
          ...(source.parentField ? { parentId } : {}),
        },
      },
    }
  })
}

/**
 * Expand every declaration into palette items. Failing collections are
 * skipped rather than failing the whole index.
 */
export async function buildQuickOpenItems(
  entityApi: Pick<EntityAPI, 'query'>,
  declarations: Array<{ bobbinId: string; quickOpen: QuickOpenDeclaration }>,
): Promise<{ items: QuickOpenItem[]; groups: QuickOpenGroup[] }> {
  const query: Query = collection =>
    entityApi.query({ collection, limit: 1000 }).then(r => (r.data as AnyRecord[]) ?? []).catch(() => [])

  const groups: QuickOpenGroup[] = declarations.map(d => ({
    kind: d.bobbinId,
    label: d.quickOpen.label,
    icon: d.quickOpen.icon ?? 'document',
  }))

  const perDeclaration = await Promise.all(declarations.map(async ({ bobbinId, quickOpen }) => {
    const loaded = await loadDeclaration(query, quickOpen)
    const index = new Map(loaded.map(l => [l.collection, l]))
    return loaded.flatMap(l => itemsFor(bobbinId, l, index))
  }))

  return { items: perDeclaration.flat(), groups }
}
