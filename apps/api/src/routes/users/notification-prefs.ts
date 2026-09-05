/** Notification preferences. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { userNotificationPreferences } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth, requireSelf } from '../../middleware/auth'

const notificationPrefsRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // NOTIFICATION PREFERENCES ROUTES
  // ============================================================================

  // Get notification preferences (own preferences only)
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/notification-preferences', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params

      // Verify user is accessing their own preferences
      if (!requireSelf(request, reply, userId)) return

      const preferences = await db
        .select()
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, userId))
        .limit(1)

      if (preferences.length === 0) {
        // Return defaults
        return reply.status(200).send({
          preferences: {
            userId,
            emailNewChapter: true,
            emailNewFollower: true,
            emailNewSubscriber: true,
            emailNewComment: true,
            emailDigestFrequency: 'daily',
            pushNewChapter: false,
            pushNewComment: false
          }
        })
      }

      return reply.status(200).send({ preferences: preferences[0] })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch notification preferences' })
    }
  })

  // Update notification preferences (own preferences only)
  fastify.put<{
    Params: { userId: string }
    Body: {
      emailNewChapter?: boolean
      emailNewFollower?: boolean
      emailNewSubscriber?: boolean
      emailNewComment?: boolean
      emailBetaReaderJoined?: boolean
      emailDigestFrequency?: 'instant' | 'daily' | 'weekly' | 'never'
      pushNewChapter?: boolean
      pushNewComment?: boolean
    }
  }>('/users/:userId/notification-preferences', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const prefsData = request.body

      // Verify user is updating their own preferences
      if (!requireSelf(request, reply, userId)) return

      // Allow-list updatable fields so a malicious body can't include `userId`
      // (the table's primary key) or any other column and rewrite this row to
      // point at another user's id.
      const safe: Partial<typeof userNotificationPreferences.$inferInsert> = {}
      if (prefsData.emailNewChapter !== undefined) safe.emailNewChapter = prefsData.emailNewChapter
      if (prefsData.emailNewFollower !== undefined) safe.emailNewFollower = prefsData.emailNewFollower
      if (prefsData.emailNewSubscriber !== undefined) safe.emailNewSubscriber = prefsData.emailNewSubscriber
      if (prefsData.emailNewComment !== undefined) safe.emailNewComment = prefsData.emailNewComment
      if (prefsData.emailBetaReaderJoined !== undefined) safe.emailBetaReaderJoined = prefsData.emailBetaReaderJoined
      if (prefsData.emailDigestFrequency !== undefined) safe.emailDigestFrequency = prefsData.emailDigestFrequency
      if (prefsData.pushNewChapter !== undefined) safe.pushNewChapter = prefsData.pushNewChapter
      if (prefsData.pushNewComment !== undefined) safe.pushNewComment = prefsData.pushNewComment

      // Check if preferences exist
      const existing = await db
        .select()
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, userId))
        .limit(1)

      if (existing.length > 0) {
        // Update
        const [updated] = await db
          .update(userNotificationPreferences)
          .set({ ...safe, updatedAt: new Date() })
          .where(eq(userNotificationPreferences.userId, userId))
          .returning()

        return reply.status(200).send({ preferences: updated })
      } else {
        // Create
        const [created] = await db
          .insert(userNotificationPreferences)
          .values({ userId, ...safe })
          .returning()

        return reply.status(201).send({ preferences: created })
      }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update notification preferences' })
    }
  })
}

export default notificationPrefsRoutes
