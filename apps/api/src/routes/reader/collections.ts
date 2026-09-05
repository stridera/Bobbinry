/** Collections (sagas) on the public reader. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { chapterPublications, projects, projectCollections, projectCollectionMemberships, projectPublishConfig } from '../../db/schema'
import { eq, and, asc, sql, isNull } from 'drizzle-orm'
import { UUID_RE } from '../../lib/slugs'
import { resolveAuthor } from './shared'

const collectionsRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================
  // COLLECTIONS (public reader)
  // ============================================

  /**
   * Get collection details and published projects for reader page
   * GET /public/collections/by-author/:username/:collectionId
   */
  fastify.get<{
    Params: { username: string; collectionId: string }
  }>('/public/collections/by-author/:username/:collectionId', async (request, reply) => {
    const correlationId = request.id
    try {
      const { username, collectionId } = request.params

      const author = await resolveAuthor(username)
      if (!author) {
        return reply.status(404).send({ error: 'Author not found', correlationId })
      }

      // Fetch collection owned by this author. The URL param may be the
      // collection's short URL or a raw UUID (legacy links).
      const [collection] = await db
        .select({
          id: projectCollections.id,
          name: projectCollections.name,
          description: projectCollections.description,
          coverImage: projectCollections.coverImage,
          colorTheme: projectCollections.colorTheme,
          shortUrl: projectCollections.shortUrl,
        })
        .from(projectCollections)
        .where(and(
          UUID_RE.test(collectionId)
            ? eq(projectCollections.id, collectionId)
            : eq(projectCollections.shortUrl, collectionId),
          eq(projectCollections.userId, author.userId),
          isNull(projectCollections.deletedAt),
        ))
        .limit(1)

      if (!collection) {
        return reply.status(404).send({ error: 'Collection not found', correlationId })
      }

      // Fetch ordered published projects in this collection
      const publishedProjects = await db
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          coverImage: projects.coverImage,
          shortUrl: projects.shortUrl,
          createdAt: projects.createdAt,
          orderIndex: projectCollectionMemberships.orderIndex,
        })
        .from(projectCollectionMemberships)
        .innerJoin(projects, eq(projects.id, projectCollectionMemberships.projectId))
        .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
        .where(and(
          eq(projectCollectionMemberships.collectionId, collection.id),
          isNull(projects.deletedAt),
          eq(projectPublishConfig.publishingMode, 'live'),
          eq(projectPublishConfig.projectVisibility, 'public'),
          sql`EXISTS (SELECT 1 FROM ${chapterPublications} WHERE ${chapterPublications.projectId} = ${projects.id} AND ${chapterPublications.isPublished} = true)`
        ))
        .orderBy(asc(projectCollectionMemberships.orderIndex))

      // Only expose collection if it has 2+ published projects
      if (publishedProjects.length < 2) {
        return reply.status(404).send({ error: 'Collection not found', correlationId })
      }

      return reply.send({ collection, author, projects: publishedProjects, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get public collection')
      return reply.status(500).send({ error: 'Failed to get collection', correlationId })
    }
  })
}

export default collectionsRoutes
