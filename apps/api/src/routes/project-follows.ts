import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import { projectFollows, projects, subscriptions, users, userNotificationPreferences, notifications } from '../db/schema'
import { eq, and, count } from 'drizzle-orm'
import { requireAuth, optionalAuth, requireVerified } from '../middleware/auth'
import { sendNewFollowerEmail } from '../lib/email'

function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

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

      // Verify project exists and user doesn't own it
      const [project] = await db
        .select({ ownerId: projects.ownerId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)

      if (!project) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      if (project.ownerId === userId) {
        return reply.status(400).send({ error: 'Cannot follow your own project' })
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

          await sendNewFollowerEmail(owner.email, follower?.name || 'Someone', proj.name)
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
        .where(eq(projects.id, projectId))
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
      if (request.user) {
        const [existing] = await db
          .select()
          .from(projectFollows)
          .where(and(
            eq(projectFollows.followerId, request.user.id),
            eq(projectFollows.projectId, projectId)
          ))
          .limit(1)
        isFollowing = !!existing
      }

      return reply.status(200).send({ isFollowing, followerCount })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to get follow status' })
    }
  })
}

export default projectFollowsPlugin
