/** Beta reader invite links. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { userProfiles, userNotificationPreferences, betaReaders, betaReaderInvites, notifications, projects, users } from '../../db/schema'
import { eq, and, or, desc, isNull, sql } from 'drizzle-orm'
import { requireAuth, requireSelf } from '../../middleware/auth'
import { sendBetaReaderJoinedEmail } from '../../lib/email'
import { randomBytes } from 'crypto'
import { isUuid as isValidUUID } from '../../lib/slugs'

const betaInvitesRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // BETA READER INVITE LINKS
  // ============================================================================

  // Create an invite link (own invites only)
  fastify.post<{
    Params: { userId: string }
    Body: {
      projectId?: string
      accessLevel?: 'beta' | 'arc' | 'early_access'
      maxUses?: number
      notifyOnUse?: boolean
    }
  }>('/users/:userId/beta-invites', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const { projectId, accessLevel = 'beta', maxUses, notifyOnUse = true } = request.body || {}

      if (!requireSelf(request, reply, userId)) return

      if (projectId && !isValidUUID(projectId)) {
        return reply.status(400).send({ error: 'Invalid project ID format' })
      }

      if (maxUses !== undefined && maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
        return reply.status(400).send({ error: 'maxUses must be a positive integer' })
      }

      if (projectId) {
        const [project] = await db
          .select({ id: projects.id })
          .from(projects)
          .where(and(
            eq(projects.id, projectId),
            eq(projects.ownerId, userId),
            isNull(projects.deletedAt)
          ))
          .limit(1)
        if (!project) {
          return reply.status(404).send({ error: 'Project not found' })
        }
      }

      const token = randomBytes(24).toString('base64url')

      const [invite] = await db
        .insert(betaReaderInvites)
        .values({
          authorId: userId,
          projectId: projectId || null,
          token,
          accessLevel,
          maxUses: maxUses ?? null,
          notifyOnUse,
          isActive: true
        })
        .returning()

      return reply.status(201).send({ invite })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to create invite link' })
    }
  })

  // List invite links (own invites only)
  fastify.get<{
    Params: { userId: string }
    Querystring: { projectId?: string }
  }>('/users/:userId/beta-invites', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const { projectId } = request.query

      if (!requireSelf(request, reply, userId)) return

      if (projectId && !isValidUUID(projectId)) {
        return reply.status(400).send({ error: 'Invalid project ID format' })
      }

      const whereConditions = projectId
        ? and(
            eq(betaReaderInvites.authorId, userId),
            eq(betaReaderInvites.isActive, true),
            or(
              eq(betaReaderInvites.projectId, projectId),
              isNull(betaReaderInvites.projectId)
            )
          )
        : and(
            eq(betaReaderInvites.authorId, userId),
            eq(betaReaderInvites.isActive, true)
          )

      const invites = await db
        .select({
          invite: betaReaderInvites,
          projectName: projects.name
        })
        .from(betaReaderInvites)
        .leftJoin(projects, eq(projects.id, betaReaderInvites.projectId))
        .where(whereConditions)
        .orderBy(desc(betaReaderInvites.createdAt))

      return reply.status(200).send({ invites })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch invite links' })
    }
  })

  // Revoke an invite link (own invites only)
  fastify.delete<{
    Params: { userId: string; inviteId: string }
  }>('/users/:userId/beta-invites/:inviteId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId, inviteId } = request.params

      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(inviteId)) {
        return reply.status(400).send({ error: 'Invalid invite ID format' })
      }

      const [revoked] = await db
        .update(betaReaderInvites)
        .set({ isActive: false, updatedAt: new Date() })
        .where(and(
          eq(betaReaderInvites.id, inviteId),
          eq(betaReaderInvites.authorId, userId)
        ))
        .returning()

      if (!revoked) {
        return reply.status(404).send({ error: 'Invite not found' })
      }

      return reply.status(200).send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to revoke invite link' })
    }
  })

  // Preview an invite link (public - powers the landing page before login)
  fastify.get<{
    Params: { token: string }
  }>('/public/beta-invites/:token', async (request, reply) => {
    try {
      const { token } = request.params

      const [row] = await db
        .select({
          invite: betaReaderInvites,
          projectName: projects.name,
          projectCoverImage: projects.coverImage,
          projectShortUrl: projects.shortUrl,
          authorUsername: userProfiles.username,
          authorDisplayName: userProfiles.displayName,
          authorName: users.name
        })
        .from(betaReaderInvites)
        .leftJoin(projects, eq(projects.id, betaReaderInvites.projectId))
        .leftJoin(userProfiles, eq(userProfiles.userId, betaReaderInvites.authorId))
        .leftJoin(users, eq(users.id, betaReaderInvites.authorId))
        .where(eq(betaReaderInvites.token, token))
        .limit(1)

      if (!row) {
        return reply.status(404).send({ error: 'Invite not found', status: 'invalid' })
      }

      const { invite } = row
      let status: 'valid' | 'revoked' | 'full' = 'valid'
      if (!invite.isActive) {
        status = 'revoked'
      } else if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
        status = 'full'
      }

      return reply.status(200).send({
        status,
        accessLevel: invite.accessLevel,
        author: {
          username: row.authorUsername,
          displayName: row.authorDisplayName || row.authorName
        },
        project: invite.projectId
          ? { name: row.projectName, coverImage: row.projectCoverImage, shortUrl: row.projectShortUrl }
          : null
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch invite' })
    }
  })

  // Redeem an invite link (authenticated - enrolls the caller as a beta reader)
  fastify.post<{
    Params: { token: string }
  }>('/beta-invites/:token/redeem', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { token } = request.params
      const readerId = request.user!.id

      const [invite] = await db
        .select()
        .from(betaReaderInvites)
        .where(eq(betaReaderInvites.token, token))
        .limit(1)

      if (!invite || !invite.isActive) {
        return reply.status(404).send({ error: 'This invite link is no longer valid' })
      }

      if (invite.authorId === readerId) {
        return reply.status(400).send({ error: 'You cannot redeem your own invite link' })
      }

      // Already a beta reader with matching scope? Idempotent success, no use consumed.
      const [existing] = await db
        .select({ id: betaReaders.id, isActive: betaReaders.isActive })
        .from(betaReaders)
        .where(and(
          eq(betaReaders.authorId, invite.authorId),
          eq(betaReaders.readerId, readerId),
          invite.projectId
            ? eq(betaReaders.projectId, invite.projectId)
            : isNull(betaReaders.projectId)
        ))
        .limit(1)

      if (existing) {
        if (!existing.isActive) {
          await db
            .update(betaReaders)
            .set({ isActive: true, updatedAt: new Date() })
            .where(eq(betaReaders.id, existing.id))
        }
        return reply.status(200).send({ success: true, alreadyMember: true })
      }

      // Claim a use atomically so concurrent redeems can't exceed maxUses
      const [claimed] = await db
        .update(betaReaderInvites)
        .set({ useCount: sql`${betaReaderInvites.useCount} + 1`, updatedAt: new Date() })
        .where(and(
          eq(betaReaderInvites.id, invite.id),
          eq(betaReaderInvites.isActive, true),
          or(
            isNull(betaReaderInvites.maxUses),
            sql`${betaReaderInvites.useCount} < ${betaReaderInvites.maxUses}`
          )
        ))
        .returning()

      if (!claimed) {
        return reply.status(409).send({ error: 'This invite link has reached its maximum number of uses' })
      }

      await db
        .insert(betaReaders)
        .values({
          authorId: invite.authorId,
          readerId,
          projectId: invite.projectId,
          accessLevel: invite.accessLevel,
          notes: 'Joined via invite link',
          isActive: true
        })

      if (invite.notifyOnUse) {
        // Fire-and-forget: notification failures must not fail the redeem
        ;(async () => {
          const [[author], [reader], project] = await Promise.all([
            db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, invite.authorId)).limit(1),
            db.select({ name: users.name }).from(users).where(eq(users.id, readerId)).limit(1),
            invite.projectId
              ? db.select({ name: projects.name }).from(projects).where(eq(projects.id, invite.projectId)).limit(1).then(rows => rows[0])
              : Promise.resolve(undefined)
          ])

          if (!author) return
          const readerName = reader?.name || 'Someone'
          const projectName = project?.name ?? null

          await db.insert(notifications).values({
            recipientId: invite.authorId,
            actorId: readerId,
            type: 'beta_reader_joined',
            title: projectName
              ? `${readerName} joined as a beta reader for "${projectName}"`
              : `${readerName} joined as a beta reader`,
            metadata: {
              ...(invite.projectId ? { projectId: invite.projectId } : {}),
              ...(projectName ? { projectTitle: projectName } : {}),
              url: '/settings/beta-readers'
            }
          })

          const [prefs] = await db
            .select({ emailBetaReaderJoined: userNotificationPreferences.emailBetaReaderJoined })
            .from(userNotificationPreferences)
            .where(eq(userNotificationPreferences.userId, invite.authorId))
            .limit(1)

          if (prefs?.emailBetaReaderJoined ?? true) {
            await sendBetaReaderJoinedEmail(author.email, readerName, projectName, invite.authorId)
          }
        })().catch(err => {
          fastify.log.warn({ err, inviteId: invite.id }, 'Failed to send beta reader joined notification')
        })
      }

      return reply.status(200).send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to redeem invite link' })
    }
  })
}

export default betaInvitesRoutes
