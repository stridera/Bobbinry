/** Annotations — reader feedback. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { entities, projects, chapterAnnotations } from '../../db/schema'
import { eq, and, asc } from 'drizzle-orm'
import { optionalAuth } from '../../middleware/auth'
import { liveProjectEntity } from '../../lib/entity-scope'
import { canUserAnnotate } from './shared'

// API keys with manuscript:read reach these routes: the sync bots file their
// proofing notes here. Annotations never change prose; accepting a suggestion
// into the chapter is manuscript:write (annotations-author.ts).
const annotatorKeys = { apiKey: { scope: 'manuscript:read' } }

const annotationsRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================
  // ANNOTATIONS (READER FEEDBACK)
  // ============================================

  /**
   * Check if current user can annotate a project
   */
  fastify.get<{
    Params: { projectId: string }
  }>('/public/projects/:projectId/can-annotate', {
    preHandler: optionalAuth,
    config: annotatorKeys
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { projectId } = request.params
      if (!request.user) {
        return reply.send({ canAnnotate: false, correlationId })
      }

      // Project owner can always annotate (for testing)
      const [project] = await db
        .select({ ownerId: projects.ownerId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)

      if (project?.ownerId === request.user.id) {
        return reply.send({ canAnnotate: true, correlationId })
      }

      const allowed = await canUserAnnotate(request.user.id, projectId)
      return reply.send({ canAnnotate: allowed, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to check annotation access')
      return reply.status(500).send({ error: 'Failed to check annotation access', correlationId })
    }
  })

  /**
   * Get annotations for a chapter (reader's own annotations)
   */
  fastify.get<{
    Params: { chapterId: string }
  }>('/public/chapters/:chapterId/annotations', {
    preHandler: optionalAuth,
    config: annotatorKeys
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { chapterId } = request.params

      if (!request.user) {
        return reply.send({ annotations: [], correlationId })
      }

      const annotations = await db
        .select({
          id: chapterAnnotations.id,
          chapterId: chapterAnnotations.chapterId,
          authorId: chapterAnnotations.authorId,
          anchorParagraphIndex: chapterAnnotations.anchorParagraphIndex,
          anchorQuote: chapterAnnotations.anchorQuote,
          anchorCharOffset: chapterAnnotations.anchorCharOffset,
          anchorCharLength: chapterAnnotations.anchorCharLength,
          annotationType: chapterAnnotations.annotationType,
          errorCategory: chapterAnnotations.errorCategory,
          content: chapterAnnotations.content,
          suggestedText: chapterAnnotations.suggestedText,
          status: chapterAnnotations.status,
          authorResponse: chapterAnnotations.authorResponse,
          chapterVersion: chapterAnnotations.chapterVersion,
          createdAt: chapterAnnotations.createdAt,
          updatedAt: chapterAnnotations.updatedAt
        })
        .from(chapterAnnotations)
        .where(and(
          eq(chapterAnnotations.chapterId, chapterId),
          eq(chapterAnnotations.authorId, request.user.id)
        ))
        .orderBy(asc(chapterAnnotations.anchorParagraphIndex), asc(chapterAnnotations.createdAt))

      return reply.send({ annotations, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get annotations')
      return reply.status(500).send({ error: 'Failed to get annotations', correlationId })
    }
  })

  /**
   * Create an annotation (requires auth + annotation access)
   */
  fastify.post<{
    Params: { chapterId: string }
    Body: {
      projectId: string
      anchorParagraphIndex?: number
      anchorQuote: string
      anchorCharOffset?: number
      anchorCharLength?: number
      annotationType: string
      errorCategory?: string
      content: string
      suggestedText?: string
      chapterVersion: number
    }
  }>('/public/chapters/:chapterId/annotations', {
    preHandler: optionalAuth,
    config: annotatorKeys
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { chapterId } = request.params
      const body = request.body

      if (!request.user) {
        return reply.status(401).send({ error: 'Authentication required to annotate', correlationId })
      }

      if (!body.anchorQuote || body.anchorQuote.trim().length === 0) {
        return reply.status(400).send({ error: 'Selected text (anchorQuote) is required', correlationId })
      }

      if (!body.content || body.content.trim().length === 0) {
        return reply.status(400).send({ error: 'Annotation content is required', correlationId })
      }

      const validTypes = ['error', 'suggestion', 'feedback']
      if (!validTypes.includes(body.annotationType)) {
        return reply.status(400).send({ error: 'Invalid annotation type', correlationId })
      }

      if (body.annotationType === 'error' && body.errorCategory) {
        const validCategories = ['typo', 'formatting', 'continuity', 'grammar', 'other']
        if (!validCategories.includes(body.errorCategory)) {
          return reply.status(400).send({ error: 'Invalid error category', correlationId })
        }
      }

      // Check project owner (always allowed) or annotation access
      const [project] = await db
        .select({ ownerId: projects.ownerId })
        .from(projects)
        .where(eq(projects.id, body.projectId))
        .limit(1)

      const isOwner = project?.ownerId === request.user.id
      if (!isOwner) {
        const allowed = await canUserAnnotate(request.user.id, body.projectId)
        if (!allowed) {
          return reply.status(403).send({ error: 'You do not have permission to annotate this project', correlationId })
        }
      }

      // The chapter must be a live content entity of the project the caller was
      // authorised against. Without this, a reader of project A could attach
      // annotations — and accepted suggestions — to chapters in project B.
      const [chapter] = await db
        .select({ id: entities.id })
        .from(entities)
        .where(and(liveProjectEntity(body.projectId, chapterId), eq(entities.collectionName, 'content')))
        .limit(1)
      if (!chapter) {
        return reply.status(404).send({ error: 'Chapter not found', correlationId })
      }

      const [annotation] = await db
        .insert(chapterAnnotations)
        .values({
          chapterId,
          projectId: body.projectId,
          authorId: request.user.id,
          anchorParagraphIndex: body.anchorParagraphIndex ?? null,
          anchorQuote: body.anchorQuote.trim(),
          anchorCharOffset: body.anchorCharOffset ?? null,
          anchorCharLength: body.anchorCharLength ?? null,
          annotationType: body.annotationType,
          errorCategory: body.errorCategory ?? null,
          content: body.content.trim(),
          suggestedText: body.suggestedText?.trim() || null,
          chapterVersion: body.chapterVersion
        })
        .returning()

      return reply.status(201).send({ annotation, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to create annotation')
      return reply.status(500).send({ error: 'Failed to create annotation', correlationId })
    }
  })

  /**
   * Update own annotation
   */
  fastify.put<{
    Params: { chapterId: string; annotationId: string }
    Body: {
      content?: string
      annotationType?: string
      errorCategory?: string | null
      suggestedText?: string | null
    }
  }>('/public/chapters/:chapterId/annotations/:annotationId', {
    preHandler: optionalAuth,
    config: annotatorKeys
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { annotationId } = request.params
      const body = request.body

      if (!request.user) {
        return reply.status(401).send({ error: 'Authentication required', correlationId })
      }

      // Verify ownership
      const [existing] = await db
        .select({ authorId: chapterAnnotations.authorId })
        .from(chapterAnnotations)
        .where(eq(chapterAnnotations.id, annotationId))
        .limit(1)

      if (!existing) {
        return reply.status(404).send({ error: 'Annotation not found', correlationId })
      }
      if (existing.authorId !== request.user.id) {
        return reply.status(403).send({ error: 'You can only edit your own annotations', correlationId })
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() }

      if (body.content !== undefined) {
        if (!body.content || body.content.trim().length === 0) {
          return reply.status(400).send({ error: 'Content cannot be empty', correlationId })
        }
        updates.content = body.content.trim()
      }
      if (body.annotationType !== undefined) {
        const validTypes = ['error', 'suggestion', 'feedback']
        if (!validTypes.includes(body.annotationType)) {
          return reply.status(400).send({ error: 'Invalid annotation type', correlationId })
        }
        updates.annotationType = body.annotationType
      }
      if (body.errorCategory !== undefined) updates.errorCategory = body.errorCategory
      if (body.suggestedText !== undefined) updates.suggestedText = body.suggestedText?.trim() || null

      const [updated] = await db
        .update(chapterAnnotations)
        .set(updates)
        .where(eq(chapterAnnotations.id, annotationId))
        .returning()

      return reply.send({ annotation: updated, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to update annotation')
      return reply.status(500).send({ error: 'Failed to update annotation', correlationId })
    }
  })

  /**
   * Delete own annotation
   */
  fastify.delete<{
    Params: { chapterId: string; annotationId: string }
  }>('/public/chapters/:chapterId/annotations/:annotationId', {
    preHandler: optionalAuth,
    config: annotatorKeys
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { annotationId } = request.params

      if (!request.user) {
        return reply.status(401).send({ error: 'Authentication required', correlationId })
      }

      const [existing] = await db
        .select({ authorId: chapterAnnotations.authorId })
        .from(chapterAnnotations)
        .where(eq(chapterAnnotations.id, annotationId))
        .limit(1)

      if (!existing) {
        return reply.status(404).send({ error: 'Annotation not found', correlationId })
      }
      if (existing.authorId !== request.user.id) {
        return reply.status(403).send({ error: 'You can only delete your own annotations', correlationId })
      }

      await db.delete(chapterAnnotations).where(eq(chapterAnnotations.id, annotationId))

      return reply.send({ success: true, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to delete annotation')
      return reply.status(500).send({ error: 'Failed to delete annotation', correlationId })
    }
  })
}

export default annotationsRoutes
