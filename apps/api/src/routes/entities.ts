import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/connection'
import { entities } from '../db/schema'
import { eq, and, sql, or } from 'drizzle-orm'
import { requireAuth, requireProjectOwnership, requireScope } from '../middleware/auth'
import { serverEventBus, contentEdited } from '../lib/event-bus'
import { findBobbinForCollectionAcrossScopes } from '../lib/disk-manifests'
import { getEffectiveBobbins, getCollectionIdsForProject, buildScopeCondition } from '../lib/effective-bobbins'

/** Format an entity row into the standard API response shape */
function formatEntityResponse(row: typeof entities.$inferSelect) {
  return {
    id: row.id,
    ...(row.entityData as object),
    _meta: {
      bobbinId: row.bobbinId,
      collection: row.collectionName,
      scope: row.scope,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }
  }
}

// Input validation schemas
const EntityQuerySchema = z.object({
  projectId: z.string().uuid('Invalid project ID format'),
  limit: z.coerce.number().min(1).max(5000).default(50),
  offset: z.coerce.number().min(0).default(0),
  search: z.string().max(200).optional(),
  filters: z.string().optional() // JSON string of filters
})

const EntityParamsSchema = z.object({
  collection: z.string()
    .min(1, 'Collection name required')
    .max(100, 'Collection name too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Collection name contains invalid characters')
})

const EntityCreateSchema = z.object({
  collection: z.string()
    .min(1, 'Collection name required')
    .max(100, 'Collection name too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Collection name contains invalid characters'),
  projectId: z.string().uuid('Invalid project ID format'),
  data: z.record(z.string(), z.any())
})

const EntityUpdateSchema = EntityCreateSchema.extend({
  expectedVersion: z.number().int().positive().optional()
})

