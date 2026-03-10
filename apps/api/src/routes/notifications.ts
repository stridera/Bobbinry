import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import { notifications, users } from '../db/schema'
import { eq, and, desc, count } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth'

function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

const notificationsPlugin: FastifyPluginAsync = async (fastify) => {
  // Get paginated notifications for current user
  fastify.get<{
    Querystring: { limit?: string; offset?: string }
  }>('/notifications', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const userId = request.user!.id
      const limit = Math.min(parseInt(request.query.limit || '20', 10), 50)
      const offset = parseInt(request.query.offset || '0', 10)

      const rows = await db
        .select({
          id: notifications.id,
          type: notifications.type,
          title: notifications.title,
          body: notifications.body,
          metadata: notifications.metadata,
          isRead: notifications.isRead,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
          actorId: notifications.actorId,
          actorName: users.name,
        })
        .from(notifications)
        .leftJoin(users, eq(notifications.actorId, users.id))
        .where(eq(notifications.recipientId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset(offset)

      return reply.send({ notifications: rows })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch notifications' })
    }
  })

  // Get unread count (lightweight for polling)
  fastify.get('/notifications/unread-count', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const userId = request.user!.id

      const [result] = await db
        .select({ count: count() })
        .from(notifications)
        .where(and(
          eq(notifications.recipientId, userId),
          eq(notifications.isRead, false)
        ))

      return reply.send({ count: result?.count ?? 0 })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch unread count' })
    }
  })

  // Mark single notification as read
  fastify.put<{
    Params: { id: string }
  }>('/notifications/:id/read', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { id } = request.params
      const userId = request.user!.id

      if (!isValidUUID(id)) {
        return reply.status(400).send({ error: 'Invalid notification ID format' })
      }

      const [updated] = await db
        .update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(
          eq(notifications.id, id),
          eq(notifications.recipientId, userId)
        ))
        .returning({ id: notifications.id })

      if (!updated) {
        return reply.status(404).send({ error: 'Notification not found' })
      }

      return reply.send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to mark notification read' })
    }
  })

  // Mark all notifications as read
  fastify.put('/notifications/read-all', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const userId = request.user!.id

      await db
        .update(notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(
          eq(notifications.recipientId, userId),
          eq(notifications.isRead, false)
        ))

      return reply.send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to mark all notifications read' })
    }
  })
}

export default notificationsPlugin
