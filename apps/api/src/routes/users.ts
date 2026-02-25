import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import {
  userProfiles,
  subscriptionTiers,
  userFollowers,
  userNotificationPreferences,
  userReadingPreferences,
  betaReaders,
  projects,
  projectPublishConfig,
  users,
  userBobbinsInstalled,
  chapterViews,
  chapterPublications,
  entities
} from '../db/schema'
import { eq, and, or, desc, isNull, sql, count, isNotNull } from 'drizzle-orm'
import { requireAuth, requireSelf } from '../middleware/auth'

// Helper to validate UUID
function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

const usersPlugin: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // USER PROFILE ROUTES
  // ============================================================================

  // Get user profile (public - anyone can view profiles)
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

  // Create or update user profile (own profile only)
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
  }>('/users/:userId/profile', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const profileData = request.body

      // Verify user is updating their own profile
      if (!requireSelf(request, reply, userId)) return

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

  // Get all tiers for an author (public - visible for potential subscribers)
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

  // Create subscription tier (own tiers only)
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
  }>('/users/:userId/subscription-tiers', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const tierData = request.body

      // Verify user is creating their own tier
      if (!requireSelf(request, reply, userId)) return

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

  // Update subscription tier (own tiers only)
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
  }>('/users/:userId/subscription-tiers/:tierId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId, tierId } = request.params
      const tierData = request.body

      // Verify user is updating their own tier
      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(tierId)) {
        return reply.status(400).send({ error: 'Invalid tier ID format' })
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

  // Delete subscription tier (own tiers only)
  fastify.delete<{
    Params: { userId: string; tierId: string }
  }>('/users/:userId/subscription-tiers/:tierId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId, tierId } = request.params

      // Verify user is deleting their own tier
      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(tierId)) {
        return reply.status(400).send({ error: 'Invalid tier ID format' })
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

  // Get beta readers for an author (own beta readers only)
  fastify.get<{
    Params: { userId: string }
    Querystring: { projectId?: string }
  }>('/users/:userId/beta-readers', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const { projectId } = request.query

      // Verify user is accessing their own beta readers
      if (!requireSelf(request, reply, userId)) return

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

  // Add beta reader (own beta readers only)
  fastify.post<{
    Params: { userId: string }
    Body: {
      readerId: string
      projectId?: string
      accessLevel?: 'beta' | 'arc' | 'early_access'
      notes?: string
    }
  }>('/users/:userId/beta-readers', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const { readerId, projectId, accessLevel = 'beta', notes } = request.body

      // Verify user is adding their own beta reader
      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(readerId)) {
        return reply.status(400).send({ error: 'Invalid reader ID format' })
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

  // Update beta reader (own beta readers only)
  fastify.put<{
    Params: { userId: string; betaReaderId: string }
    Body: {
      accessLevel?: 'beta' | 'arc' | 'early_access'
      notes?: string
      isActive?: boolean
    }
  }>('/users/:userId/beta-readers/:betaReaderId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId, betaReaderId } = request.params
      const updateData = request.body

      // Verify user is updating their own beta reader
      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(betaReaderId)) {
        return reply.status(400).send({ error: 'Invalid beta reader ID format' })
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

  // Remove beta reader (own beta readers only)
  fastify.delete<{
    Params: { userId: string; betaReaderId: string }
  }>('/users/:userId/beta-readers/:betaReaderId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId, betaReaderId } = request.params

      // Verify user is removing their own beta reader
      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(betaReaderId)) {
        return reply.status(400).send({ error: 'Invalid beta reader ID format' })
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

  // ============================================================================
  // READER BOBBIN ROUTES
  // ============================================================================

  // Get installed reader bobbins for a user (own bobbins only)
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/reader-bobbins', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      if (!requireSelf(request, reply, userId)) return

      const bobbins = await db
        .select()
        .from(userBobbinsInstalled)
        .where(eq(userBobbinsInstalled.userId, userId))
        .orderBy(desc(userBobbinsInstalled.installedAt))

      return reply.status(200).send({ bobbins })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch reader bobbins' })
    }
  })

  // Install a reader bobbin (own account only)
  fastify.post<{
    Params: { userId: string }
    Body: {
      bobbinId: string
      bobbinType: 'reader_enhancement' | 'delivery_channel'
      config?: Record<string, any>
    }
  }>('/users/:userId/reader-bobbins', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const { bobbinId, bobbinType, config } = request.body
      if (!requireSelf(request, reply, userId)) return

      if (!bobbinId || !bobbinType) {
        return reply.status(400).send({ error: 'bobbinId and bobbinType are required' })
      }

      // Check if already installed
      const [existing] = await db
        .select()
        .from(userBobbinsInstalled)
        .where(and(
          eq(userBobbinsInstalled.userId, userId),
          eq(userBobbinsInstalled.bobbinId, bobbinId)
        ))
        .limit(1)

      if (existing) {
        return reply.status(400).send({ error: 'Bobbin already installed' })
      }

      const [installed] = await db
        .insert(userBobbinsInstalled)
        .values({
          userId,
          bobbinId,
          bobbinType,
          config: config || null,
          isEnabled: true
        })
        .returning()

      return reply.status(201).send({ bobbin: installed })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to install reader bobbin' })
    }
  })

  // Update reader bobbin config (own account only)
  fastify.put<{
    Params: { userId: string; bobbinInstallId: string }
    Body: {
      config?: Record<string, any>
      isEnabled?: boolean
    }
  }>('/users/:userId/reader-bobbins/:bobbinInstallId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId, bobbinInstallId } = request.params
      const updateData = request.body
      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(bobbinInstallId)) {
        return reply.status(400).send({ error: 'Invalid bobbin install ID format' })
      }

      const [updated] = await db
        .update(userBobbinsInstalled)
        .set({
          ...updateData,
          updatedAt: new Date()
        })
        .where(and(
          eq(userBobbinsInstalled.id, bobbinInstallId),
          eq(userBobbinsInstalled.userId, userId)
        ))
        .returning()

      if (!updated) {
        return reply.status(404).send({ error: 'Reader bobbin not found' })
      }

      return reply.status(200).send({ bobbin: updated })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update reader bobbin' })
    }
  })

  // Uninstall a reader bobbin (own account only)
  fastify.delete<{
    Params: { userId: string; bobbinInstallId: string }
  }>('/users/:userId/reader-bobbins/:bobbinInstallId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId, bobbinInstallId } = request.params
      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(bobbinInstallId)) {
        return reply.status(400).send({ error: 'Invalid bobbin install ID format' })
      }

      await db
        .delete(userBobbinsInstalled)
        .where(and(
          eq(userBobbinsInstalled.id, bobbinInstallId),
          eq(userBobbinsInstalled.userId, userId)
        ))

      return reply.status(200).send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to uninstall reader bobbin' })
    }
  })

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

      if (following.length === 0) {
        return reply.status(200).send({ feed: [], total: 0 })
      }

      const followingIds = following.map(f => f.followingId)

      // Get recent published chapters from followed authors
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
          sql`${projects.ownerId} IN (${sql.join(followingIds.map(id => sql`${id}`), sql`, `)})`,
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
              .where(eq(entities.id, item.chapterId))
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

      // Get recent chapter views that are not completed
      const progressItems = await db
        .select({
          viewId: chapterViews.id,
          chapterId: chapterViews.chapterId,
          lastPositionPercent: chapterViews.lastPositionPercent,
          readTimeSeconds: chapterViews.readTimeSeconds,
          startedAt: chapterViews.startedAt,
          completedAt: chapterViews.completedAt
        })
        .from(chapterViews)
        .where(and(
          eq(chapterViews.readerId, userId),
          isNull(chapterViews.completedAt)
        ))
        .orderBy(desc(chapterViews.startedAt))
        .limit(limit)

      // Resolve chapter details and project info
      const progressWithDetails = await Promise.all(
        progressItems.map(async (item) => {
          let chapterTitle = 'Untitled'
          let projectId: string | null = null
          let projectName = 'Unknown Project'
          let projectShortUrl: string | null = null

          try {
            const [entity] = await db
              .select({
                entityData: entities.entityData,
                projectId: entities.projectId
              })
              .from(entities)
              .where(eq(entities.id, item.chapterId))
              .limit(1)

            if (entity) {
              chapterTitle = (entity.entityData as any)?.title || 'Untitled'
              projectId = entity.projectId

              const [project] = await db
                .select({ name: projects.name, shortUrl: projects.shortUrl })
                .from(projects)
                .where(eq(projects.id, entity.projectId))
                .limit(1)
              if (project) {
                projectName = project.name
                projectShortUrl = project.shortUrl
              }
            }
          } catch {}

          return {
            ...item,
            chapterTitle,
            projectId,
            projectName,
            projectShortUrl
          }
        })
      )

      return reply.status(200).send({ progress: progressWithDetails })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch reading progress' })
    }
  })

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
          twitterHandle: userProfiles.twitterHandle,
          discordHandle: userProfiles.discordHandle,
          otherSocials: userProfiles.otherSocials,
          createdAt: userProfiles.createdAt,
          userName: users.name,
          userEmail: users.email
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
        .where(and(
          eq(projects.ownerId, userId),
          eq(projects.isArchived, false),
          eq(projectPublishConfig.publishingMode, 'live')
        ))
        .orderBy(desc(projects.updatedAt))

      return reply.status(200).send({ projects: publishedProjects })
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

export default usersPlugin
