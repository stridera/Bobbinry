/**
 * Entity revisions — capture and restore.
 *
 * Autosave overwrites `entities.entity_data` in place, so before this existed
 * an author who broke a chapter and kept typing had no way back. Revisions add
 * restore points without turning every keystroke into a row.
 *
 * ## The session window
 *
 * Saves are bucketed by wall clock (`date_bin`, 15 minutes by default). The
 * first save in a bucket inserts a row holding the entity's state *before* that
 * save; every later save in the same bucket by the same actor collapses onto
 * that row via a partial unique index, bumping only `captured_at`,
 * `save_count` and `entity_version_end`.
 *
 * Three deliberate choices, each of which has a wrong-looking alternative:
 *
 *  - **Fixed buckets, not a sliding window.** "Newest revision younger than
 *    15 minutes" never closes during a three-hour session with 30-second
 *    autosaves, so it would produce exactly one revision for the whole
 *    session — losing the most history for whoever is writing the most. Fixed
 *    buckets guarantee a restore point every 15 minutes of active writing.
 *
 *  - **The bucket is computed in SQL.** `Math.floor(Date.now()/900_000)` in TS
 *    lets two machines a few seconds apart straddle a boundary and write two
 *    rows for one session.
 *
 *  - **Snapshot the old value, not the new.** Storing the post-save state would
 *    rewrite the full ~10KB TOAST chain on every autosave. Storing the
 *    pre-session state means that write happens once per window and the rest
 *    are ~100-byte HOT updates to inline, non-indexed columns. It also makes
 *    the first-ever save recoverable, and makes `diff(revision -> live)`
 *    exactly "what changed since then".
 *
 * A revision is therefore a *boundary*: "what this looked like before the
 * session starting at 14:00". Restoring the newest one undoes the current
 * session, which is the overwhelmingly common ask.
 */

import { createHash } from 'crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { entityRevisions } from '../db/schema'
import type { db } from '../db/connection'
import { countWordsFromHtml } from './text'

type Executor = Pick<typeof db, 'insert' | 'select' | 'update' | 'delete'>

/** Checkpoint kinds. Labeled rows never coalesce and are never thinned. */
export type RevisionLabel =
  | 'publish'
  | 'import'
  | 'search_replace'
  | 'pre_restore'
  | 'manual'
  | 'system'

/**
 * Fields a restore writes back.
 *
 * entity_data also carries `order`, `container_id`, `_variants`, `status` and
 * publish flags. "Restore yesterday's text" must not also move the chapter back
 * to position 3 or revert its variant configuration, so structural state always
 * keeps its live value.
 */
export const RESTORABLE_FIELDS = ['body', 'title', 'notes', 'synopsis'] as const

/**
 * Session window length. Overridable so integration tests can force a bucket
 * rollover without sleeping for fifteen minutes — mirroring
 * ENTITY_CHANGES_HORIZON_MS in the change feed.
 */
export function revisionWindowMs(): number {
  const raw = process.env['REVISION_WINDOW_MS']
  if (raw !== undefined) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 15 * 60 * 1000
}

/**
 * Which writer this is — the *key*, not just the user behind it.
 *
 * A sync bot and its owner must not share a session window: folding the bot's
 * writes into the human's open bucket would overwrite nothing, but it would
 * mean no revision boundary exists at the moment the bot touched the chapter —
 * losing the single most useful restore point in that scenario.
 */
export function actorKeyFor(request: FastifyRequest): string {
  if (request.apiKeyAuth && request.apiKeyId) return `apikey:${request.apiKeyId}`
  return `user:${request.user?.id ?? 'unknown'}`
}

/** Pick the restorable subset out of an entity_data blob. */
export function restorableSubset(data: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of RESTORABLE_FIELDS) {
    if (data?.[field] !== undefined) out[field] = data[field]
  }
  return out
}

/**
 * Content hash over the restorable subset only, with fixed key order.
 *
 * Hashing the whole blob would include `updated_at`, which changes on every
 * save, so no two revisions would ever compare equal and the thinning job's
 * duplicate collapse would never fire.
 */
export function revisionContentHash(data: Record<string, unknown> | null | undefined): string {
  const subset = restorableSubset(data)
  const ordered = RESTORABLE_FIELDS.map(f => [f, subset[f] ?? null])
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex')
}

