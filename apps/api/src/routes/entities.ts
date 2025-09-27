import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/connection'
import { bobbinsInstalled, entities } from '../db/schema'
import { eq, and, sql, like, or, desc, asc } from 'drizzle-orm'

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
      const { collection } = request.params
      const { projectId, limit = '50', offset = '0', search } = request.query
      
      // For now, use JSONB storage (Tier 1)
      // In production, this would check if collection has been promoted to physical tables
      
      const limitNum = parseInt(limit, 10)
      const offsetNum = parseInt(offset, 10)

      // Build query conditions
      let whereCondition = and(
        eq(entities.projectId, projectId),
        eq(entities.collectionName, collection)
      )

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
          sql`COALESCE((${entities.entityData}->>'order')::int, 999999)`,
          desc(entities.createdAt)
        )
        .limit(limitNum)
        .offset(offsetNum)
      
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
      const { collection, projectId, data } = request.body
      
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

      const result = await db
        .update(entities)
        .set({
          entityData: data,
          updatedAt: new Date()
        })
        .where(and(
          eq(entities.id, entityId),
          eq(entities.projectId, projectId),
          eq(entities.collectionName, collection)
        ))
        .returning()

      if (result.length === 0) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      const updated = result[0]

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

      const entity = result[0]

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