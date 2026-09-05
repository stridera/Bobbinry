/** Public profile and published projects. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { userProfiles, userFollowers, projects, projectPublishConfig, users, chapterPublications, entities } from '../../db/schema'
import { eq, and, desc, isNull, sql, count, inArray } from 'drizzle-orm'
import { notDeleted } from '../../lib/entity-scope'
import { isUuid as isValidUUID } from '../../lib/slugs'

const publicProfileRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // PUBLIC PROFILE ROUTES
  // ============================================================================

  // Get user profile by username (public)
  fastify.get<{
    Params: { username: string }
  }>('/users/by-username/:username', async (request, reply) => {
    try {
      const { username } = request.params

      if (!username || username.length < 1 || username.length > 50) {
        return reply.status(400).send({ error: 'Invalid username' })
      }

      const [profile] = await db
        .select({
          userId: userProfiles.userId,
          username: userProfiles.username,
          displayName: userProfiles.displayName,
          bio: userProfiles.bio,
          avatarUrl: userProfiles.avatarUrl,
          websiteUrl: userProfiles.websiteUrl,
          blueskyHandle: userProfiles.blueskyHandle,
          threadsHandle: userProfiles.threadsHandle,
          instagramHandle: userProfiles.instagramHandle,
          discordHandle: userProfiles.discordHandle,
          otherSocials: userProfiles.otherSocials,
          createdAt: userProfiles.createdAt,
          userName: users.name,
          // users.email is intentionally omitted — this endpoint is unauth and
          // would otherwise let anyone harvest authors' email addresses by
          // enumerating usernames.
        })
        .from(userProfiles)
        .innerJoin(users, eq(users.id, userProfiles.userId))
        .where(eq(userProfiles.username, username))
        .limit(1)

      if (!profile) {
        return reply.status(404).send({ error: 'User not found' })
      }

      // Get follower/following counts
      const [followerCount] = await db
        .select({ count: count() })
        .from(userFollowers)
        .where(eq(userFollowers.followingId, profile.userId))

      const [followingCount] = await db
        .select({ count: count() })
        .from(userFollowers)
        .where(eq(userFollowers.followerId, profile.userId))

      return reply.status(200).send({
        profile: {
          ...profile,
          followerCount: followerCount?.count ?? 0,
          followingCount: followingCount?.count ?? 0
        }
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch profile by username' })
    }
  })

  // Get published projects for a user (public)
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/published-projects', async (request, reply) => {
    try {
      const { userId } = request.params

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      // Get projects that have a publish config with mode 'live'
      const publishedProjects = await db
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          coverImage: projects.coverImage,
          shortUrl: projects.shortUrl,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          publishingMode: projectPublishConfig.publishingMode
        })
        .from(projects)
        .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
        // Same rules as /public/authors/:username/projects — this endpoint is
        // public, so a trashed or private project must not appear here either.
        .where(and(
          eq(projects.ownerId, userId),
          eq(projects.isArchived, false),
          isNull(projects.deletedAt),
          eq(projectPublishConfig.publishingMode, 'live'),
          eq(projectPublishConfig.projectVisibility, 'public'),
          sql`EXISTS (SELECT 1 FROM ${chapterPublications} WHERE ${chapterPublications.projectId} = ${projects.id} AND ${chapterPublications.isPublished} = true)`
        ))
        .orderBy(desc(projects.updatedAt))

      // Per-project aggregates over published chapters: word total + count.
      // One scan covers every project in the response, then we merge into the
      // per-project shape below.
      const projectIds = publishedProjects.map(p => p.id)
      const statsByProject = new Map<string, { wordCount: number; chapterCount: number }>()
      if (projectIds.length > 0) {
        const stats = await db
          .select({
            projectId: chapterPublications.projectId,
            wordCount: sql<number>`COALESCE(SUM(COALESCE((${entities.entityData}->>'word_count')::int, 0)), 0)::int`,
            chapterCount: sql<number>`COUNT(*)::int`,
          })
          .from(chapterPublications)
          .innerJoin(entities, and(eq(entities.id, chapterPublications.chapterId), notDeleted()))
          .where(and(
            inArray(chapterPublications.projectId, projectIds),
            eq(chapterPublications.isPublished, true),
          ))
          .groupBy(chapterPublications.projectId)
        for (const row of stats) {
          statsByProject.set(row.projectId, {
            wordCount: row.wordCount ?? 0,
            chapterCount: row.chapterCount ?? 0,
          })
        }
      }

      const projectsWithStats = publishedProjects.map(p => {
        const s = statsByProject.get(p.id)
        return {
          ...p,
          wordCount: s?.wordCount ?? 0,
          chapterCount: s?.chapterCount ?? 0,
        }
      })

      return reply.status(200).send({ projects: projectsWithStats })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch published projects' })
    }
  })

  // Check if current user is following a target user (public, returns boolean)
  fastify.get<{
    Params: { userId: string; targetId: string }
  }>('/users/:userId/is-following/:targetId', async (request, reply) => {
    try {
      const { userId, targetId } = request.params

      if (!isValidUUID(userId) || !isValidUUID(targetId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      const [existing] = await db
        .select()
        .from(userFollowers)
        .where(and(
          eq(userFollowers.followerId, userId),
          eq(userFollowers.followingId, targetId)
        ))
        .limit(1)

      return reply.status(200).send({ isFollowing: !!existing })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to check follow status' })
    }
  })
}

export default publicProfileRoutes
