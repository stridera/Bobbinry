/**
 * Entity change feed — write-time capture helpers.
 *
 * Every entity-mutating route records an append-only row in `entity_changes`
 * describing what changed (action, fields, word-count delta). The feed is
 * consumed via GET /api/projects/:projectId/changes with a `seq` cursor, so
 * external clients (sync bots, backups) no longer have to reconstruct "what
 * changed" from updatedAt polling.
 *
 * Usage:
 *  - Inside a transaction: `await recordEntityChanges(tx, events)` — the
 *    events commit atomically with the entity write. (A failed insert aborts
 *    the tx either way — Postgres poisons a transaction on any statement
 *    error — so there is no "safe" variant inside a tx.)
 *  - Outside a transaction: `await recordEntityChangesSafe(db, events)` — a
 *    feed failure is logged but never fails the user's save. Awaited so the
 *    event is durably recorded before the save is acknowledged (a response
 *    followed by a crash must not lose the event).
 *
 * Design notes / known limits:
 *  - This is a second channel beside serverEventBus (lib/event-bus.ts) on
 *    purpose: the bus is in-process fire-and-forget with error-swallowing
 *    handlers — fine for notifications, not durable enough to be a feed's
 *    source of truth.
 *  - Events are recorded under the *request's* project context. User- and
 *    collection-scoped entities (rare) edited from different projects will
 *    scatter their events across those projects' feeds.
 *  - Background jobs that stamp internal metadata into entityData (e.g.
 *    drive-sync's driveFileId/lastSyncedAt) intentionally do not record
 *    events — the feed covers author-visible changes.
 */

import { entityChanges } from '../db/schema'
import type { db } from '../db/connection'

/** Anything with Drizzle's `insert` — the db singleton or a transaction. */
type Executor = Pick<typeof db, 'insert'>

export type EntityChangeAction = 'created' | 'updated' | 'deleted'

export interface EntityChangeEvent {
  projectId: string
  entityId: string
  collection: string
  contentType?: string | null | undefined
  title?: string | null | undefined
  action: EntityChangeAction
  fieldsChanged?: string[] | undefined
  wordCountBefore?: number | null | undefined
  wordCountAfter?: number | null | undefined
  actor?: string | null | undefined
}

/** Keys that change on every save and carry no signal for feed consumers.
 * word_count is skipped here because it's reported via wordCountBefore/After. */
const VOLATILE_KEYS = new Set(['updated_at', 'created_at', 'word_count'])

/** Parse `word_count` out of an entityData blob. Stored as a jsonb number or
 * string depending on the writer — normalize to int, null if absent/invalid. */
export function extractWordCount(data: Record<string, unknown> | null | undefined): number | null {
  const raw = data?.['word_count']
  if (raw === undefined || raw === null) return null
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  return Number.isFinite(n) ? n : null
}

/** Best-effort display title from an entityData blob. */
export function extractTitle(data: Record<string, unknown> | null | undefined): string | null {
  const title = data?.['title'] ?? data?.['name']
  return typeof title === 'string' && title.length > 0 ? title : null
}

/**
 * Compare two entityData blobs and report which top-level keys changed,
 * plus the word-count transition. Volatile keys (timestamps, word_count)
 * are excluded from fieldsChanged. Non-primitive values are compared by
 * JSON serialization.
 *
 * Pass `null` for oldData on create (all keys count as changed) — deletes
 * don't diff at all (fieldsChanged stays empty).
 */
export function diffEntityData(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null
): { fieldsChanged: string[]; wordCountBefore: number | null; wordCountAfter: number | null } {
  const wordCountBefore = extractWordCount(oldData)
  const wordCountAfter = extractWordCount(newData)

  const fieldsChanged: string[] = []
  const keys = new Set([...Object.keys(oldData ?? {}), ...Object.keys(newData ?? {})])
  for (const key of keys) {
    if (VOLATILE_KEYS.has(key)) continue
    const oldVal = oldData?.[key]
    const newVal = newData?.[key]
    if (oldVal === newVal) continue
    if (
      oldVal !== undefined && newVal !== undefined &&
      typeof oldVal === 'object' && typeof newVal === 'object' &&
      JSON.stringify(oldVal) === JSON.stringify(newVal)
    ) continue
    fieldsChanged.push(key)
  }
  fieldsChanged.sort()

  return { fieldsChanged, wordCountBefore, wordCountAfter }
}

/** The single "does this diff deserve a feed event?" policy — a no-op
 * re-save (identical data) must stay invisible to feed consumers. */
export function hasChanges(diff: ReturnType<typeof diffEntityData>): boolean {
  return diff.fieldsChanged.length > 0 || diff.wordCountBefore !== diff.wordCountAfter
}

/** Build an event from a DB row shape (`.returning()` / `.select()` results).
 * The one place that maps row → event, so call sites can't drift on which
 * field feeds what. */
