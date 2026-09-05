/** Reader bobbin opt-outs and automations. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { userBobbinsInstalled } from '../../db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { requireAuth, requireSelf } from '../../middleware/auth'
import { isUuid as isValidUUID } from '../../lib/slugs'

const readerBobbinsRoutes: FastifyPluginAsync = async (fastify) => {
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
      /** Reader-type bobbins are on by default; a row with false records an opt-out. */
      isEnabled?: boolean
    }
  }>('/users/:userId/reader-bobbins', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const { bobbinId, bobbinType, config, isEnabled } = request.body
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
          isEnabled: typeof isEnabled === 'boolean' ? isEnabled : true
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

      // Allow-list updatable fields — prevents the body from clobbering
      // `userId` or `bobbinId` to point this install row at another user or
      // another bobbin.
      const safe: Partial<typeof userBobbinsInstalled.$inferInsert> = { updatedAt: new Date() }
      if (updateData.config !== undefined) safe.config = updateData.config
      if (updateData.isEnabled !== undefined) safe.isEnabled = updateData.isEnabled

      const [updated] = await db
        .update(userBobbinsInstalled)
        .set(safe)
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
}

export default readerBobbinsRoutes
