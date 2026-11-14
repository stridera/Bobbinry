import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import { projectFollows, projects, projectPublishConfig, subscriptions, users, userNotificationPreferences, notifications, userProfiles, userFollowers } from '../db/schema'
import { eq, and, count, isNull, desc } from 'drizzle-orm'
import { resolveProjectAccess } from '../lib/project-access'
import { requireAuth, optionalAuth, requireVerified, requireSelf } from '../middleware/auth'
import { sendNewFollowerEmail } from '../lib/email'
import { isUuid as isValidUUID } from '../lib/slugs'

const projectFollowsPlugin: FastifyPluginAsync = async (fastify) => {
  // Follow a project
  fastify.post<{
    Params: { projectId: string }
  }>('/projects/:projectId/follow', {
    preHandler: [requireAuth, requireVerified]
  }, async (request, reply) => {
    try {
      const { projectId } = request.params
      const userId = request.user!.id

      if (!isValidUUID(projectId)) {
        return reply.status(400).send({ error: 'Invalid project ID format' })
      }

      // Verify project exists (not trashed) and user doesn't own it
      const [project] = await db
        .select({
          ownerId: projects.ownerId,
          isArchived: projects.isArchived,
          publishingMode: projectPublishConfig.publishingMode,
          projectVisibility: projectPublishConfig.projectVisibility,
          defaultVisibility: projectPublishConfig.defaultVisibility,
        })
        .from(projects)
        .leftJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1)

      if (!project) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      if (project.ownerId === userId) {
        return reply.status(400).send({ error: 'Cannot follow your own project' })
      }

      // Only projects the viewer can actually open: live, not archived, and
      // not private-without-access. The same 404 as a missing project, so a
      // follow attempt cannot probe for hidden work.
      const access = project.isArchived || project.publishingMode !== 'live'
        ? null
        : (await resolveProjectAccess(userId, [{
            id: projectId,
            ownerId: project.ownerId,
            projectVisibility: project.projectVisibility,
            defaultVisibility: project.defaultVisibility,
          }])).get(projectId)
      if (!access || (access.status !== 'ok' && access.status !== 'subscribers_only')) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      // Check if already following
      const [existing] = await db
        .select()
        .from(projectFollows)
        .where(and(
          eq(projectFollows.followerId, userId),
          eq(projectFollows.projectId, projectId)
        ))
        .limit(1)

      if (existing) {
        return reply.status(400).send({ error: 'Already following this project' })
      }

      await db
        .insert(projectFollows)
        .values({ followerId: userId, projectId })

      // Notify project owner of new follower (fire-and-forget)
      ;(async () => {
        // Check owner's notification preferences
        const [prefs] = await db
          .select({ emailNewFollower: userNotificationPreferences.emailNewFollower })
          .from(userNotificationPreferences)
          .where(eq(userNotificationPreferences.userId, project.ownerId))
          .limit(1)

        if (prefs && !prefs.emailNewFollower) return

        // Get owner email and follower name
        const [[owner], [follower], [proj]] = await Promise.all([
          db.select({ email: users.email }).from(users).where(eq(users.id, project.ownerId)).limit(1),
          db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1),
          db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1),
        ])

        if (owner && proj) {
          // Insert in-app notification
          await db.insert(notifications).values({
            recipientId: project.ownerId,
            actorId: userId,
            type: 'new_follower',
            title: `${follower?.name || 'Someone'} followed "${proj.name}"`,
            metadata: {
              projectId,
              projectTitle: proj.name,
              url: `/dashboard`,
            },
          })

          await sendNewFollowerEmail(owner.email, follower?.name || 'Someone', proj.name, project.ownerId)
        }
      })().catch(err => {
        fastify.log.warn({ err, projectId }, 'Failed to send new follower notification')
      })

      return reply.status(201).send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to follow project' })
    }
  })

  // Unfollow a project
  fastify.delete<{
    Params: { projectId: string }
  }>('/projects/:projectId/follow', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { projectId } = request.params
      const userId = request.user!.id

      if (!isValidUUID(projectId)) {
        return reply.status(400).send({ error: 'Invalid project ID format' })
      }

      // Check if user has an active subscription to this project's author
      const [project] = await db
        .select({ ownerId: projects.ownerId })
        .from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1)

      if (project) {
        const [activeSub] = await db
          .select()
          .from(subscriptions)
          .where(and(
            eq(subscriptions.subscriberId, userId),
            eq(subscriptions.authorId, project.ownerId),
            eq(subscriptions.status, 'active')
          ))
          .limit(1)

        if (activeSub) {
          return reply.status(400).send({
            error: 'Cannot unfollow while subscribed. Unsubscribe first.'
          })
        }
      }

      await db
        .delete(projectFollows)
        .where(and(
          eq(projectFollows.followerId, userId),
          eq(projectFollows.projectId, projectId)
        ))

      return reply.status(200).send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to unfollow project' })
    }
  })

  // Get follow status for a project
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/follow-status', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    try {
      const { projectId } = request.params

      if (!isValidUUID(projectId)) {
        return reply.status(400).send({ error: 'Invalid project ID format' })
      }

      // Get follower count
      const [result] = await db
        .select({ count: count() })
        .from(projectFollows)
        .where(eq(projectFollows.projectId, projectId))

      const followerCount = result?.count ?? 0

      // Check if current user is following
      let isFollowing = false
      let muted = false
      if (request.user) {
        const [existing] = await db
          .select({ muted: projectFollows.muted })
          .from(projectFollows)
          .where(and(
            eq(projectFollows.followerId, request.user.id),
            eq(projectFollows.projectId, projectId)
          ))
          .limit(1)
        isFollowing = !!existing
        muted = existing?.muted ?? false
      }

      return reply.status(200).send({ isFollowing, followerCount, muted })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to get follow status' })
    }
  })
  // PATCH /projects/:projectId/follow — toggle mute on a follow
  fastify.patch<{
    Params: { projectId: string }
    Body: { muted: boolean }
  }>('/projects/:projectId/follow', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { projectId } = request.params
      const userId = request.user!.id
      const { muted } = request.body || {}

      if (!isValidUUID(projectId)) {
        return reply.status(400).send({ error: 'Invalid project ID format' })
      }

      if (typeof muted !== 'boolean') {
        return reply.status(400).send({ error: 'muted must be a boolean' })
      }

      // Verify user is following
      const [existing] = await db
        .select()
        .from(projectFollows)
        .where(and(
          eq(projectFollows.followerId, userId),
          eq(projectFollows.projectId, projectId)
        ))
        .limit(1)

      if (!existing) {
        return reply.status(404).send({ error: 'Not following this project' })
      }

      await db
        .update(projectFollows)
        .set({ muted })
        .where(and(
          eq(projectFollows.followerId, userId),
          eq(projectFollows.projectId, projectId)
        ))

      return reply.status(200).send({ success: true, muted })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update follow' })
    }
  })

  // GET /users/:userId/follows — list projects user follows
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/follows', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params

      if (!requireSelf(request, reply, userId)) return

      const follows = await db
        .select({
          projectId: projectFollows.projectId,
          muted: projectFollows.muted,
          createdAt: projectFollows.createdAt,
          projectName: projects.name,
          projectShortUrl: projects.shortUrl,
          authorUsername: userProfiles.username,
        })
        .from(projectFollows)
        .innerJoin(projects, eq(projects.id, projectFollows.projectId))
        .leftJoin(userProfiles, eq(userProfiles.userId, projects.ownerId))
        .where(eq(projectFollows.followerId, userId))

      return reply.status(200).send({ follows })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch follows' })
    }
  })

  // GET /users/:userId/following — everything the user follows, for the
  // Library "Following" tab: authors, and projects with their current access
  // status. Follow rows survive visibility changes; the status tells the UI
  // why a followed project may no longer open.
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/following', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params

      if (!requireSelf(request, reply, userId)) return

      const [authorRows, projectRows] = await Promise.all([
        db
          .select({
            id: userFollowers.followingId,
            username: userProfiles.username,
            displayName: userProfiles.displayName,
            avatarUrl: userProfiles.avatarUrl,
            followedAt: userFollowers.createdAt,
          })
          .from(userFollowers)
          .leftJoin(userProfiles, eq(userProfiles.userId, userFollowers.followingId))
          .where(eq(userFollowers.followerId, userId))
          .orderBy(desc(userFollowers.createdAt)),
        db
          .select({
            id: projects.id,
            name: projects.name,
            slug: projects.shortUrl,
            coverImage: projects.coverImage,
            ownerId: projects.ownerId,
            isArchived: projects.isArchived,
            deletedAt: projects.deletedAt,
            authorUsername: userProfiles.username,
            muted: projectFollows.muted,
            followedAt: projectFollows.createdAt,
            publishingMode: projectPublishConfig.publishingMode,
            projectVisibility: projectPublishConfig.projectVisibility,
            defaultVisibility: projectPublishConfig.defaultVisibility,
          })
          .from(projectFollows)
          .innerJoin(projects, eq(projects.id, projectFollows.projectId))
          .leftJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
          .leftJoin(userProfiles, eq(userProfiles.userId, projects.ownerId))
          .where(and(eq(projectFollows.followerId, userId), isNull(projects.deletedAt)))
          .orderBy(desc(projectFollows.createdAt)),
      ])

      // Archived, trashed or not-live projects never reach the access check.
      const isAvailable = (r: typeof projectRows[number]) =>
        !r.isArchived && !r.deletedAt && r.publishingMode === 'live'
      const access = await resolveProjectAccess(
        userId,
        projectRows.filter(isAvailable).map(r => ({
          id: r.id,
          ownerId: r.ownerId,
          projectVisibility: r.projectVisibility,
          defaultVisibility: r.defaultVisibility,
        })),
      )

      const followedProjects = projectRows.map(r => {
        const status = isAvailable(r) ? access.get(r.id)?.status : undefined
        const accessStatus: 'ok' | 'subscribers_only' | 'beta_only' | 'unavailable' =
          status === 'ok' || status === 'subscribers_only' || status === 'beta_only' ? status : 'unavailable'
        // A project the viewer can no longer open does not leak its details:
        // name, slug and cover come back null (the row stays for Unfollow).
        const visible = accessStatus === 'ok' || accessStatus === 'subscribers_only'
        return {
          id: r.id,
          name: visible ? r.name : null,
          slug: visible ? r.slug : null,
          authorUsername: r.authorUsername,
          coverImage: visible ? r.coverImage : null,
          muted: r.muted,
          followedAt: r.followedAt,
          accessStatus,
        }
      })

      return reply.status(200).send({ authors: authorRows, projects: followedProjects })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch following' })
    }
  })
}

export default projectFollowsPlugin
