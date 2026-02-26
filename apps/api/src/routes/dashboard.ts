/**
 * User Dashboard API
 *
 * Handles user project dashboard, recent activity, short URLs, and stats
 */

import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import {
  projects,
  entities,
  projectCollections,
  projectCollectionMemberships
} from '../db/schema'
import { eq, and, desc, sql, inArray } from 'drizzle-orm'
import { randomBytes } from 'crypto'

const dashboardPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * Get user's projects (includes collection info)
   * GET /users/me/projects
   */
  fastify.get<{
    Querystring: {
      userId: string
      includeArchived?: string
    }
  }>('/users/me/projects', async (request, reply) => {
    try {
      const { userId, includeArchived = 'false' } = request.query

      if (!userId) {
        return reply.status(400).send({ error: 'userId query parameter required' })
      }

      let projectsQuery = db
        .select({
          project: projects,
          collectionId: projectCollectionMemberships.collectionId,
          collectionName: projectCollections.name
        })
        .from(projects)
        .leftJoin(
          projectCollectionMemberships,
          eq(projects.id, projectCollectionMemberships.projectId)
        )
        .leftJoin(
          projectCollections,
          eq(projectCollectionMemberships.collectionId, projectCollections.id)
        )
        .$dynamic()
        .where(eq(projects.ownerId, userId))

      // Filter archived if needed
      if (includeArchived === 'false') {
        projectsQuery = projectsQuery.where(eq(projects.isArchived, false))
      }

      const userProjects = await projectsQuery.orderBy(desc(projects.updatedAt))

      return reply.send({ projects: userProjects })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get user projects')
      return reply.status(500).send({ error: 'Failed to get user projects' })
    }
  })

  /**
   * Get user's projects grouped by collection
   * GET /users/me/projects/grouped
   */
  fastify.get<{
    Querystring: {
      userId: string
    }
  }>('/users/me/projects/grouped', async (request, reply) => {
    try {
      const { userId } = request.query

      if (!userId) {
        return reply.status(400).send({ error: 'userId query parameter required' })
      }

      // Get all user's collections
      const collections = await db
        .select()
        .from(projectCollections)
        .where(eq(projectCollections.userId, userId))
        .orderBy(desc(projectCollections.updatedAt))

      // Get all user's projects with their collection memberships
      const projectsWithCollections = await db
        .select({
          project: projects,
          collectionId: projectCollectionMemberships.collectionId,
          orderIndex: projectCollectionMemberships.orderIndex
        })
        .from(projects)
        .leftJoin(
          projectCollectionMemberships,
          eq(projects.id, projectCollectionMemberships.projectId)
        )
        .where(and(
          eq(projects.ownerId, userId),
          eq(projects.isArchived, false)
        ))

      // Group projects by collection
      const grouped: any = {
        collections: collections.map(col => ({
          ...col,
          projects: projectsWithCollections
            .filter(p => p.collectionId === col.id)
            .map(p => p.project)
            .sort((a, b) => {
              const aOrder = projectsWithCollections.find(p => p.project.id === a.id)?.orderIndex || 0
              const bOrder = projectsWithCollections.find(p => p.project.id === b.id)?.orderIndex || 0
              return aOrder - bOrder
            })
        })),
        uncategorized: projectsWithCollections
          .filter(p => !p.collectionId)
          .map(p => p.project)
      }

      return reply.send(grouped)
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get grouped projects')
      return reply.status(500).send({ error: 'Failed to get grouped projects' })
    }
  })

  /**
   * Get recent activity across all user's projects
   * GET /users/me/recent-activity
   */
  fastify.get<{
    Querystring: {
      userId: string
      limit?: string
    }
  }>('/users/me/recent-activity', async (request, reply) => {
    try {
      const { userId, limit = '50' } = request.query

      if (!userId) {
        return reply.status(400).send({ error: 'userId query parameter required' })
      }

      // Get user's project IDs
      const userProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.ownerId, userId))

      const projectIds = userProjects.map(p => p.id)

      if (projectIds.length === 0) {
        return reply.send({ activity: [] })
      }

      // Get recently edited entities
      const recentActivity = await db
        .select({
          entity: entities,
          projectName: projects.name,
          projectId: projects.id
        })
        .from(entities)
        .innerJoin(projects, eq(entities.projectId, projects.id))
        .where(inArray(entities.projectId, projectIds))
        .orderBy(desc(entities.lastEditedAt))
        .limit(parseInt(limit))

      return reply.send({ activity: recentActivity })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get recent activity')
      return reply.status(500).send({ error: 'Failed to get recent activity' })
    }
  })

  /**
   * Get overall user dashboard stats
   * GET /dashboard/stats
   */
  fastify.get<{
    Querystring: {
      userId: string
    }
  }>('/dashboard/stats', async (request, reply) => {
    try {
      const { userId } = request.query

      if (!userId) {
        return reply.status(400).send({ error: 'userId query parameter required' })
      }

      // Get project count
      const [projectStats] = await db
        .select({
          total: sql<string>`COUNT(*)::text`,
          archived: sql<string>`COUNT(CASE WHEN ${projects.isArchived} THEN 1 END)::text`
        })
        .from(projects)
        .where(eq(projects.ownerId, userId))

      // Get collection count
      const [collectionStats] = await db
        .select({
          total: sql<string>`COUNT(*)::text`
        })
        .from(projectCollections)
        .where(eq(projectCollections.userId, userId))

      // Get user's project IDs for entity stats
      const userProjects = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.ownerId, userId))

      const projectIds = userProjects.map(p => p.id)

      // Get entity stats (chapters, scenes, etc.)
      let entityStats = { total: '0' }
      if (projectIds.length > 0) {
        const [stats] = await db
          .select({
            total: sql<string>`COUNT(*)::text`
          })
          .from(entities)
          .where(inArray(entities.projectId, projectIds))
        
        if (stats) {
          entityStats = stats
        }
      }

      return reply.send({
        stats: {
          projects: {
            total: projectStats?.total || '0',
            active: String(parseInt(projectStats?.total || '0') - parseInt(projectStats?.archived || '0')),
            archived: projectStats?.archived || '0'
          },
          collections: {
            total: collectionStats?.total || '0'
          },
          entities: {
            total: entityStats?.total || '0'
          }
        }
      })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get dashboard stats')
      return reply.status(500).send({ error: 'Failed to get dashboard stats' })
    }
  })

  /**
   * Archive a project
   * PUT /projects/:projectId/archive
   */
  fastify.put<{
    Params: {
      projectId: string
    }
  }>('/projects/:projectId/archive', async (request, reply) => {
    try {
      const { projectId } = request.params

      const [project] = await db
        .update(projects)
        .set({
          isArchived: true,
          archivedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(projects.id, projectId))
        .returning()

      if (!project) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      return reply.send({ project })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to archive project')
      return reply.status(500).send({ error: 'Failed to archive project' })
    }
  })

  /**
   * Unarchive a project
   * PUT /projects/:projectId/unarchive
   */
  fastify.put<{
    Params: {
      projectId: string
    }
  }>('/projects/:projectId/unarchive', async (request, reply) => {
    try {
      const { projectId } = request.params

      const [project] = await db
        .update(projects)
        .set({
          isArchived: false,
          archivedAt: null,
          updatedAt: new Date()
        })
        .where(eq(projects.id, projectId))
        .returning()

      if (!project) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      return reply.send({ project })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to unarchive project')
      return reply.status(500).send({ error: 'Failed to unarchive project' })
    }
  })

  /**
   * Generate or claim short URL for project
   * POST /projects/:projectId/short-url
   */
  fastify.post<{
    Params: {
      projectId: string
    }
    Body: {
      customUrl?: string
    }
  }>('/projects/:projectId/short-url', async (request, reply) => {
    try {
      const { projectId } = request.params
      const { customUrl } = request.body || {}

      // Reserved words
      const reservedWords = [
        'admin', 'api', 'app', 'auth', 'blog', 'dashboard', 'docs',
        'help', 'login', 'logout', 'public', 'settings', 'support', 'terms', 'privacy'
      ]

      let shortUrl: string

      if (customUrl) {
        if (reservedWords.includes(customUrl.toLowerCase())) {
          return reply.status(400).send({ error: 'Short URL is reserved' })
        }
        if (customUrl.length > 120) {
          return reply.status(400).send({ error: 'Short URL must be 120 characters or less' })
        }
        if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(customUrl) && customUrl.length > 1) {
          return reply.status(400).send({ error: 'Short URL must contain only lowercase letters, numbers, and hyphens' })
        }
        shortUrl = customUrl
      } else {
        // Generate random 6-8 character code
        shortUrl = randomBytes(4).toString('hex')
      }

      // Check availability (exclude the current project so re-claiming the same URL works)
      const [existing] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.shortUrl, shortUrl), sql`${projects.id} != ${projectId}`))
        .limit(1)

      if (existing) {
        return reply.status(409).send({ error: 'Short URL already taken' })
      }

      // Claim short URL
      const [project] = await db
        .update(projects)
        .set({
          shortUrl,
          shortUrlClaimedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(projects.id, projectId))
        .returning()

      return reply.send({ project })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to claim short URL')
      return reply.status(500).send({ error: 'Failed to claim short URL' })
    }
  })

  /**
   * Release/delete short URL for project
   * DELETE /projects/:projectId/short-url
   */
  fastify.delete<{
    Params: {
      projectId: string
    }
  }>('/projects/:projectId/short-url', async (request, reply) => {
    try {
      const { projectId } = request.params

      await db
        .update(projects)
        .set({
          shortUrl: null,
          shortUrlClaimedAt: null,
          updatedAt: new Date()
        })
        .where(eq(projects.id, projectId))

      return reply.status(204).send()
    } catch (error) {
      fastify.log.error({ error }, 'Failed to release short URL')
      return reply.status(500).send({ error: 'Failed to release short URL' })
    }
  })

  /**
   * Check if short URL is available
   * POST /short-urls/check
   */
  fastify.post<{
    Body: {
      shortUrl: string
      type: 'project' | 'collection'
    }
  }>('/short-urls/check', async (request, reply) => {
    try {
      const { shortUrl, type } = request.body

      if (!shortUrl || !type) {
        return reply.status(400).send({ error: 'shortUrl and type are required' })
      }

      // Reserved words
      const reservedWords = [
        'admin', 'api', 'app', 'auth', 'blog', 'dashboard', 'docs',
        'help', 'login', 'logout', 'public', 'settings', 'support', 'terms', 'privacy'
      ]

      if (reservedWords.includes(shortUrl.toLowerCase())) {
        return reply.send({ available: false, reason: 'reserved' })
      }

      let existing
      if (type === 'project') {
        [existing] = await db
          .select()
          .from(projects)
          .where(eq(projects.shortUrl, shortUrl))
          .limit(1)
      } else {
        [existing] = await db
          .select()
          .from(projectCollections)
          .where(eq(projectCollections.shortUrl, shortUrl))
          .limit(1)
      }

      return reply.send({
        available: !existing,
        reason: existing ? 'taken' : undefined
      })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to check short URL availability')
      return reply.status(500).send({ error: 'Failed to check short URL availability' })
    }
  })

  /**
   * Resolve project short URL (redirect)
   * GET /p/:shortUrl
   */
  fastify.get<{
    Params: {
      shortUrl: string
    }
  }>('/p/:shortUrl', async (request, reply) => {
    try {
      const { shortUrl } = request.params

      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.shortUrl, shortUrl))
        .limit(1)

      if (!project) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      // Return project data (shell can handle redirect)
      return reply.send({
        projectId: project.id,
        redirectTo: `/projects/${project.id}`
      })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to resolve project short URL')
      return reply.status(500).send({ error: 'Failed to resolve project short URL' })
    }
  })

  /**
   * Resolve collection short URL (redirect)
   * GET /c/:shortUrl
   */
  fastify.get<{
    Params: {
      shortUrl: string
    }
  }>('/c/:shortUrl', async (request, reply) => {
    try {
      const { shortUrl } = request.params

      const [collection] = await db
        .select()
        .from(projectCollections)
        .where(eq(projectCollections.shortUrl, shortUrl))
        .limit(1)

      if (!collection) {
        return reply.status(404).send({ error: 'Collection not found' })
      }

      // Return collection data (shell can handle redirect)
      return reply.send({
        collectionId: collection.id,
        redirectTo: `/collections/${collection.id}`
      })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to resolve collection short URL')
      return reply.status(500).send({ error: 'Failed to resolve collection short URL' })
    }
  })
}

export default dashboardPlugin
