/**
 * Project Collections API
 *
 * Handles grouping projects into series/collections (e.g., Book 1, Book 2, Book 3)
 * Also handles short URL management for collections
 */

import { FastifyPluginAsync } from 'fastify'
import { parse as parseYAML } from 'yaml'
import { db } from '../db/connection'
import { projectCollections, projectCollectionMemberships, projects, bobbinsInstalled, entities } from '../db/schema'
import { eq, and, desc, sql, isNull, isNotNull, inArray } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import { requireAuth } from '../middleware/auth'
import { ManifestCompiler } from '@bobbinry/compiler'
import { loadDiskManifests, getManifestScopes, loadManifestFromBobbinsPath } from '../lib/disk-manifests'

/** Internal helper for collection ownership checks. */
async function checkCollectionOwnership(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  collectionId: string,
  deletedOnly: boolean
): Promise<typeof projectCollections.$inferSelect | null> {
  const deletedFilter = deletedOnly ? isNotNull(projectCollections.deletedAt) : isNull(projectCollections.deletedAt)
  const [collection] = await db
    .select()
    .from(projectCollections)
    .where(and(eq(projectCollections.id, collectionId), deletedFilter))
    .limit(1)

  if (!collection) {
    reply.status(404).send({ error: 'Collection not found' })
    return null
  }

  if (collection.userId !== request.user!.id) {
    reply.status(403).send({ error: 'You do not own this collection' })
    return null
  }

  return collection
}

/** Verify the authenticated user owns a non-deleted collection. */
function requireCollectionOwnership(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  collectionId: string
) {
  return checkCollectionOwnership(request, reply, collectionId, false)
}

/** Verify the authenticated user owns a soft-deleted collection. Used for restore/permanent-delete. */
function requireDeletedCollectionOwnership(
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  collectionId: string
) {
  return checkCollectionOwnership(request, reply, collectionId, true)
}

const collectionsPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * List user's collections with project counts
   * GET /users/me/collections
   */
  fastify.get<{
    Querystring: {
      userId: string
    }
  }>('/users/me/collections', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const userId = request.user!.id

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
        .where(and(eq(projectCollections.userId, userId), isNull(projectCollections.deletedAt)))
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
  }>('/collections', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const userId = request.user!.id
      const { name, description, colorTheme, coverImage } = request.body

      if (!name) {
        return reply.status(400).send({ error: 'name is required' })
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
        .where(and(eq(projectCollections.id, collectionId), isNull(projectCollections.deletedAt)))
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
  }>('/collections/:collectionId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { collectionId } = request.params
      const updates = request.body

      const owned = await requireCollectionOwnership(request, reply, collectionId)
      if (!owned) return

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
   * Soft-delete collection (moves to trash)
   * DELETE /collections/:collectionId
   */
  fastify.delete<{
    Params: {
      collectionId: string
    }
  }>('/collections/:collectionId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { collectionId } = request.params

      const owned = await requireCollectionOwnership(request, reply, collectionId)
      if (!owned) return

      await db
        .update(projectCollections)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(projectCollections.id, collectionId))

      return reply.status(204).send()
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete collection')
      return reply.status(500).send({ error: 'Failed to delete collection' })
    }
  })

  /**
   * Restore collection from trash
   * PUT /collections/:collectionId/restore
   */
  fastify.put<{
    Params: {
      collectionId: string
    }
  }>('/collections/:collectionId/restore', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { collectionId } = request.params

      const owned = await requireDeletedCollectionOwnership(request, reply, collectionId)
      if (!owned) return

      const [collection] = await db
        .update(projectCollections)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(projectCollections.id, collectionId))
        .returning()

      return reply.send({ collection })
    } catch (error) {
      fastify.log.error({ error }, 'Failed to restore collection')
      return reply.status(500).send({ error: 'Failed to restore collection' })
    }
  })

  /**
   * Permanently delete collection (hard delete)
   * DELETE /collections/:collectionId/permanent
   */
  fastify.delete<{
    Params: {
      collectionId: string
    }
  }>('/collections/:collectionId/permanent', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { collectionId } = request.params

      const owned = await requireDeletedCollectionOwnership(request, reply, collectionId)
      if (!owned) return

      await db
        .delete(projectCollections)
        .where(eq(projectCollections.id, collectionId))

      return reply.status(204).send()
    } catch (error) {
      fastify.log.error({ error }, 'Failed to permanently delete collection')
      return reply.status(500).send({ error: 'Failed to permanently delete collection' })
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

      // Aggregate entity count across all projects in the collection. Word
      // counts would require fetching every entityData JSON blob; that's a
      // separate feature when/if a UI surfaces it.
      let entityCount = 0
      if (projectIds.length > 0) {
        const [row] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(entities)
          .where(inArray(entities.projectId, projectIds))
        entityCount = row?.count ?? 0
      }

      return reply.send({
        stats: {
          projectCount: projectIds.length,
          entityCount,
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
  }>('/collections/:collectionId/projects/:projectId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { collectionId, projectId } = request.params
      const { orderIndex = 0 } = request.body

      const owned = await requireCollectionOwnership(request, reply, collectionId)
      if (!owned) return

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
  }>('/collections/:collectionId/projects/:projectId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { collectionId, projectId } = request.params

      const owned = await requireCollectionOwnership(request, reply, collectionId)
      if (!owned) return

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
  }>('/collections/:collectionId/projects/reorder', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { collectionId } = request.params
      const { projectIds } = request.body

      const owned = await requireCollectionOwnership(request, reply, collectionId)
      if (!owned) return

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
  }>('/collections/:collectionId/short-url', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { collectionId } = request.params
      const { customUrl } = request.body

      const owned = await requireCollectionOwnership(request, reply, collectionId)
      if (!owned) return

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
  }>('/collections/:collectionId/short-url', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { collectionId } = request.params

      const owned = await requireCollectionOwnership(request, reply, collectionId)
      if (!owned) return

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

  // ─── Collection-scoped bobbin management ──────────────────────────

  /**
   * Install bobbin at collection scope
   * POST /collections/:collectionId/bobbins/install
   */
  fastify.post<{
    Params: { collectionId: string }
    Body: {
      manifestPath?: string
      manifestContent?: string
      manifestType?: 'yaml' | 'json'
    }
  }>('/collections/:collectionId/bobbins/install', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { collectionId } = request.params
      const { manifestPath, manifestContent, manifestType } = request.body

      const owned = await requireCollectionOwnership(request, reply, collectionId)
      if (!owned) return

      // Get manifest content
      let content: string
      let type: 'yaml' | 'json'

      if (manifestPath) {
        const result = await loadManifestFromBobbinsPath(manifestPath)
        if (!result.ok) {
          return reply.status(result.status).send({ error: result.error, message: result.message })
        }
        content = result.content
        type = result.type
      } else if (manifestContent) {
        content = manifestContent
        type = manifestType || 'json'
      } else {
        return reply.status(400).send({ error: 'Either manifestPath or manifestContent is required' })
      }

      let manifest: any
      try {
        manifest = type === 'yaml' ? parseYAML(content) : JSON.parse(content)
      } catch {
        return reply.status(400).send({ error: 'Invalid manifest format' })
      }

      // Validate that the manifest supports collection scope
      const scopes = getManifestScopes(manifest)
      if (!scopes.includes('collection')) {
        return reply.status(400).send({ error: `Bobbin '${manifest.id}' does not support collection-scope installation` })
      }

      // Compile & validate
      const compiler = new ManifestCompiler({})
      const compileResult = await compiler.compile(manifest)
      if (!compileResult.success) {
        return reply.status(400).send({ error: 'Manifest compilation failed', details: compileResult.errors })
      }

      // Upsert
      const existing = await db.select().from(bobbinsInstalled)
        .where(and(eq(bobbinsInstalled.collectionId, collectionId), eq(bobbinsInstalled.bobbinId, manifest.id)))
        .limit(1)

      if (existing.length > 0) {
        await db.update(bobbinsInstalled)
          .set({ version: manifest.version, manifestJson: manifest, enabled: true, installedAt: new Date() })
          .where(eq(bobbinsInstalled.id, existing[0]!.id))
        return { success: true, action: 'updated', bobbin: { id: manifest.id, name: manifest.name, version: manifest.version } }
      }

      const [installation] = await db.insert(bobbinsInstalled).values({
        collectionId,
        scope: 'collection',
        bobbinId: manifest.id,
        version: manifest.version,
        manifestJson: manifest,
        enabled: true,
      }).returning()

      return { success: true, action: 'installed', bobbin: { id: manifest.id, name: manifest.name, version: manifest.version }, installation: { id: installation!.id, installedAt: installation!.installedAt } }
    } catch (error) {
      fastify.log.error({ error }, 'Failed to install bobbin at collection scope')
      return reply.status(500).send({ error: 'Failed to install bobbin' })
    }
  })

  /**
   * List collection-scoped bobbins
   * GET /collections/:collectionId/bobbins
   */
  fastify.get<{
    Params: { collectionId: string }
  }>('/collections/:collectionId/bobbins', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { collectionId } = request.params

      const owned = await requireCollectionOwnership(request, reply, collectionId)
      if (!owned) return

      const installations = await db.select().from(bobbinsInstalled)
        .where(and(eq(bobbinsInstalled.collectionId, collectionId), eq(bobbinsInstalled.scope, 'collection'), eq(bobbinsInstalled.enabled, true)))

      const diskManifests = await loadDiskManifests(installations.map(i => i.bobbinId))

      return {
        bobbins: installations.filter(i => diskManifests.has(i.bobbinId)).map(install => ({
          id: install.bobbinId,
          version: install.version,
          scope: 'collection',
          manifest: diskManifests.get(install.bobbinId),
          installedAt: install.installedAt,
        }))
      }
    } catch (error) {
      fastify.log.error({ error }, 'Failed to list collection bobbins')
      return reply.status(500).send({ error: 'Failed to list collection bobbins' })
    }
  })

  /**
   * Uninstall bobbin from collection
   * DELETE /collections/:collectionId/bobbins/:bobbinId
   */
  fastify.delete<{
    Params: { collectionId: string; bobbinId: string }
  }>('/collections/:collectionId/bobbins/:bobbinId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { collectionId, bobbinId } = request.params

      const owned = await requireCollectionOwnership(request, reply, collectionId)
      if (!owned) return

      await db.delete(bobbinsInstalled)
        .where(and(eq(bobbinsInstalled.collectionId, collectionId), eq(bobbinsInstalled.bobbinId, bobbinId)))

      return { success: true, message: `Bobbin ${bobbinId} uninstalled from collection` }
    } catch (error) {
      fastify.log.error({ error }, 'Failed to uninstall bobbin from collection')
      return reply.status(500).send({ error: 'Failed to uninstall bobbin' })
    }
  })
}

export default collectionsPlugin
