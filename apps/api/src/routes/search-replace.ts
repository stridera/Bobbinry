import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { and, eq, inArray, notInArray } from 'drizzle-orm'
import { db } from '../db/connection'
import { entities } from '../db/schema'
import { requireAuth, requireProjectOwnership, assertEntityScope } from '../middleware/auth'
import { getCollectionIdsForProject, buildScopeCondition } from '../lib/effective-bobbins'
import { serverEventBus, contentEdited } from '../lib/event-bus'
import {
  findInEntity,
  replaceInEntity,
  parseMatchId,
  SEARCHABLE_BOBBIN_IDS,
  SKIPPED_COLLECTIONS,
  type SearchOptions,
  type EntityMatch,
} from '../lib/search-replace'

/** Mirror of the helper in routes/entities.ts. Strip tags, split on whitespace.
 * Kept inline rather than imported so we don't introduce a cyclic dependency. */
function countWordsFromHtml(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ')
  const words = text.split(/\s+/).filter(w => w.length > 0)
  return words.length
}

const ScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project') }),
  z.object({ type: z.literal('chapter'), chapterId: z.string().uuid('Invalid chapter ID') }),
])

const PreviewBodySchema = z.object({
  query: z.string().min(1, 'Query is required').max(500, 'Query too long'),
  caseSensitive: z.boolean().default(false),
  wholeWord: z.boolean().default(false),
  scope: ScopeSchema,
  /** Restrict the scan to a subset of the searchable bobbins (e.g. just 'entities'). */
  bobbinIds: z.array(z.enum(SEARCHABLE_BOBBIN_IDS)).min(1).optional(),
})

const ApplyBodySchema = z.object({
  query: z.string().min(1).max(500),
  caseSensitive: z.boolean().default(false),
  wholeWord: z.boolean().default(false),
  replacement: z.string().max(500),
  scope: ScopeSchema,
  selectedMatchIds: z.array(z.string()).min(1, 'At least one match must be selected').max(5000),
  entityVersions: z.record(z.string(), z.number().int().nonnegative()),
})

const PathParamsSchema = z.object({
  projectId: z.string().uuid('Invalid project ID format'),
})

const MAX_MATCHES_PER_PROJECT = 5000

const searchReplacePlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Params: { projectId: string }
    Body: z.infer<typeof PreviewBodySchema>
  }>('/projects/:projectId/search-replace/preview', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    try {
      const { projectId } = PathParamsSchema.parse(request.params)
      const body = PreviewBodySchema.parse(request.body)

      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      // We touch both 'content' (manuscript) and entity-type collections, so
      // require read scope for both buckets.
      if (!assertEntityScope(request, reply, 'content', 'read')) return
      if (!assertEntityScope(request, reply, 'character', 'read')) return

      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)

      let where = and(
        scopeFilter,
        inArray(entities.bobbinId, body.bobbinIds ?? [...SEARCHABLE_BOBBIN_IDS]),
        notInArray(entities.collectionName, [...SKIPPED_COLLECTIONS]),
      )

      if (body.scope.type === 'chapter') {
        where = and(
          where,
          eq(entities.id, body.scope.chapterId),
          eq(entities.collectionName, 'content'),
        )
      }

      const rows = await db.select().from(entities).where(where)

      const opts: SearchOptions = {
        query: body.query,
        caseSensitive: body.caseSensitive,
        wholeWord: body.wholeWord,
      }

      const matches: EntityMatch[] = []
      const entityVersions: Record<string, number> = {}
      const entityTitles: Record<string, string> = {}
      let truncated = false

      for (const row of rows) {
        const data = (row.entityData ?? {}) as Record<string, unknown>
        const found = findInEntity(row.id, row.collectionName, data, opts)
        if (found.length === 0) continue
        entityVersions[row.id] = row.version
        const title = data.title ?? data.name
        if (typeof title === 'string' && title) entityTitles[row.id] = title
        for (const m of found) {
          if (matches.length >= MAX_MATCHES_PER_PROJECT) {
            truncated = true
            break
          }
          matches.push(m)
        }
        if (truncated) break
      }

      return { matches, entityVersions, entityTitles, truncated }
    } catch (error) {
      fastify.log.error(error)
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          issues: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
        })
      }
      return reply.status(500).send({
        error: 'Failed to preview search',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  fastify.post<{
    Params: { projectId: string }
    Body: z.infer<typeof ApplyBodySchema>
  }>('/projects/:projectId/search-replace/apply', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    try {
      const { projectId } = PathParamsSchema.parse(request.params)
      const body = ApplyBodySchema.parse(request.body)

      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      if (!assertEntityScope(request, reply, 'content', 'write')) return
      if (!assertEntityScope(request, reply, 'character', 'write')) return

      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)

      // Group selectedMatchIds by entityId → field → set of indices.
      const selectionsByEntity = new Map<string, Map<string, Set<number>>>()
      const malformed: string[] = []
      for (const id of body.selectedMatchIds) {
        const parsed = parseMatchId(id)
        if (!parsed) {
          malformed.push(id)
          continue
        }
        let perField = selectionsByEntity.get(parsed.entityId)
        if (!perField) {
          perField = new Map()
          selectionsByEntity.set(parsed.entityId, perField)
        }
        let set = perField.get(parsed.field)
        if (!set) {
          set = new Set()
          perField.set(parsed.field, set)
        }
        set.add(parsed.index)
      }

      const entityIds = [...selectionsByEntity.keys()]
      if (entityIds.length === 0) {
        return reply.status(400).send({ error: 'No valid match ids provided', malformed })
      }

      let where = and(
        scopeFilter,
        inArray(entities.bobbinId, [...SEARCHABLE_BOBBIN_IDS]),
        notInArray(entities.collectionName, [...SKIPPED_COLLECTIONS]),
        inArray(entities.id, entityIds),
      )
      if (body.scope.type === 'chapter') {
        where = and(
          where,
          eq(entities.id, body.scope.chapterId),
          eq(entities.collectionName, 'content'),
        )
      }

      const rows = await db.select().from(entities).where(where)
      const rowsById = new Map(rows.map(r => [r.id, r]))

      const opts: SearchOptions = {
        query: body.query,
        caseSensitive: body.caseSensitive,
        wholeWord: body.wholeWord,
      }

      const stale: string[] = []
      const notFound: string[] = []
      const applied: string[] = []
      const appliedMatchIds: string[] = []

      await db.transaction(async (tx) => {
        for (const entityId of entityIds) {
          const row = rowsById.get(entityId)
          if (!row) {
            notFound.push(entityId)
            continue
          }
          const expected = body.entityVersions[entityId]
          if (typeof expected === 'number' && row.version !== expected) {
            stale.push(entityId)
            continue
          }

          const selections = selectionsByEntity.get(entityId)!
          const data = (row.entityData ?? {}) as Record<string, unknown>
          const { data: nextData, touchedFields } = replaceInEntity(
            row.collectionName,
            data,
            opts,
            body.replacement,
            selections,
          )

          if (touchedFields.length === 0) {
            // The selected match indices no longer point at real matches —
            // treat as stale rather than silently no-op.
            stale.push(entityId)
            continue
          }

          // Refresh chapter word count when the body was touched.
          if (row.collectionName === 'content' && touchedFields.includes('body')) {
            const newBody = nextData.body
            if (typeof newBody === 'string') {
              nextData.word_count = countWordsFromHtml(newBody)
            }
          }
          nextData.updated_at = new Date().toISOString()

          const updateResult = await tx
            .update(entities)
            .set({
              entityData: nextData,
              version: row.version + 1,
              updatedAt: new Date(),
            })
            .where(and(
              eq(entities.id, entityId),
              eq(entities.version, row.version),
            ))
            .returning({ id: entities.id })

          if (updateResult.length === 0) {
            stale.push(entityId)
            continue
          }

          applied.push(entityId)
          for (const [field, indices] of selections) {
            for (const idx of indices) {
              appliedMatchIds.push(`${entityId}:${field}:${idx}`)
            }
          }
          serverEventBus.fire(contentEdited(projectId, entityId, userId, row.collectionName))
        }
      })

      return {
        applied,
        appliedMatchIds,
        stale,
        notFound,
        malformed,
      }
    } catch (error) {
      fastify.log.error(error)
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          issues: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
        })
      }
      return reply.status(500).send({
        error: 'Failed to apply replacements',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })
}

export default searchReplacePlugin
