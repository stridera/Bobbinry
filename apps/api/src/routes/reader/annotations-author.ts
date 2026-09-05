/** Annotations — author dashboard. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { entities, projects, userProfiles, users, chapterAnnotations } from '../../db/schema'
import { eq, and, desc, sql, or, count, inArray } from 'drizzle-orm'
import { requireAuth, requireProjectOwnership, ownsProject } from '../../middleware/auth'
import { countWordsFromHtml } from '../../lib/text'
import { liveProjectEntity, notDeleted } from '../../lib/entity-scope'
import { changeEventFromRow, extractWordCount, recordEntityChangesSafe } from '../../lib/entity-changes'

const annotationsAuthorRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================
  // ANNOTATIONS — AUTHOR DASHBOARD
  // ============================================

  /**
   * Get all annotations for a project (author only)
   */
  fastify.get<{
    Params: { projectId: string }
    Querystring: { status?: string; annotationType?: string; chapterId?: string; limit?: number; offset?: number }
  }>('/projects/:projectId/annotations', {
    preHandler: [requireAuth, ownsProject()]
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { projectId } = request.params
      const { status: statusFilter, annotationType, chapterId, limit = 50, offset = 0 } = request.query

      const conditions = [eq(chapterAnnotations.projectId, projectId)]
      if (statusFilter) conditions.push(eq(chapterAnnotations.status, statusFilter))
      if (annotationType) conditions.push(eq(chapterAnnotations.annotationType, annotationType))
      if (chapterId) conditions.push(eq(chapterAnnotations.chapterId, chapterId))

      const annotations = await db
        .select({
          id: chapterAnnotations.id,
          chapterId: chapterAnnotations.chapterId,
          chapterTitle: sql<string>`(${entities.entityData}->>'title')`,
          authorId: chapterAnnotations.authorId,
          authorName: users.name,
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
          resolvedAt: chapterAnnotations.resolvedAt,
          chapterVersion: chapterAnnotations.chapterVersion,
          createdAt: chapterAnnotations.createdAt,
          updatedAt: chapterAnnotations.updatedAt
        })
        .from(chapterAnnotations)
        .innerJoin(users, eq(users.id, chapterAnnotations.authorId))
        .leftJoin(entities, and(
          eq(entities.id, chapterAnnotations.chapterId),
          eq(entities.projectId, projectId),
          notDeleted()
        ))
        .where(and(...conditions))
        .orderBy(desc(chapterAnnotations.createdAt))
        .limit(limit)
        .offset(offset)

      // Extract surrounding paragraph context for each annotation
      const chapterIds = [...new Set(annotations.map(a => a.chapterId))]
      const chapterBodies = new Map<string, string>()
      if (chapterIds.length > 0) {
        const bodyRows = await db
          .select({
            id: entities.id,
            body: sql<string>`(${entities.entityData}->>'body')`
          })
          .from(entities)
          .where(and(inArray(entities.id, chapterIds), eq(entities.projectId, projectId), notDeleted()))

        for (const row of bodyRows) {
          if (row.body) chapterBodies.set(row.id, row.body)
        }
      }

      // Simple HTML paragraph extractor — splits on block tags
      function extractParagraphText(html: string, index: number): string | null {
        const blockRegex = /<(?:p|h[1-6]|blockquote|li|pre)[^>]*>([\s\S]*?)<\/(?:p|h[1-6]|blockquote|li|pre)>/gi
        let match: RegExpExecArray | null
        let i = 0
        while ((match = blockRegex.exec(html)) !== null) {
          if (i === index) {
            // Strip inner HTML tags to get plain text
            return match[1]!.replace(/<[^>]+>/g, '').trim()
          }
          i++
        }
        return null
      }

      const annotationsWithContext = annotations.map(ann => {
        let anchorContext: string | null = null
        if (ann.anchorParagraphIndex != null) {
          const body = chapterBodies.get(ann.chapterId)
          if (body) {
            anchorContext = extractParagraphText(body, ann.anchorParagraphIndex)
          }
        }
        return { ...ann, anchorContext }
      })

      const [total] = await db
        .select({ count: count() })
        .from(chapterAnnotations)
        .where(and(...conditions))

      // Get distinct chapters that have annotations (for filter dropdown)
      const chapters = await db
        .select({
          chapterId: chapterAnnotations.chapterId,
          chapterTitle: sql<string>`(${entities.entityData}->>'title')`,
          count: count()
        })
        .from(chapterAnnotations)
        .leftJoin(entities, and(eq(entities.id, chapterAnnotations.chapterId), notDeleted()))
        .where(eq(chapterAnnotations.projectId, projectId))
        .groupBy(chapterAnnotations.chapterId, sql`(${entities.entityData}->>'title')`)

      // Get reader URL info for linking
      const [projectInfo] = await db
        .select({
          shortUrl: projects.shortUrl,
          ownerId: projects.ownerId
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)

      let readerBaseUrl: string | null = null
      if (projectInfo?.shortUrl) {
        const [profile] = await db
          .select({ username: userProfiles.username })
          .from(userProfiles)
          .where(eq(userProfiles.userId, projectInfo.ownerId))
          .limit(1)
        if (profile?.username) {
          readerBaseUrl = `/read/${profile.username}/${projectInfo.shortUrl}`
        }
      }

      return reply.send({ annotations: annotationsWithContext, chapters, readerBaseUrl, total: total?.count ?? 0, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get project annotations')
      return reply.status(500).send({ error: 'Failed to get project annotations', correlationId })
    }
  })

  /**
   * Get annotation stats for a project (author only)
   */
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/annotations/stats', {
    preHandler: requireAuth
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { projectId } = request.params

      const isOwner = await requireProjectOwnership(request, reply, projectId)
      if (!isOwner) return

      const byStatus = await db
        .select({
          status: chapterAnnotations.status,
          count: count()
        })
        .from(chapterAnnotations)
        .where(eq(chapterAnnotations.projectId, projectId))
        .groupBy(chapterAnnotations.status)

      const byType = await db
        .select({
          annotationType: chapterAnnotations.annotationType,
          count: count()
        })
        .from(chapterAnnotations)
        .where(eq(chapterAnnotations.projectId, projectId))
        .groupBy(chapterAnnotations.annotationType)

      const byChapter = await db
        .select({
          chapterId: chapterAnnotations.chapterId,
          count: count()
        })
        .from(chapterAnnotations)
        .where(and(
          eq(chapterAnnotations.projectId, projectId),
          or(eq(chapterAnnotations.status, 'open'), eq(chapterAnnotations.status, 'acknowledged'))
        ))
        .groupBy(chapterAnnotations.chapterId)

      return reply.send({ byStatus, byType, byChapter, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get annotation stats')
      return reply.status(500).send({ error: 'Failed to get annotation stats', correlationId })
    }
  })

  /**
   * Update annotation status (author only — acknowledge/resolve/dismiss)
   *
   * Answers to both PUT and PATCH. This is a partial update of a single field, so
   * API clients reach for PATCH naturally — and a wrong method here surfaces as
   * `Route PATCH:... not found`, which reads as "the annotation doesn't exist"
   * rather than "wrong verb". Accepting both removes the trap instead of
   * documenting around it.
   */
  fastify.route<{
    Params: { projectId: string; annotationId: string }
    Body: { status: string; authorResponse?: string }
  }>({
    method: ['PUT', 'PATCH'],
    url: '/projects/:projectId/annotations/:annotationId/status',
    preHandler: requireAuth,
    handler: async (request, reply) => {
      const correlationId = request.id
      try {
        const { projectId, annotationId } = request.params
        const { status: newStatus, authorResponse } = request.body

        const isOwner = await requireProjectOwnership(request, reply, projectId)
        if (!isOwner) return

        const validStatuses = ['open', 'acknowledged', 'resolved', 'dismissed']
        if (!validStatuses.includes(newStatus)) {
          return reply.status(400).send({ error: 'Invalid status', correlationId })
        }

        // Verify the annotation belongs to this project
        const [existing] = await db
          .select({ id: chapterAnnotations.id })
          .from(chapterAnnotations)
          .where(and(
            eq(chapterAnnotations.id, annotationId),
            eq(chapterAnnotations.projectId, projectId)
          ))
          .limit(1)

        if (!existing) {
          return reply.status(404).send({ error: 'Annotation not found', correlationId })
        }

        const updates: Record<string, unknown> = {
          status: newStatus,
          updatedAt: new Date()
        }

        if (authorResponse !== undefined) {
          updates.authorResponse = authorResponse.trim() || null
        }

        if (newStatus === 'resolved' || newStatus === 'dismissed') {
          updates.resolvedAt = new Date()
          updates.resolvedBy = request.user!.id
        } else {
          updates.resolvedAt = null
          updates.resolvedBy = null
        }

        const [updated] = await db
          .update(chapterAnnotations)
          .set(updates)
          .where(eq(chapterAnnotations.id, annotationId))
          .returning()

        return reply.send({ annotation: updated, correlationId })
      } catch (error) {
        fastify.log.error({ error, correlationId }, 'Failed to update annotation status')
        return reply.status(500).send({ error: 'Failed to update annotation status', correlationId })
      }
    }
  })

  /**
   * Accept a suggestion — apply the text replacement and resolve the annotation
   */
  fastify.post<{
    Params: { projectId: string; annotationId: string }
  }>('/projects/:projectId/annotations/:annotationId/accept', {
    preHandler: [requireAuth, ownsProject()]
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { projectId, annotationId } = request.params

      // Verify the annotation exists and has suggested text
      const [annotation] = await db
        .select()
        .from(chapterAnnotations)
        .where(and(
          eq(chapterAnnotations.id, annotationId),
          eq(chapterAnnotations.projectId, projectId)
        ))
        .limit(1)

      if (!annotation) {
        return reply.status(404).send({ error: 'Annotation not found', correlationId })
      }

      if (!annotation.suggestedText) {
        return reply.status(400).send({ error: 'Annotation has no suggested text to accept', correlationId })
      }

      // Apply the text replacement in the DB unless the caller handles it
      // (the editor panel dispatches bobbinry:editor-replace-text instead)
      const body = request.body as { editorWillApply?: boolean } | undefined
      if (!body?.editorWillApply) {
        const [chapter] = await db
          .select({
            id: entities.id,
            entityData: entities.entityData,
            version: entities.version,
            collectionName: entities.collectionName,
            contentType: entities.contentType,
          })
          .from(entities)
          .where(liveProjectEntity(projectId, annotation.chapterId))
          .limit(1)

        if (chapter) {
          const data = chapter.entityData as Record<string, any>
          const chapterBody = data?.body as string | undefined
          if (chapterBody?.includes(annotation.anchorQuote)) {
            const updatedBody = chapterBody.replace(annotation.anchorQuote, annotation.suggestedText)
            const newWordCount = countWordsFromHtml(updatedBody)
            await db
              .update(entities)
              .set({
                entityData: { ...data, body: updatedBody, word_count: newWordCount },
                version: (chapter.version ?? 0) + 1,
                lastEditedAt: new Date()
              })
              .where(eq(entities.id, chapter.id))

            await recordEntityChangesSafe(db, [
              changeEventFromRow('updated', { projectId, actor: request.user!.id }, chapter, {
                fieldsChanged: ['body'],
                wordCountBefore: extractWordCount(data),
                wordCountAfter: newWordCount,
              }),
            ])
          }
        }
      }

      // Resolve the annotation
      const [resolved] = await db
        .update(chapterAnnotations)
        .set({
          status: 'resolved',
          authorResponse: 'Suggestion accepted',
          resolvedAt: new Date(),
          resolvedBy: request.user!.id,
          updatedAt: new Date()
        })
        .where(eq(chapterAnnotations.id, annotationId))
        .returning()

      return reply.send({ annotation: resolved, applied: true, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to accept annotation')
      return reply.status(500).send({ error: 'Failed to accept annotation', correlationId })
    }
  })
}

export default annotationsAuthorRoutes
