/**
 * Entity Publish & Reorder API
 *
 * Dedicated endpoints for the reader-publish state on entities and entity-type
 * definitions. These live alongside the main entities + entity-types routes
 * but are separate so the optimistic-locking-heavy PUT flow for entityData
 * stays untouched.
 *
 * - PATCH /entities/:entityId/publish
 * - PATCH /projects/:projectId/entity-types/:typeId/publish
 * - POST  /projects/:projectId/entities/reorder
 * - POST  /projects/:projectId/entity-types/reorder
 */

import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/connection'
import { entities, subscriptionTiers, projects } from '../db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { requireAuth, requireProjectOwnership, requireScope } from '../middleware/auth'
import { getCollectionIdsForProject, buildScopeCondition } from '../lib/effective-bobbins'

const TYPE_DEF_COLLECTION = 'entity_type_definitions'

const TYPE_ID_RE = /^[a-z][a-z0-9_]{0,63}$/
const COLLECTION_RE = /^[a-zA-Z0-9_-]+$/

const PublishPatchBody = z.object({
  isPublished: z.boolean().optional(),
  publishOrder: z.number().int().optional(),
  minimumTierLevel: z.number().int().min(0).optional(),
  publishBase: z.boolean().optional(),
  publishedVariantIds: z.array(z.string().min(1).max(200)).max(500).optional(),
  // Map of variant id ('__base__' for the base view) to min tier level.
  // Replaces the stored map when provided.
  variantAccessLevels: z.record(z.string().min(1).max(200), z.number().int().min(0)).optional(),
}).refine(
  b =>
    b.isPublished !== undefined ||
    b.publishOrder !== undefined ||
    b.minimumTierLevel !== undefined ||
    b.publishBase !== undefined ||
    b.publishedVariantIds !== undefined ||
    b.variantAccessLevels !== undefined,
  { message: 'At least one publish field is required' }
)

const EntityPublishPatch = PublishPatchBody.and(z.object({
  projectId: z.string().uuid(),
  collection: z.string().regex(COLLECTION_RE).max(100),
}))

const ReorderEntitiesBody = z.object({
  collection: z.string().regex(COLLECTION_RE).max(100),
  orderedIds: z.array(z.string().uuid()).min(1).max(1000),
})

const ReorderTypesBody = z.object({
  orderedTypeIds: z.array(z.string().regex(TYPE_ID_RE)).min(1).max(200),
})

/**
 * Validate that a requested minimumTierLevel exists among the project owner's
 * subscription tiers. 0 is always valid (public).
 */
async function validateTierLevel(projectId: string, level: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (level === 0) return { ok: true }

  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) return { ok: false, error: 'Project not found' }

  const tier = await db
    .select({ tierLevel: subscriptionTiers.tierLevel })
    .from(subscriptionTiers)
    .where(and(
      eq(subscriptionTiers.authorId, project.ownerId),
      eq(subscriptionTiers.tierLevel, level)
    ))
    .limit(1)

  if (tier.length === 0) {
    return { ok: false, error: `No subscription tier exists at tier_level ${level} for this author` }
  }
  return { ok: true }
}

