/** Comments & reactions. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { users, comments, reactions } from '../../db/schema'
import { eq, and, asc, isNull, count } from 'drizzle-orm'
import { optionalAuth } from '../../middleware/auth'
import { canViewProject, checkInteractionAllowed, getChapterProjectId } from './shared'

const socialRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================
  // COMMENTS & REACTIONS
  // ============================================

  /**
   * Get comments for a chapter (public)
   */
  fastify.get<{
    Params: { chapterId: string }
    Querystring: { limit?: number; offset?: number }
  }>('/public/chapters/:chapterId/comments', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { chapterId } = request.params
      // No querystring schema on this route, so these arrive as strings.
      const limit = Number(request.query.limit ?? 50)
      const offset = Number(request.query.offset ?? 0)

      const commentProjectId = await getChapterProjectId(chapterId)
      if (commentProjectId && !(await canViewProject(commentProjectId, request.user?.id))) {
        return reply.status(404).send({ error: 'Chapter not found', correlationId })
      }

      // Fetch all approved comments for this chapter (flat list)
      const allComments = await db
        .select({
          id: comments.id,
          content: comments.content,
          parentId: comments.parentId,
          authorId: comments.authorId,
          authorName: users.name,
          likeCount: comments.likeCount,
          createdAt: comments.createdAt
        })
        .from(comments)
        .innerJoin(users, eq(users.id, comments.authorId))
        .where(and(
          eq(comments.chapterId, chapterId),
          eq(comments.moderationStatus, 'approved')
        ))
        .orderBy(asc(comments.createdAt))

      // Build tree: group replies under their parent
      type CommentNode = typeof allComments[number] & { replies: CommentNode[] }
      const commentMap = new Map<string, CommentNode>()
      const roots: CommentNode[] = []

      for (const c of allComments) {
        const node: CommentNode = { ...c, replies: [] }
        commentMap.set(c.id, node)
      }

      for (const node of commentMap.values()) {
        if (node.parentId && commentMap.has(node.parentId)) {
          commentMap.get(node.parentId)!.replies.push(node)
        } else {
          roots.push(node)
        }
      }

      // Paginate top-level comments only
      const paginatedRoots = roots.slice(offset, offset + limit)

      const [total] = await db
        .select({ count: count() })
        .from(comments)
        .where(and(
          eq(comments.chapterId, chapterId),
          eq(comments.moderationStatus, 'approved'),
          isNull(comments.parentId)
        ))

      return reply.send({
        comments: paginatedRoots,
        total: total?.count ?? 0,
        correlationId
      })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get comments')
      return reply.status(500).send({ error: 'Failed to get comments', correlationId })
    }
  })

  /**
   * Post a comment (requires auth)
   */
  fastify.post<{
    Params: { chapterId: string }
    Body: { content: string; parentId?: string }
  }>('/public/chapters/:chapterId/comments', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { chapterId } = request.params
      const { content, parentId } = request.body

      if (!request.user) {
        return reply.status(401).send({ error: 'Authentication required to comment', correlationId })
      }

      if (!content || content.trim().length === 0) {
        return reply.status(400).send({ error: 'Comment content is required', correlationId })
      }

      if (content.length > 5000) {
        return reply.status(400).send({ error: 'Comment too long (max 5000 characters)', correlationId })
      }

      const gate = await checkInteractionAllowed(chapterId, request.user.id, 'comments')
      if (!gate.ok) {
        return reply.status(gate.status).send({ error: gate.error, correlationId })
      }

      if (parentId) {
        const [parent] = await db
          .select({ id: comments.id })
          .from(comments)
          .where(and(eq(comments.id, parentId), eq(comments.chapterId, chapterId)))
          .limit(1)
        if (!parent) {
          return reply.status(400).send({ error: 'Parent comment not found on this chapter', correlationId })
        }
      }

      const [comment] = await db
        .insert(comments)
        .values({
          chapterId,
          authorId: request.user.id,
          content: content.trim(),
          parentId: parentId || null,
          moderationStatus: 'approved'
        })
        .returning()

      return reply.status(201).send({ comment, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to post comment')
      return reply.status(500).send({ error: 'Failed to post comment', correlationId })
    }
  })

  /**
   * Get reactions for a chapter (public)
   */
  fastify.get<{
    Params: { chapterId: string }
  }>('/public/chapters/:chapterId/reactions', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { chapterId } = request.params

      const reactionProjectId = await getChapterProjectId(chapterId)
      if (reactionProjectId && !(await canViewProject(reactionProjectId, request.user?.id))) {
        return reply.status(404).send({ error: 'Chapter not found', correlationId })
      }

      const reactionCounts = await db
        .select({
          reactionType: reactions.reactionType,
          count: count()
        })
        .from(reactions)
        .where(eq(reactions.chapterId, chapterId))
        .groupBy(reactions.reactionType)

      return reply.send({ reactions: reactionCounts, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get reactions')
      return reply.status(500).send({ error: 'Failed to get reactions', correlationId })
    }
  })

  /**
   * Add/toggle a reaction (requires auth)
   */
  fastify.post<{
    Params: { chapterId: string }
    Body: { reactionType: string }
  }>('/public/chapters/:chapterId/reactions', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { chapterId } = request.params
      const { reactionType } = request.body

      if (!request.user) {
        return reply.status(401).send({ error: 'Authentication required to react', correlationId })
      }

      const validTypes = ['heart', 'laugh', 'wow', 'sad', 'fire', 'clap']
      if (!validTypes.includes(reactionType)) {
        return reply.status(400).send({ error: 'Invalid reaction type', correlationId })
      }

      const gate = await checkInteractionAllowed(chapterId, request.user.id, 'reactions')
      if (!gate.ok) {
        return reply.status(gate.status).send({ error: gate.error, correlationId })
      }

      // Toggle: check if already exists
      const [existing] = await db
        .select()
        .from(reactions)
        .where(and(
          eq(reactions.chapterId, chapterId),
          eq(reactions.userId, request.user.id),
          eq(reactions.reactionType, reactionType)
        ))
        .limit(1)

      if (existing) {
        await db.delete(reactions).where(eq(reactions.id, existing.id))
        return reply.send({ action: 'removed', correlationId })
      } else {
        await db.insert(reactions).values({
          chapterId,
          userId: request.user.id,
          reactionType
        })
        return reply.status(201).send({ action: 'added', correlationId })
      }
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to toggle reaction')
      return reply.status(500).send({ error: 'Failed to toggle reaction', correlationId })
    }
  })

  /**
   * Delete a reaction (requires auth)
   */
  fastify.delete<{
    Params: { chapterId: string; reactionType: string }
  }>('/public/chapters/:chapterId/reactions/:reactionType', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { chapterId, reactionType } = request.params

      if (!request.user) {
        return reply.status(401).send({ error: 'Authentication required', correlationId })
      }

      await db
        .delete(reactions)
        .where(and(
          eq(reactions.chapterId, chapterId),
          eq(reactions.userId, request.user.id),
          eq(reactions.reactionType, reactionType)
        ))

      return reply.send({ success: true, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to delete reaction')
      return reply.status(500).send({ error: 'Failed to delete reaction', correlationId })
    }
  })
}

export default socialRoutes
