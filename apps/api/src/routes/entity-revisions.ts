/**
 * Entity revision history.
 *
 *   GET  /api/entities/:entityId/revisions              — timeline (metadata only)
 *   GET  /api/entities/:entityId/revisions/:revisionId   — one snapshot's restorable fields
 *   POST /api/entities/:entityId/revisions               — manual checkpoint
 *   POST /api/entities/:entityId/revisions/:revisionId/restore
 *
 * Ownership is derived from the revision/entity row rather than a caller-
 * supplied projectId, so a caller cannot name someone else's project to reach
 * their history.
 */

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { and, desc, eq, lt } from 'drizzle-orm'
import { db } from '../db/connection'
import { entities, entityRevisions } from '../db/schema'
import { requireAuth, requireProjectOwnership, assertEntityScope } from '../middleware/auth'
import {
  actorKeyFor,
  captureRevision,
  restorableSubset,
  revisionById,
} from '../lib/entity-revisions'
import {
  changeEventFromRow,
  diffEntityData,
  recordEntityChanges,
} from '../lib/entity-changes'
import { countWordsFromHtml, htmlWordDelta } from '../lib/text'
import { notDeleted } from '../lib/entity-scope'
import { diffHtmlBodies } from '../lib/entity-diff'

/** Word delta between two possibly-absent bodies, as change-event fields. */
function htmlWordDeltaFor(before: unknown, after: unknown) {
  if (typeof after !== 'string') return {}
  const { added, removed } = htmlWordDelta(typeof before === 'string' ? before : '', after)
  return { wordsAdded: added, wordsRemoved: removed }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DiffQuerySchema = z.object({
  from: z.string().uuid(),
  // 'live' (default) diffs against the current entity; a revision id diffs
  // between two restore points.
  to: z.string().optional(),
  maxHunks: z.coerce.number().int().min(1).max(500).default(100),
})

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
})

const entityRevisionsPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * Load a live entity and confirm the caller owns its project.
   * Returns null after having already sent the response.
   */
  async function loadOwnedEntity(request: any, reply: any, entityId: string) {
    if (!UUID_RE.test(entityId)) {
      reply.status(404).send({ error: 'Entity not found' })
      return null
    }

    const [entity] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.id, entityId), notDeleted()))
      .limit(1)

    if (!entity) {
      reply.status(404).send({ error: 'Entity not found' })
      return null
    }
    if (!entity.projectId) {
      // Revisions are a manuscript feature; user- and collection-scoped rows
      // have no project to check ownership against.
      reply.status(404).send({ error: 'Entity not found' })
      return null
    }
    const hasAccess = await requireProjectOwnership(request, reply, entity.projectId)
    if (!hasAccess) return null

    return entity
  }

  /**
   * Timeline. Metadata only — never `snapshot`, which holds full chapter
   * bodies; a 100-revision list would otherwise be megabytes.
   */
  fastify.get<{ Params: { entityId: string }; Querystring: { limit?: number; before?: string } }>(
    '/entities/:entityId/revisions',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const entity = await loadOwnedEntity(request, reply, request.params.entityId)
        if (!entity) return
        if (!assertEntityScope(request, reply, entity.collectionName, 'read')) return

        const query = ListQuerySchema.parse(request.query)

        const conditions = [eq(entityRevisions.entityId, entity.id)]
        if (query.before) {
          conditions.push(lt(entityRevisions.sessionStartedAt, new Date(query.before)))
        }

        const rows = await db
          .select({
            id: entityRevisions.id,
            wordCount: entityRevisions.wordCount,
            entityVersion: entityRevisions.entityVersion,
            entityVersionEnd: entityRevisions.entityVersionEnd,
            label: entityRevisions.label,
            labelNote: entityRevisions.labelNote,
            isPinned: entityRevisions.isPinned,
            actorKey: entityRevisions.actorKey,
            sessionStartedAt: entityRevisions.sessionStartedAt,
            capturedAt: entityRevisions.capturedAt,
            saveCount: entityRevisions.saveCount,
          })
          .from(entityRevisions)
          .where(and(...conditions))
          .orderBy(desc(entityRevisions.sessionStartedAt), desc(entityRevisions.id))
          .limit(query.limit + 1)

        const hasMore = rows.length > query.limit
        const page = hasMore ? rows.slice(0, query.limit) : rows

        return {
          entityId: entity.id,
          currentVersion: entity.version,
          hasMore,
          revisions: page.map(r => ({
            ...r,
            // Each row is the state *before* the session it names, so the UI
            // should label it as a boundary, not as "the 14:00 version".
            describes: 'before' as const,
            sessionStartedAt: r.sessionStartedAt.toISOString(),
            capturedAt: r.capturedAt.toISOString(),
          })),
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: 'Invalid query', issues: error.issues })
        }
        fastify.log.error(error)
        return reply.status(500).send({ error: 'Failed to list revisions' })
      }
    }
  )

  /** One revision's restorable fields, for preview or diff. */
  fastify.get<{ Params: { entityId: string; revisionId: string } }>(
    '/entities/:entityId/revisions/:revisionId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const entity = await loadOwnedEntity(request, reply, request.params.entityId)
        if (!entity) return
        if (!assertEntityScope(request, reply, entity.collectionName, 'read')) return

        const revision = await revisionById(db, entity.id, request.params.revisionId)
        if (!revision) {
          return reply.status(404).send({
            error: 'Restore point not found. It may have been removed by retention.',
            code: 'REVISION_PRUNED',
          })
        }

        return {
          id: revision.id,
          entityId: revision.entityId,
          data: restorableSubset(revision.snapshot as Record<string, unknown>),
          wordCount: revision.wordCount,
          entityVersion: revision.entityVersion,
          label: revision.label,
          labelNote: revision.labelNote,
          sessionStartedAt: revision.sessionStartedAt.toISOString(),
          capturedAt: revision.capturedAt.toISOString(),
          saveCount: revision.saveCount,
        }
      } catch (error) {
        fastify.log.error(error)
        return reply.status(500).send({ error: 'Failed to load revision' })
      }
    }
  )

  /**
   * What actually changed, in prose.
   *
   *   GET /entities/:id/diff?from=<revisionId>&to=<revisionId|live>
   *
   * This is the endpoint a daily-report bot calls after the change feed tells
   * it a chapter had a revision pass. Because revisions snapshot the state
   * *before* their session, `from=<revisionIdFirst>&to=live` is exactly "what
   * changed since you last looked" with nothing to reconstruct.
   *
   * Pull-based on purpose: the Myers diff behind it is far too expensive to run
   * on every autosave, and a feed carrying prose hunks for thousands of events
   * would be enormous. Here it runs for one chapter, on request.
   */
  fastify.get<{
    Params: { entityId: string }
    Querystring: { from: string; to?: string; maxHunks?: number }
  }>(
    '/entities/:entityId/diff',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const entity = await loadOwnedEntity(request, reply, request.params.entityId)
        if (!entity) return
        if (!assertEntityScope(request, reply, entity.collectionName, 'read')) return

        const query = DiffQuerySchema.parse(request.query)

        const from = await revisionById(db, entity.id, query.from)
        if (!from) {
          return reply.status(404).send({
            error: 'Restore point not found. It may have been removed by retention.',
            code: 'REVISION_PRUNED',
          })
        }

        const liveData = entity.entityData as Record<string, unknown>
        let afterBody: unknown = liveData['body']
        let toMeta: Record<string, unknown> = { live: true, version: entity.version }

        if (query.to && query.to !== 'live') {
          const to = await revisionById(db, entity.id, query.to)
          if (!to) {
            return reply.status(404).send({
              error: 'Restore point not found. It may have been removed by retention.',
              code: 'REVISION_PRUNED',
            })
          }
          afterBody = (to.snapshot as Record<string, unknown>)['body']
          toMeta = {
            live: false,
            revisionId: to.id,
            sessionStartedAt: to.sessionStartedAt.toISOString(),
          }
        }

        const beforeBody = (from.snapshot as Record<string, unknown>)['body']
        const diff = diffHtmlBodies(
          typeof beforeBody === 'string' ? beforeBody : '',
          typeof afterBody === 'string' ? afterBody : '',
          { maxHunks: query.maxHunks },
        )

        return {
          entityId: entity.id,
          title: (liveData['title'] as string) ?? null,
          from: {
            revisionId: from.id,
            sessionStartedAt: from.sessionStartedAt.toISOString(),
            label: from.label,
          },
          to: toMeta,
          ...diff,
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ error: 'Invalid query', issues: error.issues })
        }
        fastify.log.error(error)
        return reply.status(500).send({ error: 'Failed to diff revisions' })
      }
    }
  )

  /** Pin the current state as a named checkpoint. Never coalesced or thinned. */
  fastify.post<{ Params: { entityId: string }; Body: { note?: string } }>(
    '/entities/:entityId/revisions',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const entity = await loadOwnedEntity(request, reply, request.params.entityId)
        if (!entity) return
        if (!assertEntityScope(request, reply, entity.collectionName, 'write')) return

        const note = typeof request.body?.note === 'string' ? request.body.note.slice(0, 500) : null

        await captureRevision(db, {
          projectId: entity.projectId,
          entityId: entity.id,
          collection: entity.collectionName,
          contentType: entity.contentType,
          snapshot: entity.entityData as Record<string, unknown>,
          entityVersion: entity.version,
          entityVersionEnd: entity.version,
          actorKey: actorKeyFor(request),
          label: 'manual',
          labelNote: note,
        })

        return reply.status(201).send({ created: true })
      } catch (error) {
        fastify.log.error(error)
        return reply.status(500).send({ error: 'Failed to create checkpoint' })
      }
    }
  )

  /**
   * Restore a revision's text onto the live entity.
   *
   * This is an ordinary edit, deliberately: it goes forward through the same
   * optimistic-lock CAS the editor uses, so an open editor 409s and resyncs
   * rather than silently overwriting the restore a second later with its
   * pending autosave. It never rewinds `version`.
   */
  fastify.post<{
    Params: { entityId: string; revisionId: string }
    Body: { expectedVersion?: number }
  }>(
    '/entities/:entityId/revisions/:revisionId/restore',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const entity = await loadOwnedEntity(request, reply, request.params.entityId)
        if (!entity) return
        if (!assertEntityScope(request, reply, entity.collectionName, 'write')) return

        const projectId = entity.projectId!
        const userId = request.user!.id
        const expectedVersion = request.body?.expectedVersion
        const actorKey = actorKeyFor(request)

        const outcome = await db.transaction(async (tx) => {
          // Lock the live row: restore is rare, so correctness beats concurrency.
          const [live] = await tx
            .select()
            .from(entities)
            .where(and(eq(entities.id, entity.id), notDeleted()))
            .for('update')
            .limit(1)

          if (!live) return { status: 404 as const, body: { error: 'Entity not found' } }

          if (expectedVersion !== undefined && live.version !== expectedVersion) {
            return {
              status: 409 as const,
              body: {
                error: 'Conflict: entity was modified by another session',
                currentVersion: live.version,
                expectedVersion,
              },
            }
          }

          const revision = await revisionById(tx, entity.id, request.params.revisionId)
          if (!revision) {
            return {
              status: 404 as const,
              body: {
                error: 'Restore point not found. It may have been removed by retention.',
                code: 'REVISION_PRUNED',
              },
            }
          }

          const liveData = live.entityData as Record<string, unknown>

          // Checkpoint the current state first — this is what makes the restore
          // itself undoable. Labeled, so it never coalesces into a session
          // bucket and is never thinned away.
          await captureRevision(tx, {
            projectId,
            entityId: live.id,
            collection: live.collectionName,
            contentType: live.contentType,
            snapshot: liveData,
            entityVersion: live.version,
            entityVersionEnd: live.version + 1,
            actorKey,
            label: 'pre_restore',
            labelNote: `Before restoring ${revision.sessionStartedAt.toISOString()}`,
          })

          // Allowlist merge: structural and publish state keeps its live value.
          const merged: Record<string, unknown> = {
            ...liveData,
            ...restorableSubset(revision.snapshot as Record<string, unknown>),
            updated_at: new Date().toISOString(),
          }
          // Recompute rather than trusting the snapshot's stored count — it may
          // predate a tokenizer change.
          if (live.collectionName === 'content' && typeof merged['body'] === 'string') {
            merged['word_count'] = countWordsFromHtml(merged['body'] as string)
          }

          const [updated] = await tx
            .update(entities)
            .set({
              entityData: merged,
              version: live.version + 1,
              updatedAt: new Date(),
              lastEditedAt: new Date(),
              lastEditedBy: userId,
            })
            .where(and(eq(entities.id, live.id), eq(entities.version, live.version)))
            .returning()

          if (!updated) {
            return {
              status: 409 as const,
              body: { error: 'Conflict: entity was modified by another session', currentVersion: live.version + 1 },
            }
          }

          const diff = diffEntityData(liveData, merged)
          await recordEntityChanges(tx, [
            changeEventFromRow('updated', { projectId, actor: userId }, updated, {
              fieldsChanged: diff.fieldsChanged,
              wordCountBefore: diff.wordCountBefore,
              wordCountAfter: diff.wordCountAfter,
              ...htmlWordDeltaFor(liveData['body'], merged['body']),
              // Without this a restore is an `updated` with fieldsChanged
              // ['body'] and a large delta — indistinguishable from a paste.
              source: 'restore',
            }),
          ])

          return { status: 200 as const, body: { updated, restoredFrom: revision.id } }
        })

        if (outcome.status !== 200) {
          return reply.status(outcome.status).send(outcome.body)
        }

        const updated = (outcome.body as any).updated as typeof entities.$inferSelect
        // The full entity plus its new version: an editor that restores must
        // adopt this version, or its in-flight autosave overwrites the restore
        // a second later.
        return {
          id: updated.id,
          ...(updated.entityData as object),
          restoredFrom: (outcome.body as any).restoredFrom,
          _meta: {
            bobbinId: updated.bobbinId,
            collection: updated.collectionName,
            scope: updated.scope,
            version: updated.version,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
          },
        }
      } catch (error) {
        fastify.log.error(error)
        return reply.status(500).send({ error: 'Failed to restore revision' })
      }
    }
  )
}

export default entityRevisionsPlugin
