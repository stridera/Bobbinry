/**
 * Breadcrumbs resolved from the bobbins' manifest `records` declarations.
 *
 * The shell knows nothing about which bobbins exist. For the current
 * navigation target it finds the declaring bobbin's source for that
 * collection, titles the record, walks `parentField` / `parentCollection`
 * for the ancestor chain ("Book › Part"), and prepends the source's `group`
 * crumb (the collection's list view) and the project crumb (the bobbin's
 * `home`). Pure apart from the `sdk` reads, so the hook stays thin.
 */
import type { BobbinrySDK } from '@bobbinry/sdk'
import type { RecordSource } from '@bobbinry/types'
import { resolveAnyHome, resolveBobbinHome, type BobbinHomeDetail, type RecordDeclaration } from './extensions'

export interface Crumb {
  id: string
  label: string
  /** Dispatched via bobbinry:navigate when the crumb is clicked; leaf and inert crumbs have none. */
  navDetail?: BobbinHomeDetail
}

export interface NavigationState {
  entityType: string
  entityId: string
  bobbinId: string
  metadata?: Record<string, any>
}

/** Sentinel ids (ROOT, list, dashboard, …) are not records and get only the project crumb. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type AnyRecord = Record<string, any>
type RecordReader = Pick<BobbinrySDK['entities'], 'get' | 'query'>

const CACHE_TTL_MS = 60_000
const MAX_DEPTH = 32

// Module-level cache of whole collections (containers, folders, type
// definitions) keyed by project + collection, so the ancestor walk is one
// query per collection rather than one per hop. The declaring bobbin's panel
// may be unmounted, so the shell cannot lean on its state.
const collectionCache = new Map<string, { at: number; byId: Map<string, AnyRecord>; rows: AnyRecord[] }>()

if (typeof window !== 'undefined') {
  window.addEventListener('bobbinry:entities-changed', (event: Event) => {
    const collection = (event as CustomEvent).detail?.collection
    if (typeof collection !== 'string') return
    for (const key of collectionCache.keys()) {
      if (key.endsWith(`:${collection}`)) collectionCache.delete(key)
    }
  })
}

/** Test hook. */
export function clearBreadcrumbCache(): void {
  collectionCache.clear()
}

async function loadCollection(sdk: RecordReader, projectId: string, collection: string) {
  const key = `${projectId}:${collection}`
  const hit = collectionCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit
  const result = await sdk.query({ collection, limit: 1000 }).catch(() => ({ data: [] })) as { data?: AnyRecord[] }
  const rows = (result.data ?? []).filter(r => r?.id)
  const entry = { at: Date.now(), rows, byId: new Map(rows.map(r => [r.id as string, r])) }
  collectionCache.set(key, entry)
  return entry
}

function field(record: AnyRecord | undefined, name: string): any {
  if (!record) return undefined
  if (record[name] !== undefined) return record[name]
  // Accept camelCase spellings of snake_case fields (container_id / containerId).
  return record[name.replace(/_([a-z])/g, (_, c) => c.toUpperCase())]
}

function titleOf(record: AnyRecord | undefined, source: RecordSource | undefined): string {
  return field(record, source?.titleField ?? 'title') || record?.title || 'Untitled'
}

function entityTypeOf(source: RecordSource, collection: string): string {
  return !source.entityType || source.entityType === '$collection' ? collection : source.entityType
}

/** `$collection` / `$label` / `$icon` in group metadata expand from the discovered type. */
function expandTokens(metadata: AnyRecord | undefined, type: DiscoveredType): AnyRecord | undefined {
  if (!metadata) return undefined
  const tokens: Record<string, unknown> = { $collection: type.collection, $label: type.label, $icon: type.icon }
  const out: AnyRecord = {}
  for (const [k, v] of Object.entries(metadata)) {
    out[k] = typeof v === 'string' && v in tokens ? tokens[v] : v
  }
  return out
}

interface DiscoveredType {
  collection: string
  label?: string
  icon?: string
}

interface MatchedSource {
  source: RecordSource
  collection: string
  type: DiscoveredType
}