/** Does a change to these fields deserve a restore point? */
export function touchesRestorableField(fieldsChanged: readonly string[]): boolean {
  return fieldsChanged.some(f => (RESTORABLE_FIELDS as readonly string[]).includes(f))
}

export interface CaptureRevisionInput {
  projectId: string | null
  entityId: string
  collection: string
  contentType?: string | null
  /** The entity_data as it was BEFORE this save. */
  snapshot: Record<string, unknown>
  /** entities.version the snapshot represents. */
  entityVersion: number
  /** entities.version after the save that triggered this capture. */
  entityVersionEnd: number
  actorKey: string
  label?: RevisionLabel | null
  labelNote?: string | null
}

/**
 * Record a restore point.
 *
 * Unlabeled captures upsert onto the actor's open session bucket; labeled ones
 * always insert. One statement either way — no read-before-write, and the
 * uniqueness guarantee lives in the index rather than in a check-then-act race.
 */
export async function captureRevision(executor: Executor, input: CaptureRevisionInput): Promise<string | null> {
  const labeled = input.label != null
  const windowMs = revisionWindowMs()

  const body = typeof input.snapshot['body'] === 'string' ? (input.snapshot['body'] as string) : null
  const wordCount = body !== null ? countWordsFromHtml(body) : null

  // date_bin needs an interval; build it from the (test-overridable) window.
  const bucket = labeled
    ? sql`NULL`
    : sql`date_bin(${`${Math.max(1, Math.round(windowMs / 1000))} seconds`}::interval, now(), timestamptz 'epoch')`

  const [row] = await executor
    .insert(entityRevisions)
    .values({
      projectId: input.projectId,
      entityId: input.entityId,
      collection: input.collection,
      contentType: input.contentType ?? null,
      snapshot: input.snapshot,
      contentHash: revisionContentHash(input.snapshot),
      wordCount,
      entityVersion: input.entityVersion,
      entityVersionEnd: input.entityVersionEnd,
      label: input.label ?? null,
      labelNote: input.labelNote ?? null,
      actorKey: input.actorKey,
      sessionBucket: bucket as any,
    })
    .onConflictDoUpdate({
      target: [entityRevisions.entityId, entityRevisions.actorKey, entityRevisions.sessionBucket],
      targetWhere: sql`${entityRevisions.sessionBucket} IS NOT NULL`,
      set: {
        capturedAt: sql`now()`,
        saveCount: sql`${entityRevisions.saveCount} + 1`,
        entityVersionEnd: input.entityVersionEnd,
        // snapshot, contentHash, wordCount and sessionStartedAt are deliberately
        // untouched: the row must keep describing the state at the *start* of
        // the session, and leaving the toasted column alone is what keeps these
        // updates cheap.
      },
    })
    // The id of the row this save belongs to — the same row for every save in
    // the window, which is exactly the "state before this window" handle a
    // feed consumer needs to ask what changed.
    .returning({ id: entityRevisions.id })

  return row?.id ?? null
}

/**
 * Capture outside a transaction: failures are logged, never thrown.
 *
 * Same discipline as recordEntityChangesSafe — losing a restore point is bad,
 * losing the author's save because we failed to record one is worse.
 */
export async function captureRevisionSafe(executor: Executor, input: CaptureRevisionInput): Promise<string | null> {
  try {
    return await captureRevision(executor, input)
  } catch (err) {
    console.error('[entity-revisions] Failed to capture revision:', err)
    return null
  }
}

/** Newest revision for an entity, or null. */
export async function latestRevision(executor: Executor, entityId: string) {
  const [row] = await executor
    .select()
    .from(entityRevisions)
    .where(eq(entityRevisions.entityId, entityId))
    .orderBy(sql`${entityRevisions.sessionStartedAt} DESC, ${entityRevisions.id} DESC`)
    .limit(1)
  return row ?? null
}

/** One revision by id, scoped to its entity so ids can't be probed across entities. */
export async function revisionById(executor: Executor, entityId: string, revisionId: string) {
  const [row] = await executor
    .select()
    .from(entityRevisions)
    .where(and(eq(entityRevisions.id, revisionId), eq(entityRevisions.entityId, entityId)))
    .limit(1)
  return row ?? null
}
