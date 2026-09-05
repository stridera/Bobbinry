/** Reading preferences. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { userReadingPreferences } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth, requireSelf } from '../../middleware/auth'

const readingPrefsRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // READING PREFERENCES ROUTES
  // ============================================================================

  // Get reading preferences (own preferences only)
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/reading-preferences', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params

      // Verify user is accessing their own preferences
      if (!requireSelf(request, reply, userId)) return

      const preferences = await db
        .select()
        .from(userReadingPreferences)
        .where(eq(userReadingPreferences.userId, userId))
        .limit(1)

      if (preferences.length === 0) {
        // Return defaults
        return reply.status(200).send({
          preferences: {
            userId,
            fontSize: 'medium',
            fontFamily: 'serif',
            lineHeight: 'normal',
            theme: 'auto',
            readerWidth: 'standard'
          }
        })
      }

      return reply.status(200).send({ preferences: preferences[0] })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch reading preferences' })
    }
  })

  // Update reading preferences (own preferences only)
  fastify.put<{
    Params: { userId: string }
    Body: {
      fontSize?: 'small' | 'medium' | 'large' | 'xlarge'
      fontFamily?: 'serif' | 'sans-serif' | 'monospace'
      lineHeight?: 'compact' | 'normal' | 'relaxed'
      theme?: 'light' | 'dark' | 'auto' | 'sepia'
      readerWidth?: 'narrow' | 'standard' | 'wide' | 'full'
    }
  }>('/users/:userId/reading-preferences', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const prefsData = request.body

      // Verify user is updating their own preferences
      if (!requireSelf(request, reply, userId)) return

      // Allow-list updatable fields — see notification-preferences handler
      // above for the rationale.
      const safe: Partial<typeof userReadingPreferences.$inferInsert> = {}
      if (prefsData.fontSize !== undefined) safe.fontSize = prefsData.fontSize
      if (prefsData.fontFamily !== undefined) safe.fontFamily = prefsData.fontFamily
      if (prefsData.lineHeight !== undefined) safe.lineHeight = prefsData.lineHeight
      if (prefsData.theme !== undefined) safe.theme = prefsData.theme
      if (prefsData.readerWidth !== undefined) safe.readerWidth = prefsData.readerWidth

      // Check if preferences exist
      const existing = await db
        .select()
        .from(userReadingPreferences)
        .where(eq(userReadingPreferences.userId, userId))
        .limit(1)

      if (existing.length > 0) {
        // Update
        const [updated] = await db
          .update(userReadingPreferences)
          .set({ ...safe, updatedAt: new Date() })
          .where(eq(userReadingPreferences.userId, userId))
          .returning()

        return reply.status(200).send({ preferences: updated })
      } else {
        // Create
        const [created] = await db
          .insert(userReadingPreferences)
          .values({ userId, ...safe })
          .returning()

        return reply.status(201).send({ preferences: created })
      }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update reading preferences' })
    }
  })
}

export default readingPrefsRoutes