/** Find the source for a navigation target's collection, resolving `discover` sources against their definitions. */
async function matchSource(
  sdk: RecordReader, projectId: string, records: RecordSource[], collection: string,
): Promise<MatchedSource | null> {
  const fixed = records.find(s => s.collection && entityTypeOf(s, s.collection) === collection)
  if (fixed) return { source: fixed, collection: fixed.collection!, type: { collection: fixed.collection! } }

  for (const source of records) {
    if (!source.discover) continue
    const { collection: defs, idField, labelField, iconField } = source.discover
    const definitions = await loadCollection(sdk, projectId, defs)
    const def = definitions.rows.find(d => field(d, idField) === collection)
    if (!def) continue
    return {
      source,
      collection,
      type: {
        collection,
        label: labelField ? field(def, labelField) : undefined,
        icon: iconField ? field(def, iconField) : undefined,
      },
    }
  }
  return null
}

function projectCrumb(projectName: string | undefined, bobbinId: string): Crumb {
  // The project crumb navigates to the current bobbin's home so clicking it
  // stays inside the active module; a bobbin with no home borrows the shell's
  // top-priority one; with none registered the crumb is inert.
  const home = resolveBobbinHome(bobbinId) ?? resolveAnyHome()
  return { id: 'ROOT', label: projectName || 'Project', ...(home ? { navDetail: home } : {}) }
}

/**
 * Walk parent links into crumbs. Each hop reads the current collection's
 * `parentField` and continues in `parentCollection` (or the same collection),
 * so chapters resolve through containers and containers nest.
 */
async function ancestorCrumbs(
  sdk: RecordReader, projectId: string, bobbinId: string, records: RecordSource[],
  startCollection: string, startId: string | null,
): Promise<Crumb[]> {
  const crumbs: Crumb[] = []
  let collection = startCollection
  let cursor = startId
  for (let i = 0; cursor && i < MAX_DEPTH; i++) {
    const source = records.find(s => s.collection === collection)
    if (!source) break
    const rows = await loadCollection(sdk, projectId, collection)
    const record = rows.byId.get(cursor)
    if (!record) break
    crumbs.unshift({
      id: record.id,
      label: titleOf(record, source),
      navDetail: {
        entityType: entityTypeOf(source, collection),
        entityId: record.id,
        bobbinId,
        ...(source.metadata ? { metadata: source.metadata } : {}),
      },
    })
    cursor = source.parentField ? field(record, source.parentField) || null : null
    collection = source.parentCollection ?? collection
  }
  return crumbs
}

/**
 * Crumbs for the current navigation target. Never throws: anything the
 * declarations cannot explain collapses to the project crumb.
 */
export async function resolveCrumbs(
  nav: NavigationState | null,
  sdk: RecordReader | null,
  projectId: string,
  projectName: string | undefined,
  declarations: RecordDeclaration[],
): Promise<Crumb[]> {
  if (!nav || !sdk) return []
  const { entityType, entityId, bobbinId, metadata } = nav
  const project = projectCrumb(projectName, bobbinId)
  if (!UUID_RE.test(entityId)) return [project]

  const declaration = declarations.find(d => d.bobbinId === bobbinId)
  if (!declaration) return [project]
  const matched = await matchSource(sdk, projectId, declaration.records, entityType)
  if (!matched) return [project]
  const { source, collection, type } = matched

  // The record itself titles the leaf and supplies its parent; the navigate
  // event's metadata.parentId is the fallback when the fetch fails.
  const record = await sdk.get(collection, entityId).catch(() => undefined) as AnyRecord | undefined
  const parentId: string | null = source.parentField
    ? field(record, source.parentField) || metadata?.parentId || null
    : null

  const crumbs: Crumb[] = [project]
  if (source.group) {
    const label = source.group.label ?? type.label ?? declaration.quickOpen?.label ?? collection
    const groupMetadata = expandTokens(source.group.metadata, type)
    crumbs.push({
      id: collection,
      label,
      ...(source.group.entityId
        ? { navDetail: { entityType: collection, entityId: source.group.entityId, bobbinId, ...(groupMetadata ? { metadata: groupMetadata } : {}) } }
        : {}),
    })
  }
  crumbs.push(...await ancestorCrumbs(sdk, projectId, bobbinId, declaration.records, source.parentCollection ?? collection, parentId))
  crumbs.push({ id: entityId, label: titleOf(record, source) })
  return crumbs
}
