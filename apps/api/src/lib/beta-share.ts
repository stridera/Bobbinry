/**
 * Per-chapter "share with beta readers" flag (chapter_publications.beta_shared).
 *
 * One implementation for the single-chapter and bulk routes. Only chapters that
 * are not publicly released (no publication row, draft or complete) are
 * touched; published and scheduled ones already reach beta readers and must
 * not carry a flag that would re-expose them after an unpublish. Publish state,
 * dates and events are never changed here.
 */
import { db } from '../db/connection'
import { chapterPublications, entities } from '../db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { notDeleted } from './entity-scope'
import { ensureCurrentSlug } from './slugs'
import { NARRATIVE_TYPES, type ContentType } from '@bobbinry/types'

export interface BetaShareResult {
  /** Unpublished chapters now in the requested state. */
  updatedIds: string[]
  /** Ids that are published or scheduled, left alone. */
  releasedIds: string[]
  /** Ids that are not live content in this project, ignored. */
  missingIds: string[]
}

/**
 * Chapters a project-wide "share all" covers: live, unarchived manuscript
 * content (chapters, scenes, prologues…). Outlines and supporting docs are
 * author notes, not reading material, so they are never swept in implicitly.
 */
export async function listShareableChapterIds(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ id: entities.id, contentType: entities.contentType })
    .from(entities)
    .where(and(
      eq(entities.projectId, projectId),
      eq(entities.collectionName, 'content'),
      isNull(entities.archivedAt),
      notDeleted(),
    ))
  return rows
    .filter(r => NARRATIVE_TYPES.has((r.contentType ?? 'chapter') as ContentType))
    .map(r => r.id)
}

export async function setBetaShared(
  projectId: string,
  chapterIds: string[],
  shared: boolean,
): Promise<BetaShareResult> {
  const ids = [...new Set(chapterIds)]
  if (ids.length === 0) return { updatedIds: [], releasedIds: [], missingIds: [] }

  const result = await db.transaction(async (tx) => {
    const live = await tx
      .select({ id: entities.id, entityData: entities.entityData })
      .from(entities)
      .where(and(eq(entities.projectId, projectId), eq(entities.collectionName, 'content'), notDeleted(), inArray(entities.id, ids)))
    const liveIds = new Set(live.map(r => r.id))
    if (liveIds.size === 0) return { targets: [], releasedIds: [], missingIds: ids }

    const pubs = await tx
      .select({ chapterId: chapterPublications.chapterId, isPublished: chapterPublications.isPublished })
      .from(chapterPublications)
      .where(and(eq(chapterPublications.projectId, projectId), inArray(chapterPublications.chapterId, [...liveIds])))
    const released = new Set(pubs.filter(p => p.isPublished).map(p => p.chapterId))
    const withRow = new Set(pubs.map(p => p.chapterId))

    const targets = live.filter(r => !released.has(r.id))
    const targetIds = targets.map(r => r.id)
    const toUpdate = targetIds.filter(id => withRow.has(id))
    const toInsert = targetIds.filter(id => !withRow.has(id))

    if (toUpdate.length > 0) {
      await tx
        .update(chapterPublications)
        .set({ betaShared: shared, updatedAt: new Date() })
        .where(and(eq(chapterPublications.projectId, projectId), inArray(chapterPublications.chapterId, toUpdate)))
    }
    if (toInsert.length > 0) {
      await tx.insert(chapterPublications).values(
        toInsert.map(chapterId => ({ projectId, chapterId, publishStatus: 'draft', isPublished: false, betaShared: shared })),
      )
    }

    return {
      targets,
      releasedIds: ids.filter(id => released.has(id)),
      missingIds: ids.filter(id => !liveIds.has(id)),
    }
  })

  // Beta readers follow a pretty URL like everyone else. Sequential and
  // non-fatal: the UUID URL always works, and slug claims must not race.
  if (shared) {
    for (const t of result.targets) {
      const title = (t.entityData as Record<string, unknown> | null)?.['title']
      try {
        await ensureCurrentSlug(projectId, t.id, typeof title === 'string' ? title : null)
      } catch {
        // swallowed on purpose; see above
      }
    }
  }

  return {
    updatedIds: result.targets.map(t => t.id),
    releasedIds: result.releasedIds,
    missingIds: result.missingIds,
  }
}