const entitiesPlugin: FastifyPluginAsync = async (fastify) => {

  // Query entities from a collection (requires project ownership)
  fastify.get<{
    Params: { collection: string }
    Querystring: {
      projectId: string
      limit?: string
      offset?: string
      search?: string
    }
  }>('/collections/:collection/entities', {
    preHandler: [requireAuth, requireScope('entities:read')]
  }, async (request, reply) => {
    try {
      // Validate input
      const params = EntityParamsSchema.parse(request.params)
      const query = EntityQuerySchema.parse(request.query)

      const { collection } = params
      const { projectId, limit, offset, search, filters } = query

      // Check project ownership
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      // Resolve scope: include entities from project, its collections, and global
      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)

      // Build query conditions
      let whereCondition = and(
        scopeFilter,
        eq(entities.collectionName, collection)
      )

      // Add custom filters if provided
      if (filters) {
        try {
          const filterObj = JSON.parse(filters)
          // Allowlist of valid field name patterns to prevent SQL injection
          // Only allow simple identifiers: start with letter/underscore, followed by alphanumeric/underscore
          const validFieldPattern = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/

          for (const [key, value] of Object.entries(filterObj)) {
            // Validate field name to prevent SQL injection
            if (!validFieldPattern.test(key)) {
              fastify.log.warn({ key }, 'Invalid filter key rejected')
              continue
            }

            // Key is validated by regex above (safe to interpolate as identifier)
            // Value MUST be parameterized via Drizzle's sql template to prevent injection
            if (value === null) {
              const nullCheckSql = sql`${sql.raw(`entity_data->>'${key}'`)} IS NULL`
              whereCondition = and(whereCondition, nullCheckSql)
            } else {
              const strValue = String(value)
              const filterSql = sql`${sql.raw(`entity_data->>'${key}'`)} = ${strValue}`
              whereCondition = and(whereCondition, filterSql)
            }
          }
        } catch {
          fastify.log.warn({ filters }, 'Invalid filters JSON')
        }
      }

      // Add search filter if provided
      if (search) {
        const searchPattern = `%${search}%`
        whereCondition = and(
          whereCondition,
          or(
            sql`${entities.entityData}->>'title' ILIKE ${searchPattern}`,
            sql`${entities.entityData}->>'name' ILIKE ${searchPattern}`,
            sql`${entities.entityData}::text ILIKE ${searchPattern}`
          )
        )
      }

      const result = await db
        .select()
        .from(entities)
        .where(whereCondition)
        .orderBy(
          sql`COALESCE((${entities.entityData}->>'order')::bigint, 999999) ASC`,
          sql`${entities.createdAt} DESC`
        )
        .limit(limit)
        .offset(offset)

      // Transform results to match expected format
      const entityList = result.map(formatEntityResponse)

      return { entities: entityList, total: entityList.length }

    } catch (error) {
      fastify.log.error(error)

      // Handle validation errors
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          issues: error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message
          }))
        })
      }

      return reply.status(500).send({
        error: 'Failed to query entities',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Create new entity (requires project ownership)
  fastify.post<{
    Body: {
      collection: string
      projectId: string
      data: Record<string, any>
    }
  }>('/entities', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      // Validate input
      const body = EntityCreateSchema.parse(request.body)
      const { collection, projectId, data } = body

      // Check project ownership
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      // Validate that the collection exists in an installed bobbin (across all scopes)
      const userId = request.user!.id
      const effective = await getEffectiveBobbins(projectId, userId)

      if (effective.length === 0) {
        return reply.status(400).send({ error: 'No bobbins installed in project' })
      }

      // Find which bobbin contains this collection (project > collection > global priority)
      const match = await findBobbinForCollectionAcrossScopes(effective, collection)

      if (!match) {
        return reply.status(400).send({
          error: `Collection '${collection}' not found in any installed bobbin`
        })
      }

      // Set the correct FK based on the resolved scope
      const entityId = crypto.randomUUID()
      const insertValues: Record<string, any> = {
        id: entityId,
        bobbinId: match.bobbinId,
        collectionName: collection,
        entityData: data,
        scope: match.scope,
      }

      if (match.scope === 'project') {
        insertValues.projectId = projectId
      } else if (match.scope === 'collection') {
        insertValues.collectionId = match.scopeOwnerId
      } else {
        insertValues.userId = userId
      }

      const result = await db
        .insert(entities)
        .values(insertValues as any)
        .returning()

      const created = result[0]
      if (!created) {
        return reply.status(500).send({ error: 'Failed to create entity - no result returned' })
      }

      return formatEntityResponse(created)

    } catch (error) {
      fastify.log.error(error)

      // Handle validation errors
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          issues: error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message
          }))
        })
      }

      return reply.status(500).send({
        error: 'Failed to create entity',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Update entity (requires project ownership)
  fastify.put<{
    Params: { entityId: string }
    Body: {
      collection: string
      projectId: string
      data: Record<string, any>
      expectedVersion?: number
    }
  }>('/entities/:entityId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { entityId } = request.params

      // Validate input with Zod
      const body = EntityUpdateSchema.parse(request.body)
      const { collection, projectId, data, expectedVersion } = body

      // Check project ownership
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      // Resolve scope for entity visibility
      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)

      // First, fetch the current entity to merge with existing data
      const current = await db
        .select()
        .from(entities)
        .where(and(
          eq(entities.id, entityId),
          scopeFilter,
          eq(entities.collectionName, collection)
        ))
        .limit(1)

      if (current.length === 0) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      const currentEntity = current[0]!

      // Optimistic locking: if client sends expectedVersion, check it matches
      if (expectedVersion !== undefined && currentEntity.version !== expectedVersion) {
        return reply.status(409).send({
          error: 'Conflict: entity was modified by another session',
          currentVersion: currentEntity.version,
          expectedVersion
        })
      }

      // Merge the new data with existing entity_data to preserve unmodified fields
      const mergedData = {
        ...(currentEntity.entityData as object),
        ...data
      }

      const newVersion = currentEntity.version + 1

      const result = await db
        .update(entities)
        .set({
          entityData: mergedData,
          version: newVersion,
          updatedAt: new Date()
        })
        .where(and(
          eq(entities.id, entityId),
          scopeFilter,
          eq(entities.collectionName, collection),
          // Double-check version at DB level to prevent TOCTOU race
          eq(entities.version, currentEntity.version)
        ))
        .returning()

      if (result.length === 0) {
        // Version changed between our read and write — concurrent edit
        return reply.status(409).send({
          error: 'Conflict: entity was modified by another session',
          currentVersion: currentEntity.version + 1
        })
      }

      const updated = result[0]!

      // Emit content:edited event for backup bobbins and other listeners
      serverEventBus.fire(contentEdited(projectId, entityId, request.user!.id, collection))

      return formatEntityResponse(updated)

    } catch (error) {
      fastify.log.error(error)

      // Handle validation errors
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '),
          issues: error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message
          }))
        })
      }

      return reply.status(500).send({
        error: 'Failed to update entity',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Recursive helper function to delete container and all its children
  async function deleteContainerCascade(projectId: string, containerId: string, tx: any) {
    // Find all child containers - check both camelCase and snake_case field names
    const childContainers = await tx
      .select()
      .from(entities)
      .where(and(
        eq(entities.projectId, projectId),
        eq(entities.collectionName, 'containers'),
        or(
          sql`${entities.entityData}->>'parent_id' = ${containerId}`,
          sql`${entities.entityData}->>'parentId' = ${containerId}`
        )
      ))

    // Recursively delete child containers
    for (const child of childContainers) {
      await deleteContainerCascade(projectId, child.id, tx)
    }

    // Delete all content in this container - check both camelCase and snake_case
    await tx
      .delete(entities)
      .where(and(
        eq(entities.projectId, projectId),
        eq(entities.collectionName, 'content'),
        or(
          sql`${entities.entityData}->>'container_id' = ${containerId}`,
          sql`${entities.entityData}->>'containerId' = ${containerId}`
        )
      ))

    // Delete the container itself
    await tx
      .delete(entities)
      .where(and(
        eq(entities.id, containerId),
        eq(entities.projectId, projectId),
        eq(entities.collectionName, 'containers')
      ))
  }

  // Delete entity (requires project ownership)
  fastify.delete<{
    Params: { entityId: string }
    Querystring: {
      projectId: string
      collection: string
    }
  }>('/entities/:entityId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { entityId } = request.params
      const { projectId, collection } = request.query

      // Check project ownership
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      // Resolve scope for entity visibility
      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)

      // If deleting a container, use cascade delete in a transaction
      // (containers are always project-scoped — manuscript is project-only)
      if (collection === 'containers') {
        await db.transaction(async (tx) => {
          await deleteContainerCascade(projectId, entityId, tx)
        })

        return { success: true, id: entityId }
      }

      // For non-container entities, simple delete
      const result = await db
        .delete(entities)
        .where(and(
          eq(entities.id, entityId),
          scopeFilter,
          eq(entities.collectionName, collection)
        ))
        .returning({ id: entities.id })

      if (result.length === 0) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      return { success: true, id: entityId }

    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        error: 'Failed to delete entity',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Atomic batch operations (requires project ownership)
  fastify.post<{
    Body: {
      projectId: string
      operations: Array<{
        type: 'create' | 'update' | 'delete'
        collection: string
        id?: string
        data?: Record<string, any>
      }>
    }
  }>('/entities/batch/atomic', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { projectId, operations } = request.body

      if (!operations || operations.length === 0) {
        return reply.status(400).send({ error: 'No operations provided' })
      }

      // Check project ownership
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      // Resolve scope for entity visibility
      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)
      const effective = await getEffectiveBobbins(projectId, userId)

      // Start a transaction
      const results = await db.transaction(async (tx) => {
        const opResults = []

        for (const operation of operations) {
          const { type, collection, id, data } = operation

          try {
            let result

            switch (type) {
              case 'create':
                if (!data) {
                  throw new Error('Create operation requires data')
                }

                // Find target bobbin across all scopes
                const match = await findBobbinForCollectionAcrossScopes(effective, collection)

                if (!match) {
                  throw new Error(`Collection '${collection}' not found`)
                }

                const entityId = crypto.randomUUID()
                const insertValues: Record<string, any> = {
                  id: entityId,
                  bobbinId: match.bobbinId,
                  collectionName: collection,
                  entityData: data,
                  scope: match.scope,
                }

                if (match.scope === 'project') {
                  insertValues.projectId = projectId
                } else if (match.scope === 'collection') {
                  insertValues.collectionId = match.scopeOwnerId
                } else {
                  insertValues.userId = userId
                }

                const created = await tx
                  .insert(entities)
                  .values(insertValues as any)
                  .returning()

                result = {
                  id: created[0]!.id,
                  ...(created[0]!.entityData as object)
                }
                break

              case 'update':
                if (!id || !data) {
                  throw new Error('Update operation requires id and data')
                }

                const updated = await tx
                  .update(entities)
                  .set({
                    entityData: data,
                    updatedAt: new Date()
                  })
                  .where(and(
                    eq(entities.id, id),
                    scopeFilter,
                    eq(entities.collectionName, collection)
                  ))
                  .returning()

                if (updated.length === 0) {
                  throw new Error(`Entity ${id} not found`)
                }

                result = {
                  id: updated[0]!.id,
                  ...(updated[0]!.entityData as object)
                }
                break

              case 'delete':
                if (!id) {
                  throw new Error('Delete operation requires id')
                }

                // Use cascade delete for containers (always project-scoped)
                if (collection === 'containers') {
                  await deleteContainerCascade(projectId, id, tx)
                  result = { deleted: true, id }
                } else {
                  const deleted = await tx
                    .delete(entities)
                    .where(and(
                      eq(entities.id, id),
                      scopeFilter,
                      eq(entities.collectionName, collection)
                    ))
                    .returning({ id: entities.id })

                  if (deleted.length === 0) {
                    throw new Error(`Entity ${id} not found`)
                  }

                  result = { deleted: true, id }
                }
                break

              default:
                throw new Error(`Unknown operation type: ${type}`)
            }

            opResults.push({ success: true, data: result })
          } catch (err) {
            // In atomic mode, any failure should rollback the transaction
            throw err
          }
        }

        return opResults
      })

      return { success: true, results }

    } catch (error) {
      fastify.log.error(error)
      
      // Transaction was rolled back
      return reply.status(500).send({
        error: 'Atomic batch operation failed - all changes rolled back',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })

  // Get single entity (requires project ownership)
  fastify.get<{
    Params: { entityId: string }
    Querystring: {
      projectId: string
      collection: string
    }
  }>('/entities/:entityId', {
    preHandler: [requireAuth, requireScope('entities:read')]
  }, async (request, reply) => {
    try {
      const { entityId } = request.params
      const { projectId, collection } = request.query

      // Check project ownership
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      // Resolve scope for entity visibility
      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)

      const result = await db
        .select()
        .from(entities)
        .where(and(
          eq(entities.id, entityId),
          scopeFilter,
          eq(entities.collectionName, collection)
        ))

      if (result.length === 0) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      const entity = result[0]!  // Safe because we check result.length above

      return formatEntityResponse(entity)

    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({
        error: 'Failed to get entity',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })
}

export default entitiesPlugin
