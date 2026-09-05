/** Follower routes (user and project follows). Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { userFollowers } from '../../db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { requireAuth, requireSelf } from '../../middleware/auth'
import { incrementCounter } from '../../lib/metrics'
import { isUuid as isValidUUID } from '../../lib/slugs'

const followsRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // FOLLOWER ROUTES
  // ============================================================================

  // Get followers for a user
  fastify.get<{
    Params: { userId: string }
    Querystring: { type?: 'followers' | 'following' }
  }>('/users/:userId/followers', async (request, reply) => {
    try {
      const { userId } = request.params
      const { type = 'followers' } = request.query

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      let followers
      if (type === 'followers') {
        followers = await db
          .select()
          .from(userFollowers)
          .where(eq(userFollowers.followingId, userId))
          .orderBy(desc(userFollowers.createdAt))
      } else {
        followers = await db
          .select()
          .from(userFollowers)
          .where(eq(userFollowers.followerId, userId))
          .orderBy(desc(userFollowers.createdAt))
      }

      return reply.status(200).send({ followers })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch followers' })
    }
  })

  // Follow a user (requires auth, own actions only)
  fastify.post<{
    Params: { userId: string }
    Body: { followingId: string }
  }>('/users/:userId/follow', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const { followingId } = request.body

      // Verify user is performing their own follow action
      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(followingId)) {
        return reply.status(400).send({ error: 'Invalid following ID format' })
      }

      if (userId === followingId) {
        return reply.status(400).send({ error: 'Cannot follow yourself' })
      }

      // Check if already following
      const existing = await db
        .select()
        .from(userFollowers)
        .where(and(
          eq(userFollowers.followerId, userId),
          eq(userFollowers.followingId, followingId)
        ))
        .limit(1)

      if (existing.length > 0) {
        return reply.status(400).send({ error: 'Already following this user' })
      }

      const inserted = await db
        .insert(userFollowers)
        .values({
          followerId: userId,
          followingId
        })
        .onConflictDoNothing()
        .returning({ followerId: userFollowers.followerId })

      if (inserted.length === 0) {
        incrementCounter('users.follow.conflict')
        return reply.status(400).send({ error: 'Already following this user' })
      }

      return reply.status(201).send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to follow user' })
    }
  })

  // Unfollow a user (requires auth, own actions only)
  fastify.delete<{
    Params: { userId: string; followingId: string }
  }>('/users/:userId/follow/:followingId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId, followingId } = request.params

      // Verify user is performing their own unfollow action
      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(followingId)) {
        return reply.status(400).send({ error: 'Invalid following ID format' })
      }

      await db
        .delete(userFollowers)
        .where(and(
          eq(userFollowers.followerId, userId),
          eq(userFollowers.followingId, followingId)
        ))

      return reply.status(200).send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to unfollow user' })
    }
  })
}

export default followsRoutes
