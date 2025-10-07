import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import {
  users,
  userProfiles,
  subscriptionTiers,
  userFollowers,
  userNotificationPreferences,
  userReadingPreferences,
  betaReaders
} from '../db/schema'
import { eq, and, or, desc, isNull } from 'drizzle-orm'

// Helper to validate UUID
function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

const usersPlugin: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // USER PROFILE ROUTES
  // ============================================================================

  // Get user profile
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/profile', async (request, reply) => {
    try {
      const { userId } = request.params

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      const profile = await db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1)

      if (profile.length === 0) {
        return reply.status(404).send({ error: 'Profile not found' })
      }

      return reply.status(200).send({ profile: profile[0] })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch profile' })
    }
  })

  // Create or update user profile
  fastify.put<{
    Params: { userId: string }
    Body: {
      username?: string
      displayName?: string
      bio?: string
      avatarUrl?: string
      websiteUrl?: string
      twitterHandle?: string
      discordHandle?: string
      otherSocials?: Record<string, any>
    }
  }>('/users/:userId/profile', async (request, reply) => {
    try {
      const { userId } = request.params
      const profileData = request.body

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      // Verify user exists
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)

      if (user.length === 0) {
        return reply.status(404).send({ error: 'User not found' })
      }

      // Check if profile exists
      const existingProfile = await db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1)

      if (existingProfile.length > 0) {
        // Update existing profile
        const [updated] = await db
          .update(userProfiles)
          .set({
            ...profileData,
            updatedAt: new Date()
          })
          .where(eq(userProfiles.userId, userId))
          .returning()

        return reply.status(200).send({ profile: updated })
      } else {
        // Create new profile
        const [created] = await db
          .insert(userProfiles)
          .values({
            userId,
            ...profileData
          })
          .returning()

        return reply.status(201).send({ profile: created })
      }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update profile' })
    }
  })

  // ============================================================================
  // SUBSCRIPTION TIER ROUTES
  // ============================================================================

  // Get all tiers for an author
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/subscription-tiers', async (request, reply) => {
    try {
      const { userId } = request.params

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      const tiers = await db
        .select()
        .from(subscriptionTiers)
        .where(eq(subscriptionTiers.authorId, userId))
        .orderBy(subscriptionTiers.tierLevel)

      return reply.status(200).send({ tiers })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch subscription tiers' })
    }
  })

  // Create subscription tier
  fastify.post<{
    Params: { userId: string }
    Body: {
      name: string
      description?: string
      priceMonthly?: string
      priceYearly?: string
      benefits?: string[]
      chapterDelayDays?: string
      tierLevel: string
    }
  }>('/users/:userId/subscription-tiers', async (request, reply) => {
    try {
      const { userId } = request.params
      const tierData = request.body

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      if (!tierData.name || tierData.name.trim().length === 0) {
        return reply.status(400).send({ error: 'Tier name is required' })
      }

      const [tier] = await db
        .insert(subscriptionTiers)
        .values({
          authorId: userId,
          name: tierData.name,
          description: tierData.description,
          priceMonthly: tierData.priceMonthly,
          priceYearly: tierData.priceYearly,
          benefits: tierData.benefits,
          chapterDelayDays: tierData.chapterDelayDays || '0',
          tierLevel: tierData.tierLevel,
          isActive: true
        })
        .returning()

      return reply.status(201).send({ tier })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to create subscription tier' })
    }
  })

  // Update subscription tier
  fastify.put<{
    Params: { userId: string; tierId: string }
    Body: {
      name?: string
      description?: string
      priceMonthly?: string
      priceYearly?: string
      benefits?: string[]
      chapterDelayDays?: string
      tierLevel?: string
      isActive?: boolean
    }
  }>('/users/:userId/subscription-tiers/:tierId', async (request, reply) => {
    try {
      const { userId, tierId } = request.params
      const tierData = request.body

      if (!isValidUUID(userId) || !isValidUUID(tierId)) {
        return reply.status(400).send({ error: 'Invalid ID format' })
      }

      const [updated] = await db
        .update(subscriptionTiers)
        .set({
          ...tierData,
          updatedAt: new Date()
        })
        .where(and(
          eq(subscriptionTiers.id, tierId),
          eq(subscriptionTiers.authorId, userId)
        ))
        .returning()

      if (!updated) {
        return reply.status(404).send({ error: 'Tier not found' })
      }

      return reply.status(200).send({ tier: updated })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update subscription tier' })
    }
  })

  // Delete subscription tier
  fastify.delete<{
    Params: { userId: string; tierId: string }
  }>('/users/:userId/subscription-tiers/:tierId', async (request, reply) => {
    try {
      const { userId, tierId } = request.params

      if (!isValidUUID(userId) || !isValidUUID(tierId)) {
        return reply.status(400).send({ error: 'Invalid ID format' })
      }

      await db
        .delete(subscriptionTiers)
        .where(and(
          eq(subscriptionTiers.id, tierId),
          eq(subscriptionTiers.authorId, userId)
        ))

      return reply.status(200).send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to delete subscription tier' })
    }
  })

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

  // Follow a user
  fastify.post<{
    Params: { userId: string }
    Body: { followingId: string }
  }>('/users/:userId/follow', async (request, reply) => {
    try {
      const { userId } = request.params
      const { followingId } = request.body

      if (!isValidUUID(userId) || !isValidUUID(followingId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
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

      await db
        .insert(userFollowers)
        .values({
          followerId: userId,
          followingId
        })

      return reply.status(201).send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to follow user' })
    }
  })

  // Unfollow a user
  fastify.delete<{
    Params: { userId: string; followingId: string }
  }>('/users/:userId/follow/:followingId', async (request, reply) => {
    try {
      const { userId, followingId } = request.params

      if (!isValidUUID(userId) || !isValidUUID(followingId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
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

  // ============================================================================
  // NOTIFICATION PREFERENCES ROUTES
  // ============================================================================

  // Get notification preferences
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/notification-preferences', async (request, reply) => {
    try {
      const { userId } = request.params

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

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

  // Update notification preferences
  fastify.put<{
    Params: { userId: string }
    Body: {
      emailNewChapter?: boolean
      emailNewFollower?: boolean
      emailNewSubscriber?: boolean
      emailNewComment?: boolean
      emailDigestFrequency?: 'instant' | 'daily' | 'weekly' | 'never'
      pushNewChapter?: boolean
      pushNewComment?: boolean
    }
  }>('/users/:userId/notification-preferences', async (request, reply) => {
    try {
      const { userId } = request.params
      const prefsData = request.body

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

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
          .set({
            ...prefsData,
            updatedAt: new Date()
          })
          .where(eq(userNotificationPreferences.userId, userId))
          .returning()

        return reply.status(200).send({ preferences: updated })
      } else {
        // Create
        const [created] = await db
          .insert(userNotificationPreferences)
          .values({
            userId,
            ...prefsData
          })
          .returning()

        return reply.status(201).send({ preferences: created })
      }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update notification preferences' })
    }
  })

  // ============================================================================
  // READING PREFERENCES ROUTES
  // ============================================================================

  // Get reading preferences
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/reading-preferences', async (request, reply) => {
    try {
      const { userId } = request.params

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

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

  // Update reading preferences
  fastify.put<{
    Params: { userId: string }
    Body: {
      fontSize?: 'small' | 'medium' | 'large' | 'xlarge'
      fontFamily?: 'serif' | 'sans-serif' | 'monospace'
      lineHeight?: 'compact' | 'normal' | 'relaxed'
      theme?: 'light' | 'dark' | 'auto' | 'sepia'
      readerWidth?: 'narrow' | 'standard' | 'wide' | 'full'
    }
  }>('/users/:userId/reading-preferences', async (request, reply) => {
    try {
      const { userId } = request.params
      const prefsData = request.body

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

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
          .set({
            ...prefsData,
            updatedAt: new Date()
          })
          .where(eq(userReadingPreferences.userId, userId))
          .returning()

        return reply.status(200).send({ preferences: updated })
      } else {
        // Create
        const [created] = await db
          .insert(userReadingPreferences)
          .values({
            userId,
            ...prefsData
          })
          .returning()

        return reply.status(201).send({ preferences: created })
      }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update reading preferences' })
    }
  })

  // ============================================================================
  // BETA READER ROUTES
  // ============================================================================

  // Get beta readers for an author
  fastify.get<{
    Params: { userId: string }
    Querystring: { projectId?: string }
  }>('/users/:userId/beta-readers', async (request, reply) => {
    try {
      const { userId } = request.params
      const { projectId } = request.query

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      if (projectId && !isValidUUID(projectId)) {
        return reply.status(400).send({ error: 'Invalid project ID format' })
      }

      const whereConditions = projectId
        ? and(
            eq(betaReaders.authorId, userId),
            or(
              eq(betaReaders.projectId, projectId),
              isNull(betaReaders.projectId)
            )
          )
        : eq(betaReaders.authorId, userId)

      const readers = await db
        .select()
        .from(betaReaders)
        .where(whereConditions)

      return reply.status(200).send({ betaReaders: readers })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch beta readers' })
    }
  })

  // Add beta reader
  fastify.post<{
    Params: { userId: string }
    Body: {
      readerId: string
      projectId?: string
      accessLevel?: 'beta' | 'arc' | 'early_access'
      notes?: string
    }
  }>('/users/:userId/beta-readers', async (request, reply) => {
    try {
      const { userId } = request.params
      const { readerId, projectId, accessLevel = 'beta', notes } = request.body

      if (!isValidUUID(userId) || !isValidUUID(readerId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      if (projectId && !isValidUUID(projectId)) {
        return reply.status(400).send({ error: 'Invalid project ID format' })
      }

      // Check if already added
      const existing = await db
        .select()
        .from(betaReaders)
        .where(and(
          eq(betaReaders.authorId, userId),
          eq(betaReaders.readerId, readerId),
          projectId ? eq(betaReaders.projectId, projectId) : isNull(betaReaders.projectId)
        ))
        .limit(1)

      if (existing.length > 0) {
        return reply.status(400).send({ error: 'Beta reader already added' })
      }

      const [betaReader] = await db
        .insert(betaReaders)
        .values({
          authorId: userId,
          readerId,
          projectId: projectId || null,
          accessLevel,
          notes,
          isActive: true
        })
        .returning()

      return reply.status(201).send({ betaReader })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to add beta reader' })
    }
  })

  // Update beta reader
  fastify.put<{
    Params: { userId: string; betaReaderId: string }
    Body: {
      accessLevel?: 'beta' | 'arc' | 'early_access'
      notes?: string
      isActive?: boolean
    }
  }>('/users/:userId/beta-readers/:betaReaderId', async (request, reply) => {
    try {
      const { userId, betaReaderId } = request.params
      const updateData = request.body

      if (!isValidUUID(userId) || !isValidUUID(betaReaderId)) {
        return reply.status(400).send({ error: 'Invalid ID format' })
      }

      const [updated] = await db
        .update(betaReaders)
        .set({
          ...updateData,
          updatedAt: new Date()
        })
        .where(and(
          eq(betaReaders.id, betaReaderId),
          eq(betaReaders.authorId, userId)
        ))
        .returning()

      if (!updated) {
        return reply.status(404).send({ error: 'Beta reader not found' })
      }

      return reply.status(200).send({ betaReader: updated })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update beta reader' })
    }
  })

  // Remove beta reader
  fastify.delete<{
    Params: { userId: string; betaReaderId: string }
  }>('/users/:userId/beta-readers/:betaReaderId', async (request, reply) => {
    try {
      const { userId, betaReaderId } = request.params

      if (!isValidUUID(userId) || !isValidUUID(betaReaderId)) {
        return reply.status(400).send({ error: 'Invalid ID format' })
      }

      await db
        .delete(betaReaders)
        .where(and(
          eq(betaReaders.id, betaReaderId),
          eq(betaReaders.authorId, userId)
        ))

      return reply.status(200).send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to remove beta reader' })
    }
  })
}

export default usersPlugin