const entityPublishPlugin: FastifyPluginAsync = async (fastify) => {
  // ---------- PATCH /entities/:entityId/publish ----------
  fastify.patch<{
    Params: { entityId: string }
    Body: z.infer<typeof EntityPublishPatch>
  }>('/entities/:entityId/publish', {
    preHandler: [requireAuth, requireScope('entities:write')],
  }, async (request, reply) => {
    try {
      const { entityId } = request.params
      const body = EntityPublishPatch.parse(request.body)

      const hasAccess = await requireProjectOwnership(request, reply, body.projectId)
      if (!hasAccess) return

      if (body.minimumTierLevel !== undefined) {
        const check = await validateTierLevel(body.projectId, body.minimumTierLevel)
        if (!check.ok) return reply.status(400).send({ error: check.error })
      }

      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(body.projectId)
      const scopeFilter = buildScopeCondition(body.projectId, collectionIds, userId)

      const [current] = await db
        .select({
          id: entities.id,
          isPublished: entities.isPublished,
          publishedAt: entities.publishedAt,
          publishBase: entities.publishBase,
          publishedVariantIds: entities.publishedVariantIds,
          variantAccessLevels: entities.variantAccessLevels,
          entityData: entities.entityData,
        })
        .from(entities)
        .where(and(
          eq(entities.id, entityId),
          scopeFilter,
          eq(entities.collectionName, body.collection),
        ))
        .limit(1)

      if (!current) return reply.status(404).send({ error: 'Entity not found' })

      // Validate that any passed publishedVariantIds exist on the entity's
      // _variants.items map (tolerant of missing data — empty array is fine).
      const data = current.entityData as Record<string, any>
      const variantItems = data?._variants?.items as Record<string, unknown> | undefined
      const knownVariantIds =
        variantItems && typeof variantItems === 'object' ? new Set(Object.keys(variantItems)) : new Set<string>()
      if (body.publishedVariantIds && body.publishedVariantIds.length > 0) {
        const unknown = body.publishedVariantIds.filter(id => !knownVariantIds.has(id))
        if (unknown.length > 0) {
          return reply.status(400).send({
            error: 'One or more published variant ids are not present on this entity',
            unknown,
          })
        }
      }

      // Validate variantAccessLevels keys + tier levels when provided.
      if (body.variantAccessLevels) {
        const unknownKeys: string[] = []
        for (const key of Object.keys(body.variantAccessLevels)) {
          if (key === '__base__') continue
          if (!knownVariantIds.has(key)) unknownKeys.push(key)
        }
        if (unknownKeys.length > 0) {
          return reply.status(400).send({
            error: 'variantAccessLevels contains variant ids not present on this entity',
            unknown: unknownKeys,
          })
        }
        for (const level of Object.values(body.variantAccessLevels)) {
          if (level > 0) {
            const check = await validateTierLevel(body.projectId, level)
            if (!check.ok) return reply.status(400).send({ error: check.error })
          }
        }
      }

      // Compute the effective next state so we can enforce "if published, at
      // least one of base or variants must be shown to the reader."
      const nextIsPublished = body.isPublished ?? current.isPublished
      const nextPublishBase = body.publishBase ?? current.publishBase
      const nextVariantIds =
        body.publishedVariantIds ?? (current.publishedVariantIds ?? [])
      if (nextIsPublished && !nextPublishBase && nextVariantIds.length === 0) {
        return reply.status(400).send({
          error: 'Publishing an entity requires at least the base or one variant to be visible',
        })
      }

      const updates: Partial<typeof entities.$inferInsert> = { updatedAt: new Date() }
      if (body.isPublished !== undefined) {
        updates.isPublished = body.isPublished
        if (body.isPublished && !current.publishedAt) {
          updates.publishedAt = new Date()
        }
      }
      if (body.publishOrder !== undefined) updates.publishOrder = body.publishOrder
      if (body.minimumTierLevel !== undefined) updates.minimumTierLevel = body.minimumTierLevel
      if (body.publishBase !== undefined) updates.publishBase = body.publishBase
      if (body.publishedVariantIds !== undefined) updates.publishedVariantIds = body.publishedVariantIds
      if (body.variantAccessLevels !== undefined) updates.variantAccessLevels = body.variantAccessLevels

      const [result] = await db
        .update(entities)
        .set(updates)
        .where(eq(entities.id, current.id))
        .returning({
          id: entities.id,
          isPublished: entities.isPublished,
          publishedAt: entities.publishedAt,
          publishOrder: entities.publishOrder,
          minimumTierLevel: entities.minimumTierLevel,
          publishBase: entities.publishBase,
          publishedVariantIds: entities.publishedVariantIds,
          variantAccessLevels: entities.variantAccessLevels,
        })

      return result
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          issues: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
        })
      }
      fastify.log.error(error, 'Failed to patch entity publish state')
      return reply.status(500).send({ error: 'Failed to update publish state' })
    }
  })

  // ---------- PATCH /projects/:projectId/entity-types/:typeId/publish ----------
  fastify.patch<{
    Params: { projectId: string; typeId: string }
    Body: z.infer<typeof PublishPatchBody>
  }>('/projects/:projectId/entity-types/:typeId/publish', {
    preHandler: [requireAuth, requireScope('entities:write')],
  }, async (request, reply) => {
    try {
      const projectId = z.string().uuid().parse(request.params.projectId)
      const typeId = z.string().regex(TYPE_ID_RE).parse(request.params.typeId)
      const body = PublishPatchBody.parse(request.body)

      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      if (body.minimumTierLevel !== undefined) {
        const check = await validateTierLevel(projectId, body.minimumTierLevel)
        if (!check.ok) return reply.status(400).send({ error: check.error })
      }

      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)

      const [current] = await db
        .select({ id: entities.id, publishedAt: entities.publishedAt })
        .from(entities)
        .where(and(
          scopeFilter,
          eq(entities.collectionName, TYPE_DEF_COLLECTION),
          sql`${entities.entityData}->>'type_id' = ${typeId}`,
        ))
        .limit(1)

      if (!current) return reply.status(404).send({ error: 'Entity type not found' })

      const updates: Partial<typeof entities.$inferInsert> = { updatedAt: new Date() }
      if (body.isPublished !== undefined) {
        updates.isPublished = body.isPublished
        if (body.isPublished && !current.publishedAt) {
          updates.publishedAt = new Date()
        }
      }
      if (body.publishOrder !== undefined) updates.publishOrder = body.publishOrder
      if (body.minimumTierLevel !== undefined) updates.minimumTierLevel = body.minimumTierLevel

      const [result] = await db
        .update(entities)
        .set(updates)
        .where(eq(entities.id, current.id))
        .returning({
          id: entities.id,
          isPublished: entities.isPublished,
          publishedAt: entities.publishedAt,
          publishOrder: entities.publishOrder,
          minimumTierLevel: entities.minimumTierLevel,
        })

      return result
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          issues: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
        })
      }
      fastify.log.error(error, 'Failed to patch entity type publish state')
      return reply.status(500).send({ error: 'Failed to update publish state' })
    }
  })

  // ---------- POST /projects/:projectId/entities/reorder ----------
  fastify.post<{
    Params: { projectId: string }
    Body: z.infer<typeof ReorderEntitiesBody>
  }>('/projects/:projectId/entities/reorder', {
    preHandler: [requireAuth, requireScope('entities:write')],
  }, async (request, reply) => {
    try {
      const projectId = z.string().uuid().parse(request.params.projectId)
      const body = ReorderEntitiesBody.parse(request.body)

      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)

      // Verify every id belongs to this project + collection before writing
      const existing = await db
        .select({ id: entities.id })
        .from(entities)
        .where(and(
          scopeFilter,
          eq(entities.collectionName, body.collection),
          inArray(entities.id, body.orderedIds),
        ))

      const existingIds = new Set(existing.map(r => r.id))
      const missing = body.orderedIds.filter(id => !existingIds.has(id))
      if (missing.length > 0) {
        return reply.status(400).send({
          error: 'Some entities were not found in this project/collection',
          missing,
        })
      }

      await db.transaction(async (tx) => {
        for (let i = 0; i < body.orderedIds.length; i++) {
          await tx
            .update(entities)
            .set({ publishOrder: i, updatedAt: new Date() })
            .where(eq(entities.id, body.orderedIds[i]!))
        }
      })

      return { success: true, reordered: body.orderedIds.length }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          issues: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
        })
      }
      fastify.log.error(error, 'Failed to reorder entities')
      return reply.status(500).send({ error: 'Failed to reorder entities' })
    }
  })

  // ---------- POST /projects/:projectId/entity-types/reorder ----------
  fastify.post<{
    Params: { projectId: string }
    Body: z.infer<typeof ReorderTypesBody>
  }>('/projects/:projectId/entity-types/reorder', {
    preHandler: [requireAuth, requireScope('entities:write')],
  }, async (request, reply) => {
    try {
      const projectId = z.string().uuid().parse(request.params.projectId)
      const body = ReorderTypesBody.parse(request.body)

      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)

      // Resolve typeIds → entity row ids
      const rows = await db
        .select({ id: entities.id, data: entities.entityData })
        .from(entities)
        .where(and(
          scopeFilter,
          eq(entities.collectionName, TYPE_DEF_COLLECTION),
        ))

      const idByTypeId = new Map<string, string>()
      for (const r of rows) {
        const t = (r.data as Record<string, unknown>)?.type_id
        if (typeof t === 'string') idByTypeId.set(t, r.id)
      }

      const missing = body.orderedTypeIds.filter(t => !idByTypeId.has(t))
      if (missing.length > 0) {
        return reply.status(400).send({
          error: 'Some entity types were not found in this project',
          missing,
        })
      }

      await db.transaction(async (tx) => {
        for (let i = 0; i < body.orderedTypeIds.length; i++) {
          const id = idByTypeId.get(body.orderedTypeIds[i]!)!
          await tx
            .update(entities)
            .set({ publishOrder: i, updatedAt: new Date() })
            .where(eq(entities.id, id))
        }
      })

      return { success: true, reordered: body.orderedTypeIds.length }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          issues: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
        })
      }
      fastify.log.error(error, 'Failed to reorder entity types')
      return reply.status(500).send({ error: 'Failed to reorder entity types' })
    }
  })
}

export default entityPublishPlugin
