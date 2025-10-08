import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/connection'
import { bobbinsInstalled, entities } from '../db/schema'
import { eq, and, sql, or } from 'drizzle-orm'

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

const entitiesPlugin: FastifyPluginAsync = async (fastify) => {

  // Query entities from a collection
  fastify.get<{
    Params: { collection: string }
    Querystring: {
      projectId: string
      limit?: string
      offset?: string
      search?: string
    }
  }>('/collections/:collection/entities', async (request, reply) => {
    try {
      // Validate input
      const params = EntityParamsSchema.parse(request.params)
      const query = EntityQuerySchema.parse(request.query)

      const { collection } = params
      const { projectId, limit, offset, search, filters } = query

      // For now, use JSONB storage (Tier 1)
      // In production, this would check if collection has been promoted to physical tables

      // Build query conditions
      let whereCondition = and(
        eq(entities.projectId, projectId),
        eq(entities.collectionName, collection)
      )

      // Add custom filters if provided
      if (filters) {
        try {
          const filterObj = JSON.parse(filters)
          for (const [key, value] of Object.entries(filterObj)) {
            if (value === null) {
              // Filter for NULL values
              whereCondition = and(
                whereCondition,
                sql`${entities.entityData}->>${key} IS NULL`
              )
            } else {
              // Filter for specific values
              whereCondition = and(
                whereCondition,
                sql`${entities.entityData}->>${key} = ${value}`
              )
            }
          }
        } catch (error) {
          fastify.log.warn('Invalid filters JSON:', filters)
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
      const entityList = result.map((row) => ({
        id: row.id,
        ...(row.entityData as object),
        _meta: {
          bobbinId: row.bobbinId,
          collection: row.collectionName,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        }
      }))

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

  // Create new entity
  fastify.post<{
    Body: {
      collection: string
      projectId: string
      data: Record<string, any>
    }
  }>('/entities', async (request, reply) => {
    try {
      // Validate input
      const body = EntityCreateSchema.parse(request.body)
      const { collection, projectId, data } = body

      // Validate that the collection exists in an installed bobbin
      const installation = await db
        .select()
        .from(bobbinsInstalled)
        .where(and(
          eq(bobbinsInstalled.projectId, projectId),
          eq(bobbinsInstalled.enabled, true)
        ))

      if (installation.length === 0) {
        return reply.status(400).send({ error: 'No bobbins installed in project' })
      }

      // Find which bobbin contains this collection
      let targetBobbin = null
      for (const install of installation) {
        const manifest = install.manifestJson as any
        const collections = manifest.data?.collections || []
        if (collections.some((c: any) => c.name === collection)) {
          targetBobbin = install
          break
        }
      }

      if (!targetBobbin) {
        return reply.status(400).send({
          error: `Collection '${collection}' not found in any installed bobbin`
        })
      }

      // Create entity in JSONB storage (Tier 1)
      const entityId = crypto.randomUUID()

      const result = await db
        .insert(entities)
        .values({
          id: entityId,
          projectId,
          bobbinId: targetBobbin.bobbinId,
          collectionName: collection,
          entityData: data
        })
        .returning()

      const created = result[0]
      if (!created) {
        return reply.status(500).send({ error: 'Failed to create entity - no result returned' })
      }

      return {
        id: created.id,
        ...(created.entityData as object),
        _meta: {
          bobbinId: created.bobbinId,
          collection: created.collectionName,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt
        }
      }

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

  // Update entity
  fastify.put<{
    Params: { entityId: string }
    Body: {
      collection: string
      projectId: string
      data: Record<string, any>
    }
  }>('/entities/:entityId', async (request, reply) => {
    try {
      const { entityId } = request.params
      const { collection, projectId, data } = request.body

      // First, fetch the current entity to merge with existing data
      const current = await db
        .select()
        .from(entities)
        .where(and(
          eq(entities.id, entityId),
          eq(entities.projectId, projectId),
          eq(entities.collectionName, collection)
        ))
        .limit(1)

      if (current.length === 0) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      // Merge the new data with existing entity_data to preserve unmodified fields
      const mergedData = {
        ...(current[0]!.entityData as object),
        ...data
      }

      const result = await db
        .update(entities)
        .set({
          entityData: mergedData,
          updatedAt: new Date()
        })
        .where(and(
          eq(entities.id, entityId),
          eq(entities.projectId, projectId),
          eq(entities.collectionName, collection)
        ))
        .returning()

      if (result.length === 0) {
        return reply.status(500).send({ error: 'Update failed' })
      }

      const updated = result[0]!  // Safe because we check result.length above

      return {
        id: updated.id,
        ...(updated.entityData as object),
        _meta: {
          bobbinId: updated.bobbinId,
          collection: updated.collectionName,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt
        }
      }

    } catch (error) {
      fastify.log.error(error)
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

  // Delete entity
  fastify.delete<{
    Params: { entityId: string }
    Querystring: {
      projectId: string
      collection: string
    }
  }>('/entities/:entityId', async (request, reply) => {
    try {
      const { entityId } = request.params
      const { projectId, collection } = request.query

      // If deleting a container, use cascade delete in a transaction
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
          eq(entities.projectId, projectId),
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

  // Atomic batch operations
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
  }>('/entities/batch/atomic', async (request, reply) => {
    try {
      const { projectId, operations } = request.body

      if (!operations || operations.length === 0) {
        return reply.status(400).send({ error: 'No operations provided' })
      }

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
                
                // Find target bobbin
                const installations = await tx
                  .select()
                  .from(bobbinsInstalled)
                  .where(and(
                    eq(bobbinsInstalled.projectId, projectId),
                    eq(bobbinsInstalled.enabled, true)
                  ))

                let targetBobbin = null
                for (const install of installations) {
                  const manifest = install.manifestJson as any
                  const collections = manifest.data?.collections || []
                  if (collections.some((c: any) => c.name === collection)) {
                    targetBobbin = install
                    break
                  }
                }

                if (!targetBobbin) {
                  throw new Error(`Collection '${collection}' not found`)
                }

                const entityId = crypto.randomUUID()
                const created = await tx
                  .insert(entities)
                  .values({
                    id: entityId,
                    projectId,
                    bobbinId: targetBobbin.bobbinId,
                    collectionName: collection,
                    entityData: data
                  })
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
                    eq(entities.projectId, projectId),
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
                
                // Use cascade delete for containers
                if (collection === 'containers') {
                  await deleteContainerCascade(projectId, id, tx)
                  result = { deleted: true, id }
                } else {
                  const deleted = await tx
                    .delete(entities)
                    .where(and(
                      eq(entities.id, id),
                      eq(entities.projectId, projectId),
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

  // Get single entity
  fastify.get<{
    Params: { entityId: string }
    Querystring: {
      projectId: string
      collection: string
    }
  }>('/entities/:entityId', async (request, reply) => {
    try {
      const { entityId } = request.params
      const { projectId, collection } = request.query

      const result = await db
        .select()
        .from(entities)
        .where(and(
          eq(entities.id, entityId),
          eq(entities.projectId, projectId),
          eq(entities.collectionName, collection)
        ))

      if (result.length === 0) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      const entity = result[0]!  // Safe because we check result.length above

      return {
        id: entity.id,
        ...(entity.entityData as object),
        _meta: {
          bobbinId: entity.bobbinId,
          collection: entity.collectionName,
          createdAt: entity.createdAt,
          updatedAt: entity.updatedAt
        }
      }

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