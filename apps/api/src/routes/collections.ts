/**
 * Project Collections API
 *
 * Handles grouping projects into series/collections (e.g., Book 1, Book 2, Book 3)
 * Also handles short URL management for collections
 */

import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import { projectCollections, projectCollectionMemberships, projects } from '../db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import { randomBytes } from 'crypto'

const collectionsPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * List user's collections with project counts
   * GET /users/me/collections
   */
  fastify.get<{
    Querystring: {
      userId: string
    }
  }>('/users/me/collections', async (request, reply) => {
    try {
      const { userId } = request.query

      if (!userId) {
        return reply.status(400).send({ error: 'userId query parameter required' })
      }

      // Get collections with project counts
      const collections = await db
        .select({
          id: projectCollections.id,
          name: projectCollections.name,
          description: projectCollections.description,
          shortUrl: projectCollections.shortUrl,
          coverImage: projectCollections.coverImage,
          colorTheme: projectCollections.colorTheme,
          isPublic: projectCollections.isPublic,
          createdAt: projectCollections.createdAt,
          updatedAt: projectCollections.updatedAt,
          projectCount: sql<string>`COUNT(${projectCollectionMemberships.projectId})::text`
        })
        .from(projectCollections)
        .leftJoin(
          projectCollectionMemberships,
          eq(projectCollections.id, projectCollectionMemberships.collectionId)
        )
        .where(eq(projectCollections.userId, userId))
        .groupBy(projectCollections.id)
        .orderBy(desc(projectCollections.updatedAt))

      return reply.send({ collections })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to list collections')
      return reply.status(500).send({ error: 'Failed to list collections' })
    }
  })

  /**
   * Create new collection
   * POST /collections
   */
  fastify.post<{
    Body: {
      userId: string
      name: string
      description?: string
      colorTheme?: string
      coverImage?: string
    }
  }>('/collections', async (request, reply) => {
    try {
      const { userId, name, description, colorTheme, coverImage } = request.body

      if (!userId || !name) {
        return reply.status(400).send({ error: 'userId and name are required' })
      }

      const [collection] = await db
        .insert(projectCollections)
        .values({
          userId,
          name,
          description: description || null,
          colorTheme: colorTheme || null,
          coverImage: coverImage || null
        })
        .returning()

      return reply.status(201).send({ collection })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create collection')
      return reply.status(500).send({ error: 'Failed to create collection' })
    }
  })

  /**
   * Get collection details
   * GET /collections/:collectionId
   */
  fastify.get<{
    Params: {
      collectionId: string
    }
  }>('/collections/:collectionId', async (request, reply) => {
    try {
      const { collectionId } = request.params

      const [collection] = await db
        .select()
        .from(projectCollections)
        .where(eq(projectCollections.id, collectionId))
        .limit(1)

      if (!collection) {
        return reply.status(404).send({ error: 'Collection not found' })
      }

      return reply.send({ collection })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get collection')
      return reply.status(500).send({ error: 'Failed to get collection' })
    }
  })

  /**
   * Update collection metadata
   * PUT /collections/:collectionId
   */
  fastify.put<{
    Params: {
      collectionId: string
    }
    Body: {
      name?: string
      description?: string
      colorTheme?: string
      coverImage?: string
      isPublic?: boolean
    }
  }>('/collections/:collectionId', async (request, reply) => {
    try {
      const { collectionId } = request.params
      const updates = request.body

      const [collection] = await db
        .update(projectCollections)
        .set({
          ...updates,
          updatedAt: new Date()
        })
        .where(eq(projectCollections.id, collectionId))
        .returning()

      if (!collection) {
        return reply.status(404).send({ error: 'Collection not found' })
      }

      return reply.send({ collection })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update collection')
      return reply.status(500).send({ error: 'Failed to update collection' })
    }
  })

  /**
   * Delete collection (keeps projects intact)
   * DELETE /collections/:collectionId
   */
  fastify.delete<{
    Params: {
      collectionId: string
    }
  }>('/collections/:collectionId', async (request, reply) => {
    try {
      const { collectionId } = request.params

      // Delete collection (cascade will remove memberships)
      await db
        .delete(projectCollections)
        .where(eq(projectCollections.id, collectionId))

      return reply.status(204).send()
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete collection')
      return reply.status(500).send({ error: 'Failed to delete collection' })
    }
  })

  /**
   * Get projects in collection (ordered)
   * GET /collections/:collectionId/projects
   */
  fastify.get<{
    Params: {
      collectionId: string
    }
  }>('/collections/:collectionId/projects', async (request, reply) => {
    try {
      const { collectionId } = request.params

      const projectsInCollection = await db
        .select({
          project: projects,
          membership: projectCollectionMemberships,
          orderIndex: projectCollectionMemberships.orderIndex
        })
        .from(projectCollectionMemberships)
        .innerJoin(projects, eq(projects.id, projectCollectionMemberships.projectId))
        .where(eq(projectCollectionMemberships.collectionId, collectionId))
        .orderBy(projectCollectionMemberships.orderIndex)

      return reply.send({ projects: projectsInCollection })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get collection projects')
      return reply.status(500).send({ error: 'Failed to get collection projects' })
    }
  })

  /**
   * Get aggregate stats for collection
   * GET /collections/:collectionId/stats
   */
  fastify.get<{
    Params: {
      collectionId: string
    }
  }>('/collections/:collectionId/stats', async (request, reply) => {
    try {
      const { collectionId } = request.params

      // Get project IDs in collection
      const memberships = await db
        .select({ projectId: projectCollectionMemberships.projectId })
        .from(projectCollectionMemberships)
        .where(eq(projectCollectionMemberships.collectionId, collectionId))

      const projectIds = memberships.map(m => m.projectId)

      // TODO: Aggregate entity stats across projects
      // This would require counting entities, calculating word counts, etc.
      // For now, return basic count

      return reply.send({
        stats: {
          projectCount: projectIds.length,
          // Add more stats as needed
        }
      })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get collection stats')
      return reply.status(500).send({ error: 'Failed to get collection stats' })
    }
  })

  /**
   * Add project to collection
   * POST /collections/:collectionId/projects/:projectId
   */
  fastify.post<{
    Params: {
      collectionId: string
      projectId: string
    }
    Body: {
      orderIndex?: number
    }
  }>('/collections/:collectionId/projects/:projectId', async (request, reply) => {
    try {
      const { collectionId, projectId } = request.params
      const { orderIndex = 0 } = request.body

      // Check if project exists
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)

      if (!project) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      // Add to collection
      const [membership] = await db
        .insert(projectCollectionMemberships)
        .values({
          collectionId,
          projectId,
          orderIndex: Number(orderIndex) || 0
        })
        .onConflictDoNothing()
        .returning()

      if (!membership) {
        return reply.status(409).send({ error: 'Project already in collection' })
      }

      return reply.status(201).send({ membership })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to add project to collection')
      return reply.status(500).send({ error: 'Failed to add project to collection' })
    }
  })

  /**
   * Remove project from collection
   * DELETE /collections/:collectionId/projects/:projectId
   */
  fastify.delete<{
    Params: {
      collectionId: string
      projectId: string
    }
  }>('/collections/:collectionId/projects/:projectId', async (request, reply) => {
    try {
      const { collectionId, projectId } = request.params

      await db
        .delete(projectCollectionMemberships)
        .where(
          and(
            eq(projectCollectionMemberships.collectionId, collectionId),
            eq(projectCollectionMemberships.projectId, projectId)
          )
        )

      return reply.status(204).send()
    } catch (error) {
      fastify.log.error({ error }, 'Failed to remove project from collection')
      return reply.status(500).send({ error: 'Failed to remove project from collection' })
    }
  })

  /**
   * Reorder projects in collection
   * PUT /collections/:collectionId/projects/reorder
   */
  fastify.put<{
    Params: {
      collectionId: string
    }
    Body: {
      projectIds: string[]
    }
  }>('/collections/:collectionId/projects/reorder', async (request, reply) => {
    try {
      const { collectionId } = request.params
      const { projectIds } = request.body

      if (!Array.isArray(projectIds)) {
        return reply.status(400).send({ error: 'projectIds must be an array' })
      }

      // Update order index for each project
      for (let i = 0; i < projectIds.length; i++) {
        const projectId = projectIds[i]
        if (!projectId) continue
        
        await db
          .update(projectCollectionMemberships)
          .set({ orderIndex: i })
          .where(
            and(
              eq(projectCollectionMemberships.collectionId, collectionId),
              eq(projectCollectionMemberships.projectId, projectId)
            )
          )
      }

      return reply.send({ success: true })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to reorder projects')
      return reply.status(500).send({ error: 'Failed to reorder projects' })
    }
  })

  /**
   * Generate or claim short URL for collection
   * POST /collections/:collectionId/short-url
   */
  fastify.post<{
    Params: {
      collectionId: string
    }
    Body: {
      customUrl?: string
    }
  }>('/collections/:collectionId/short-url', async (request, reply) => {
    try {
      const { collectionId } = request.params
      const { customUrl } = request.body

      // Reserved words
      const reservedWords = [
        'admin', 'api', 'app', 'auth', 'blog', 'dashboard', 'docs',
        'help', 'login', 'logout', 'public', 'settings', 'support', 'terms', 'privacy'
      ]

      let shortUrl: string

      if (customUrl) {
        // Custom URL (premium feature - validation would happen here)
        if (reservedWords.includes(customUrl.toLowerCase())) {
          return reply.status(400).send({ error: 'Short URL is reserved' })
        }
        shortUrl = customUrl
      } else {
        // Generate random 6-8 character code
        shortUrl = randomBytes(4).toString('hex')
      }

      // Check availability
      const [existing] = await db
        .select()
        .from(projectCollections)
        .where(eq(projectCollections.shortUrl, shortUrl))
        .limit(1)

      if (existing) {
        return reply.status(409).send({ error: 'Short URL already taken' })
      }

      // Claim short URL
      const [collection] = await db
        .update(projectCollections)
        .set({ shortUrl, updatedAt: new Date() })
        .where(eq(projectCollections.id, collectionId))
        .returning()

      return reply.send({ collection })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to claim short URL')
      return reply.status(500).send({ error: 'Failed to claim short URL' })
    }
  })

  /**
   * Release/delete short URL for collection
   * DELETE /collections/:collectionId/short-url
   */
  fastify.delete<{
    Params: {
      collectionId: string
    }
  }>('/collections/:collectionId/short-url', async (request, reply) => {
    try {
      const { collectionId } = request.params

      await db
        .update(projectCollections)
        .set({ shortUrl: null, updatedAt: new Date() })
        .where(eq(projectCollections.id, collectionId))

      return reply.status(204).send()
    } catch (error) {
      fastify.log.error({ error }, 'Failed to release short URL')
      return reply.status(500).send({ error: 'Failed to release short URL' })
    }
  })
}

export default collectionsPlugin
