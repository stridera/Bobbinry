/**
 * Entity change feed API
 *
 * GET /api/projects/:projectId/changes — cursor-based feed of entity changes,
 * recorded at write time by lib/entity-changes.ts. External clients (sync
 * bots, backups) poll this instead of reconstructing "what changed" from
 * updatedAt timestamps.
 *
 * Cursor semantics (Stripe-events style):
 *  - `seq` is a monotonic bigserial. Clients store the returned `cursor` and
 *    pass it back as `?since=<cursor>` on the next poll.
 *  - No `since` param → bootstrap: returns the current cursor and no changes.
 *    Do a normal full fetch once, then poll from that cursor.
 *  - By default events are COALESCED per entity: one entry per entity with
 *    the net action, the union of changed fields, and the net word-count
 *    delta across the window (autosave noise collapses to one entry).
 *    `?coalesce=false` returns the raw event rows instead.
 *
 * Commit-visibility safety: bigserial seqs are allocated before commit, so a
 * slow transaction's events can become visible AFTER a higher seq is already
 * readable. If the cursor jumped straight to MAX(seq), those late-committing
 * events would land behind it and be lost forever. The high-water mark is
 * therefore capped to rows older than a safety horizon (writer transactions
 * stamp occurred_at at tx start and are expected to commit well within it) —
 * the feed simply doesn't serve the last few seconds of activity.
 */

import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/connection'
import { entityChanges } from '../db/schema'
import { eq, and, gt, lte, sql, asc } from 'drizzle-orm'
import { requireAuth, requireProjectOwnership, requireScope } from '../middleware/auth'
import { coalesceChanges } from '../lib/entity-changes'

const ChangesParamsSchema = z.object({
  projectId: z.string().uuid('Invalid project ID format'),
})

const ChangesQuerySchema = z.object({
  since: z.coerce.number().int().min(0).optional(),
  collection: z.string().max(100).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  coalesce: z
    .enum(['true', 'false'])
    .default('true')
    .transform(v => v === 'true'),
  limit: z.coerce.number().int().min(1).max(5000).default(5000),
})

/** How old a row must be before the cursor may advance past it (see header).
 * Overridable for tests; 0 disables the horizon. */
function horizonMs(): number {
  const raw = process.env.ENTITY_CHANGES_HORIZON_MS
  if (raw !== undefined) return Math.max(0, Number(raw) || 0)
  return process.env.NODE_ENV === 'test' ? 0 : 15_000
}

const entityChangesPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Params: { projectId: string }
    Querystring: {
      since?: string
      collection?: string
      coalesce?: string
      limit?: string
    }
  }>('/projects/:projectId/changes', {
    preHandler: [requireAuth, requireScope('projects:read')],
  }, async (request, reply) => {
    try {
      const { projectId } = ChangesParamsSchema.parse(request.params)
      const query = ChangesQuerySchema.parse(request.query)

      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      // High-water mark, capped to the safety horizon: everything <= maxSeq
      // is durably visible, so a cursor of maxSeq can never strand a
      // late-committing event behind itself.
      const horizonCond = horizonMs() > 0
        ? sql`${entityChanges.occurredAt} <= now() - make_interval(secs => ${horizonMs() / 1000})`
        : undefined
      const [maxRow] = await db
        .select({ maxSeq: sql<string | null>`MAX(${entityChanges.seq})::text` })
        .from(entityChanges)
        .where(and(eq(entityChanges.projectId, projectId), horizonCond))
      const maxSeq = maxRow?.maxSeq ? Number(maxRow.maxSeq) : 0

      // Bootstrap: no cursor yet. Hand back the current high-water mark; the
      // client does its usual full fetch once and polls from here on.
      if (query.since === undefined) {
        return query.coalesce
          ? { cursor: maxSeq, hasMore: false, changes: [] }
          : { cursor: maxSeq, hasMore: false, events: [] }
      }

      const conditions = [
        eq(entityChanges.projectId, projectId),
        gt(entityChanges.seq, query.since),
        lte(entityChanges.seq, maxSeq),
      ]
      if (query.collection) {
        conditions.push(eq(entityChanges.collection, query.collection))
      }

      // limit+1 to detect truncation without a COUNT.
      const rows = await db
        .select()
        .from(entityChanges)
        .where(and(...conditions))
        .orderBy(asc(entityChanges.seq))
        .limit(query.limit + 1)

      const hasMore = rows.length > query.limit
      const page = hasMore ? rows.slice(0, query.limit) : rows
      // When truncated, the cursor stops at the last scanned event so the
      // next page picks up exactly there; otherwise it jumps to the
      // high-water mark (skipping any collection-filtered rows for good).
      const cursor = hasMore ? page[page.length - 1]!.seq : Math.max(maxSeq, query.since)

      if (!query.coalesce) {
        return {
          cursor,
          hasMore,
          events: page.map(row => ({
            seq: row.seq,
            entityId: row.entityId,
            collection: row.collection,
            contentType: row.contentType,
            title: row.title,
            action: row.action,
            fieldsChanged: row.fieldsChanged ?? [],
            wordCountBefore: row.wordCountBefore,
            wordCountAfter: row.wordCountAfter,
            actor: row.actor,
            occurredAt: row.occurredAt,
          })),
        }
      }

      const changes = coalesceChanges(page)
      return { cursor, hasMore, changes }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          issues: error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        })
      }
      fastify.log.error(error)
      return reply.status(500).send({
        error: 'Failed to fetch changes',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })
}

export default entityChangesPlugin