export function changeEventFromRow(
  action: EntityChangeAction,
  ctx: { projectId: string; actor?: string | null | undefined },
  row: {
    id: string
    collectionName?: string | null
    contentType?: string | null
    entityData?: unknown
  },
  extras?: Partial<EntityChangeEvent>
): EntityChangeEvent {
  const data = (row.entityData ?? null) as Record<string, unknown> | null
  return {
    projectId: ctx.projectId,
    entityId: row.id,
    collection: row.collectionName ?? 'content',
    contentType: row.contentType ?? null,
    title: extractTitle(data),
    action,
    ...(action === 'deleted' ? { wordCountBefore: extractWordCount(data) } : {}),
    actor: ctx.actor,
    ...extras,
  }
}

/** Insert change rows. Throws on failure — use inside transactions so the
 * events commit (or roll back) atomically with the entity write. */
export async function recordEntityChanges(executor: Executor, events: EntityChangeEvent[]): Promise<void> {
  if (events.length === 0) return
  await executor.insert(entityChanges).values(events.map(e => ({
    projectId: e.projectId,
    entityId: e.entityId,
    collection: e.collection,
    contentType: e.contentType ?? null,
    title: e.title ?? null,
    action: e.action,
    fieldsChanged: e.fieldsChanged ?? [],
    wordCountBefore: e.wordCountBefore ?? null,
    wordCountAfter: e.wordCountAfter ?? null,
    actor: e.actor ?? null,
  })))
}

/** Insert change rows outside a transaction: failures are logged, never
 * thrown — the change feed must not break a user's save. */
export async function recordEntityChangesSafe(executor: Executor, events: EntityChangeEvent[]): Promise<void> {
  try {
    await recordEntityChanges(executor, events)
  } catch (err) {
    console.error('[entity-changes] Failed to record change events:', err)
  }
}

// ---------------------------------------------------------------------------
// Read-side: coalescing
// ---------------------------------------------------------------------------

export interface RawChangeRow {
  seq: number
  entityId: string
  collection: string
  contentType: string | null
  title: string | null
  action: string
  fieldsChanged: string[] | null
  wordCountBefore: number | null
  wordCountAfter: number | null
  occurredAt: Date
}

export interface CoalescedChange {
  entityId: string
  collection: string
  contentType: string | null
  title: string | null
  action: EntityChangeAction
  fieldsChanged: string[]
  wordCountBefore: number | null
  wordCountAfter: number | null
  wordCountDelta: number | null
  eventCount: number
  firstAt: Date
  lastAt: Date
}

/**
 * Collapse raw event rows (seq-ascending) into one net change per entity.
 *
 * Net action: an entity's first event in the window decides created vs
 * updated (entity ids are UUIDs — a deleted id never comes back), and a
 * deleted event anywhere in the window wins.
 */
export function coalesceChanges(rows: RawChangeRow[]): CoalescedChange[] {
  const byEntity = new Map<string, CoalescedChange & { createdInWindow: boolean }>()

  for (const row of rows) {
    const existing = byEntity.get(row.entityId)
    if (!existing) {
      byEntity.set(row.entityId, {
        entityId: row.entityId,
        collection: row.collection,
        contentType: row.contentType,
        title: row.title,
        action: row.action as EntityChangeAction,
        fieldsChanged: [...(row.fieldsChanged ?? [])],
        wordCountBefore: row.wordCountBefore,
        wordCountAfter: row.wordCountAfter,
        wordCountDelta: null,
        eventCount: 1,
        firstAt: row.occurredAt,
        lastAt: row.occurredAt,
        createdInWindow: row.action === 'created',
      })
      continue
    }

    existing.eventCount++
    existing.lastAt = row.occurredAt
    existing.collection = row.collection
    if (row.contentType !== null) existing.contentType = row.contentType
    if (row.title !== null) existing.title = row.title
    for (const f of row.fieldsChanged ?? []) {
      if (!existing.fieldsChanged.includes(f)) existing.fieldsChanged.push(f)
    }
    // First non-null "before" is the window's starting point; latest non-null
    // "after" is where it ended up. Metadata-only events carry nulls and must
    // not clobber either.
    if (existing.wordCountBefore === null && row.wordCountBefore !== null) {
      existing.wordCountBefore = row.wordCountBefore
    }
    if (row.wordCountAfter !== null) existing.wordCountAfter = row.wordCountAfter

    if (row.action === 'deleted') {
      existing.action = 'deleted'
    } else if (existing.action !== 'deleted') {
      existing.action = existing.createdInWindow ? 'created' : 'updated'
    }
  }

  const out: CoalescedChange[] = []
  for (const change of byEntity.values()) {
    const { createdInWindow, ...rest } = change
    rest.fieldsChanged.sort()

    if (rest.action === 'deleted') {
      // The entity no longer exists: it has no "after". Its net word
      // contribution is −(what it held entering the window) — or exactly 0
      // when it was also created inside the window.
      rest.wordCountAfter = null
      rest.wordCountDelta = createdInWindow
        ? 0
        : rest.wordCountBefore !== null ? -rest.wordCountBefore : null
    } else {
      // An entity created inside the window has no "before" — every word in
      // it is new, even if later update events carried a wordCountBefore.
      if (createdInWindow) rest.wordCountBefore = null
      if (rest.wordCountBefore !== null || rest.wordCountAfter !== null) {
        rest.wordCountDelta = (rest.wordCountAfter ?? 0) - (rest.wordCountBefore ?? 0)
      }
    }
    out.push(rest)
  }
  return out
}
