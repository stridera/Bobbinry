/** Feed and reading progress. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { userProfiles, userFollowers, projectFollows, projects, chapterViews, chapterPublications, entities } from '../../db/schema'
import { eq, and, or, desc, isNull, sql, isNotNull } from 'drizzle-orm'
import { requireAuth, requireSelf } from '../../middleware/auth'
import { liveEntity, notDeleted } from '../../lib/entity-scope'

const feedRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // FEED & READING PROGRESS ROUTES
  // ============================================================================

  // Get user's feed - recent publications from followed authors
  fastify.get<{
    Params: { userId: string }
    Querystring: { limit?: string; offset?: string }
  }>('/users/:userId/feed', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      if (!requireSelf(request, reply, userId)) return

      const limit = Math.min(parseInt(request.query.limit || '20', 10), 100)
      const offset = parseInt(request.query.offset || '0', 10)

      // Get IDs of authors this user follows
      const following = await db
        .select({ followingId: userFollowers.followingId })
        .from(userFollowers)
        .where(eq(userFollowers.followerId, userId))

      const followingIds = following.map(f => f.followingId)

      // Get IDs of projects this user follows
      const followedProjects = await db
        .select({ projectId: projectFollows.projectId })
        .from(projectFollows)
        .where(eq(projectFollows.followerId, userId))

      const followedProjectIds = followedProjects.map(f => f.projectId)

      if (followingIds.length === 0 && followedProjectIds.length === 0) {
        return reply.status(200).send({ feed: [], total: 0 })
      }

      // Build WHERE conditions: chapters from followed authors OR followed projects
      const followConditions = []
      if (followingIds.length > 0) {
        followConditions.push(
          sql`${projects.ownerId} IN (${sql.join(followingIds.map(id => sql`${id}`), sql`, `)})`
        )
      }
      if (followedProjectIds.length > 0) {
        followConditions.push(
          sql`${projects.id} IN (${sql.join(followedProjectIds.map(id => sql`${id}`), sql`, `)})`
        )
      }

      // Get recent published chapters from followed authors/projects
      const feedItems = await db
        .select({
          publicationId: chapterPublications.id,
          projectId: chapterPublications.projectId,
          chapterId: chapterPublications.chapterId,
          publishedAt: chapterPublications.publishedAt,
          projectName: projects.name,
          projectCoverImage: projects.coverImage,
          projectShortUrl: projects.shortUrl,
          authorId: projects.ownerId
        })
        .from(chapterPublications)
        .innerJoin(projects, eq(projects.id, chapterPublications.projectId))
        .where(and(
          or(...followConditions),
          eq(chapterPublications.isPublished, true),
          isNotNull(chapterPublications.publishedAt)
        ))
        .orderBy(desc(chapterPublications.publishedAt))
        .limit(limit)
        .offset(offset)

      // Resolve chapter titles from entities
      const feedWithTitles = await Promise.all(
        feedItems.map(async (item) => {
          let chapterTitle = 'Untitled'
          try {
            const [entity] = await db
              .select({ entityData: entities.entityData })
              .from(entities)
              .where(liveEntity(item.chapterId))
              .limit(1)
            if (entity) {
              chapterTitle = (entity.entityData as any)?.title || 'Untitled'
            }
          } catch {}

          // Get author profile
          let authorName = 'Unknown Author'
          try {
            const [profile] = await db
              .select({ displayName: userProfiles.displayName, username: userProfiles.username })
              .from(userProfiles)
              .where(eq(userProfiles.userId, item.authorId))
              .limit(1)
            if (profile) {
              authorName = profile.displayName || profile.username || 'Unknown Author'
            }
          } catch {}

          return {
            ...item,
            chapterTitle,
            authorName
          }
        })
      )

      return reply.status(200).send({ feed: feedWithTitles })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch feed' })
    }
  })

  // Get reading progress - recent incomplete chapter views
  // Uses JOINs to resolve chapter titles and project info in a single query
  fastify.get<{
    Params: { userId: string }
    Querystring: { limit?: string }
  }>('/users/:userId/reading-progress', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      if (!requireSelf(request, reply, userId)) return

      const limit = Math.min(parseInt(request.query.limit || '20', 10), 50)

      // Use a single query with JOINs to get progress + chapter + project data
      // Use DISTINCT ON to deduplicate by chapterId (keeping most recent view)
      const progressItems = await db
        .select({
          viewId: chapterViews.id,
          chapterId: chapterViews.chapterId,
          lastPositionPercent: chapterViews.lastPositionPercent,
          readTimeSeconds: chapterViews.readTimeSeconds,
          startedAt: chapterViews.startedAt,
          chapterTitle: sql<string>`COALESCE(${entities.entityData}->>'title', 'Untitled')`,
          projectId: entities.projectId,
          projectName: sql<string>`COALESCE(${projects.name}, 'Unknown Project')`,
          projectShortUrl: projects.shortUrl,
          authorId: projects.ownerId
        })
        .from(chapterViews)
        .innerJoin(entities, and(eq(entities.id, chapterViews.chapterId), notDeleted()))
        .innerJoin(projects, eq(projects.id, entities.projectId))
        .where(and(
          eq(chapterViews.readerId, userId),
          isNull(chapterViews.completedAt)
        ))
        .orderBy(desc(chapterViews.startedAt))

      // Deduplicate by chapterId in application, keeping most recent per chapter
      const seen = new Set<string>()
      const deduplicated = progressItems.filter(item => {
        if (seen.has(item.chapterId)) return false
        seen.add(item.chapterId)
        return true
      }).slice(0, limit)

      // Batch-resolve author usernames for all unique author IDs
      const authorIds = [...new Set(deduplicated.map(p => p.authorId).filter(Boolean))]
      const authorMap: Record<string, string> = {}

      if (authorIds.length > 0) {
        const authorProfiles = await db
          .select({
            userId: userProfiles.userId,
            username: userProfiles.username
          })
          .from(userProfiles)
          .where(sql`${userProfiles.userId} IN ${authorIds}`)

        for (const profile of authorProfiles) {
          if (profile.username) {
            authorMap[profile.userId] = profile.username
          }
        }
      }

      const enriched = deduplicated.map(item => ({
        viewId: item.viewId,
        chapterId: item.chapterId,
        lastPositionPercent: item.lastPositionPercent,
        readTimeSeconds: item.readTimeSeconds,
        startedAt: item.startedAt,
        chapterTitle: item.chapterTitle,
        projectId: item.projectId,
        projectName: item.projectName,
        projectShortUrl: item.projectShortUrl,
        authorUsername: item.authorId ? (authorMap[item.authorId] || null) : null
      }))

      return reply.status(200).send({ progress: enriched })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch reading progress' })
    }
  })
}

export default feedRoutes
