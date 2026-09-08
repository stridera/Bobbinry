/** User profile routes (me, avatar, username). Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { userProfiles, users } from '../../db/schema'
import { eq, and, ne, inArray } from 'drizzle-orm'
import { requireAuth, requireSelf } from '../../middleware/auth'
import { cleanupOldAvatarUploads } from '../../lib/upload-cleanup'
import { isUuid as isValidUUID } from '../../lib/slugs'

const profilesRoutes: FastifyPluginAsync = async (fastify) => {
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

  // Resolve multiple profiles in one request
  fastify.get<{
    Querystring: { userIds?: string }
  }>('/users/profiles/batch', async (request, reply) => {
    try {
      const raw = request.query.userIds || ''
      const userIds = [...new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))]

      if (userIds.length === 0) {
        return reply.status(200).send({ profiles: [] })
      }
      if (userIds.length > 100) {
        return reply.status(400).send({ error: 'Maximum 100 userIds allowed' })
      }

      const invalid = userIds.find((id) => !isValidUUID(id))
      if (invalid) {
        return reply.status(400).send({ error: 'Invalid user ID format in userIds list' })
      }

      const profiles = await db
        .select({
          userId: userProfiles.userId,
          username: userProfiles.username,
          displayName: userProfiles.displayName,
          avatarUrl: userProfiles.avatarUrl,
          userName: users.name
        })
        .from(userProfiles)
        .innerJoin(users, eq(users.id, userProfiles.userId))
        .where(inArray(userProfiles.userId, userIds))

      return reply.status(200).send({ profiles })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch profiles' })
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
      blueskyHandle?: string
      threadsHandle?: string
      instagramHandle?: string
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

      // Validate username if provided
      if (profileData.username !== undefined && profileData.username !== null && profileData.username !== '') {
        const uname = profileData.username

        // Length check
        if (uname.length < 3 || uname.length > 30) {
          return reply.status(400).send({ error: 'Username must be between 3 and 30 characters' })
        }

        // Only allow letters, numbers, hyphens, underscores — must start with a letter
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(uname)) {
          return reply.status(400).send({ error: 'Username must start with a letter and contain only letters, numbers, hyphens, and underscores' })
        }

        // Reject anything that looks like a UUID (prevents ambiguity with user ID URLs)
        if (isValidUUID(uname)) {
          return reply.status(400).send({ error: 'Username cannot be a UUID' })
        }

        // Reject hex-only strings 8+ chars (could be confused with truncated IDs)
        if (/^[0-9a-f]{8,}$/i.test(uname) && !/[g-zG-Z]/.test(uname)) {
          return reply.status(400).send({ error: 'Username must contain at least one non-hex letter' })
        }

        // Reserved words that conflict with routes
        const reserved = ['admin', 'api', 'read', 'explore', 'dashboard', 'settings', 'publish', 'login', 'signup', 'marketplace', 'library', 'u', 'auth', 'null', 'undefined']
        if (reserved.includes(uname.toLowerCase())) {
          return reply.status(400).send({ error: 'This username is reserved' })
        }

        // Claiming a name someone else holds is a conflict, not a server
        // error: without this the unique index threw and the generic catch
        // turned an everyday signup collision into a 500.
        const [taken] = await db
          .select({ userId: userProfiles.userId })
          .from(userProfiles)
          .where(and(eq(userProfiles.username, uname), ne(userProfiles.userId, userId)))
          .limit(1)
        if (taken) {
          return reply.status(409).send({ error: 'This username is already taken' })
        }
      }

      // Check if profile exists
      const existingProfile = await db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1)

      // Allow-list: never trust spread body — it would let the caller overwrite
      // userId, createdAt, or any future column.
      const profileUpdates: Record<string, unknown> = {}
      if (profileData.username !== undefined) profileUpdates.username = profileData.username
      if (profileData.displayName !== undefined) profileUpdates.displayName = profileData.displayName
      if (profileData.bio !== undefined) profileUpdates.bio = profileData.bio
      if (profileData.avatarUrl !== undefined) profileUpdates.avatarUrl = profileData.avatarUrl
      if (profileData.websiteUrl !== undefined) profileUpdates.websiteUrl = profileData.websiteUrl
      if (profileData.blueskyHandle !== undefined) profileUpdates.blueskyHandle = profileData.blueskyHandle
      if (profileData.threadsHandle !== undefined) profileUpdates.threadsHandle = profileData.threadsHandle
      if (profileData.instagramHandle !== undefined) profileUpdates.instagramHandle = profileData.instagramHandle
      if (profileData.discordHandle !== undefined) profileUpdates.discordHandle = profileData.discordHandle
      if (profileData.otherSocials !== undefined) profileUpdates.otherSocials = profileData.otherSocials

      let result: { profile: any; status: number }

      if (existingProfile.length > 0) {
        // Update existing profile
        const [updated] = await db
          .update(userProfiles)
          .set({
            ...profileUpdates,
            updatedAt: new Date()
          })
          .where(eq(userProfiles.userId, userId))
          .returning()

        result = { profile: updated, status: 200 }
      } else {
        // Create new profile
        const [created] = await db
          .insert(userProfiles)
          .values({
            ...profileUpdates,
            userId,
          })
          .returning()

        result = { profile: created, status: 201 }
      }

      // If avatar was cleared, clean up all avatar uploads from S3
      if (profileData.avatarUrl !== undefined && !profileData.avatarUrl) {
        cleanupOldAvatarUploads(userId).catch(err => {
          fastify.log.warn({ err, userId }, 'Failed to cleanup avatar uploads on removal')
        })
      }

      return reply.status(result.status).send({ profile: result.profile })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update profile' })
    }
  })
}

export default profilesRoutes
