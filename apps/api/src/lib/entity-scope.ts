/**
 * Trash-awareness helpers for queries against `entities`.
 *
 * `entities.deleted_at` is a soft delete: the row stays in place so its
 * comments, annotations, publications and slugs survive the 30-day trash
 * window and come back intact on restore. The cost of that choice is that
 * every read path must exclude trashed rows explicitly — a missed filter means
 * a chapter the author deleted stays visible in the public reader, an export,
 * a word count, or a backup sweep.
 *
 * Two places to reach for:
 *  - `buildScopeCondition()` (lib/effective-bobbins.ts) already ANDs
 *    `notDeleted()` in, and covers the scoped read paths.
 *  - `notDeleted()` / `liveEntity()` here for everything else — the public
 *    reader, jobs, publishing, exports.
 *
 * `__tests__/integration/trash-visibility.test.ts` is the backstop: it trashes
 * a chapter and asserts every read surface hides it. Add a case there when you
 * add a read surface.
 */

import { and, eq, isNull, type SQL } from 'drizzle-orm'
import { entities } from '../db/schema'

/**
 * How long trashed rows survive before the purge job removes them for good.
 *
 * One constant for entities, projects and collections: they all surface in the
 * same trash UI, and a user looking at a mixed list should not have to learn
 * that chapters expire on a different clock than the project holding them.
 */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** When a row trashed at `deletedAt` will be purged. */
export function autoDeleteAt(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + TRASH_RETENTION_MS)
}

/** `entities.deleted_at IS NULL` — the live-row predicate. */
export function notDeleted(): SQL {
  return isNull(entities.deletedAt)!
}

/** Match one live entity by id. Trashed rows do not match, so callers 404. */
export function liveEntity(entityId: string): SQL {
  return and(eq(entities.id, entityId), notDeleted())!
}

/** AND `deleted_at IS NULL` onto an existing condition. */
export function andNotDeleted(condition: SQL | undefined): SQL {
  return condition ? and(condition, notDeleted())! : notDeleted()
}

/** Match one live entity within a project. */
export function liveProjectEntity(projectId: string, entityId: string): SQL {
  return and(
    eq(entities.projectId, projectId),
    eq(entities.id, entityId),
    notDeleted(),
  )!
}
