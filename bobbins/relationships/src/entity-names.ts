import type { BobbinrySDK } from '@bobbinry/sdk'

interface RelLike {
  source_collection?: string
  source_entity_id?: string
  target_collection?: string
  target_entity_id?: string
}

export interface ResolvedEntity {
  name: string
  collection: string
}

/**
 * Walks a list of relationships, fetches each referenced entity's name from
 * its declared collection (one query per collection, ids filtered locally),
 * and returns a Map keyed by entity id. Missing names fall through to the
 * caller so it can render a short-id fallback.
 */
export async function resolveEntityNames(
  sdk: BobbinrySDK,
  rels: RelLike[]
): Promise<Map<string, ResolvedEntity>> {
  const byCollection = new Map<string, Set<string>>()
  for (const rel of rels) {
    if (rel.source_collection && rel.source_entity_id) {
      if (!byCollection.has(rel.source_collection)) byCollection.set(rel.source_collection, new Set())
      byCollection.get(rel.source_collection)!.add(rel.source_entity_id)
    }
    if (rel.target_collection && rel.target_entity_id) {
      if (!byCollection.has(rel.target_collection)) byCollection.set(rel.target_collection, new Set())
      byCollection.get(rel.target_collection)!.add(rel.target_entity_id)
    }
  }

  const out = new Map<string, ResolvedEntity>()
  await Promise.all(
    [...byCollection.entries()].map(async ([collection, ids]) => {
      try {
        const res = await sdk.entities.query({ collection, limit: 1000 })
        for (const e of (res.data as any[]) || []) {
          if (ids.has(e.id)) {
            out.set(e.id, { name: e.name || e.title || `(${e.id.slice(0, 8)})`, collection })
          }
        }
      } catch (err) {
        console.error(`[relationships] failed to load names for ${collection}:`, err)
      }
    })
  )
  return out
}
