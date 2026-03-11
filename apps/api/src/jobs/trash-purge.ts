/**
 * Trash Purge Job
 *
 * Permanently deletes projects and collections that have been in trash for > 30 days.
 * FK cascades handle related data cleanup.
 */

import { db } from '../db/connection'
import { projects, projectCollections } from '../db/schema'
import { and, isNotNull, lt } from 'drizzle-orm'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export async function processTrashPurge(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS)

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

    const total = deletedProjects.length + deletedCollections.length
    if (total > 0) {
      console.log(`[trash-purge] Purged ${deletedProjects.length} projects and ${deletedCollections.length} collections`)
    }
  } catch (err) {
    console.error('[trash-purge] Failed to purge trash:', err)
  }
}
