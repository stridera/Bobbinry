/**
 * Trash Purge Job
 *
 * Permanently deletes projects, collections, and entities that have been in
 * trash for longer than the retention window. FK cascades handle related data.
 *
 * Entities are batched and projects/collections are not, because the volumes
 * differ by orders of magnitude: a purge run clears a handful of projects but
 * can clear tens of thousands of chapters, and the connection is configured
 * with a 30s `statement_timeout` (db/connection.ts). An unbatched entity delete
 * would abort partway through and retry the same doomed statement every hour.
 */

import { db } from '../db/connection'
import { projects, projectCollections, entities } from '../db/schema'
import { and, inArray, isNotNull, lt } from 'drizzle-orm'
import { TRASH_RETENTION_MS } from '../lib/entity-scope'
import { changeEventFromRow, recordEntityChanges, type EntityChangeEvent } from '../lib/entity-changes'

/** Rows deleted per statement. Small enough to stay well inside the timeout. */
const ENTITY_BATCH_SIZE = 500

/** Ceiling per run, so a large backlog drains over several hourly ticks
 *  instead of monopolizing one. */
const ENTITY_MAX_PER_RUN = 10_000

/**
 * Purge expired trashed entities in batches.
 *
 * Emits a `purged` change-feed event per row so a sync bot that somehow still
 * holds the chapter learns it is gone for good, not merely trashed.
 */
async function purgeEntities(cutoff: Date): Promise<number> {
  let purged = 0

  while (purged < ENTITY_MAX_PER_RUN) {
    const batch = await db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: entities.id })
        .from(entities)
        .where(and(isNotNull(entities.deletedAt), lt(entities.deletedAt, cutoff)))
        .limit(ENTITY_BATCH_SIZE)

      if (candidates.length === 0) return []

      const removed = await tx
        .delete(entities)
        .where(inArray(entities.id, candidates.map(c => c.id)))
        .returning({
          id: entities.id,
          projectId: entities.projectId,
          collectionName: entities.collectionName,
          contentType: entities.contentType,
          entityData: entities.entityData,
        })

      // The feed is per-project; user- and collection-scoped rows have no
      // project to file the event under, so they purge silently.
      const events: EntityChangeEvent[] = []
      for (const row of removed) {
        if (!row.projectId) continue
        events.push(changeEventFromRow('deleted', { projectId: row.projectId, actor: null }, row, { lifecycle: 'purged' }))
      }
      await recordEntityChanges(tx, events)

      return removed
    })

    purged += batch.length
    if (batch.length < ENTITY_BATCH_SIZE) break
  }

  return purged
}

export async function processTrashPurge(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_MS)

    // Entities first: purging a project cascades its entities away, and doing
    // it in this order means those rows leave through the batched path with
    // their feed events recorded, rather than vanishing inside a cascade.
    const purgedEntities = await purgeEntities(cutoff)

    const [deletedProjects, deletedCollections] = await Promise.all([
      db
        .delete(projects)
        .where(and(isNotNull(projects.deletedAt), lt(projects.deletedAt, cutoff)))
        .returning({ id: projects.id }),
      db
        .delete(projectCollections)
        .where(and(isNotNull(projectCollections.deletedAt), lt(projectCollections.deletedAt, cutoff)))
        .returning({ id: projectCollections.id })
    ])

    const total = deletedProjects.length + deletedCollections.length + purgedEntities
    if (total > 0) {
      console.log(
        `[trash-purge] Purged ${deletedProjects.length} projects, ` +
        `${deletedCollections.length} collections, ${purgedEntities} entities`
      )
      if (purgedEntities >= ENTITY_MAX_PER_RUN) {
        console.log(`[trash-purge] Hit the ${ENTITY_MAX_PER_RUN}-entity cap; remainder purges next run`)
      }
    }
  } catch (err) {
    console.error('[trash-purge] Failed to purge trash:', err)
  }
}
