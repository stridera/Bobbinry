/** Public reader endpoints: chapter list, chapter body, view tracking. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { chapterPublications, chapterViews, entities, projects, projectPublishConfig, projectManuscriptDisplaySettings, userManuscriptDisplaySettings } from '../../db/schema'
import { resolveDisplaySettings, sanitizeDisplaySettings, type PartialManuscriptDisplaySettings } from '@bobbinry/types'
import { eq, and, sql, isNull } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { optionalAuth } from '../../middleware/auth'
import { notDeleted } from '../../lib/entity-scope'
import { checkChapterAccess, checkChaptersAccess } from '../../lib/chapter-access'
import { resolveSlug, getSlugsForEntities } from '../../lib/slugs'
import { getChapterOrderClauses, resolveViewAs, canViewProject } from './shared'

const chaptersRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================
  // PUBLIC READER ENDPOINTS
  // ============================================

  /**
   * Get table of contents for a project
   * Lists all publicly accessible chapters
   */
  fastify.get<{
    Params: { projectId: string }
    Querystring: { viewAs?: string }
  }>('/public/projects/:projectId/toc', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { projectId } = request.params
      // Identity is sourced from the authenticated session — never the query
      // string. Without this, anyone who knew the project owner's UUID could
      // append ?userId=<owner_uuid> and unlock embargoed / subscriber-only
      // chapters because checkPublicChapterAccess grants access when
      // project.ownerId === userId.
      const viewer = await resolveViewAs(projectId, request.user?.id, request.query.viewAs)
      const userId = viewer.userId

      if (!(await canViewProject(projectId, userId, viewer.simulate))) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }

      // Get project visibility setting
      const [publishConfig] = await db
        .select({ defaultVisibility: projectPublishConfig.defaultVisibility })
        .from(projectPublishConfig)
        .where(eq(projectPublishConfig.projectId, projectId))
        .limit(1)
      const defaultVisibility = publishConfig?.defaultVisibility || 'public'

      // Get all published chapters for this project, in reader order.
      const orderClauses = await getChapterOrderClauses(projectId)
      const publishedChapters = await db
        .select({
          chapterId: chapterPublications.chapterId,
          title: sql<string>`(${entities.entityData}->>'title')`,
          publishedAt: chapterPublications.publishedAt,
          publicReleaseDate: chapterPublications.publicReleaseDate,
          viewCount: chapterPublications.viewCount,
          wordCount: sql<number>`COALESCE((${entities.entityData}->>'word_count')::int, 0)`,
          order: sql<number>`COALESCE((${entities.entityData}->>'order')::bigint, 0)`
        })
        .from(chapterPublications)
        .innerJoin(entities, eq(entities.id, chapterPublications.chapterId))
        .where(and(
          eq(chapterPublications.projectId, projectId),
          eq(chapterPublications.isPublished, true),
          notDeleted()
        ))
        .orderBy(...orderClauses)

      // Total words across all published chapters — counted regardless of
      // whether the caller can read each chapter, so the project's overall
      // scope is honestly represented (helps with subscribe-conversion intent:
      // "this serial is X words, you've got access to Y").
      const totalWords = publishedChapters.reduce((sum, ch) => sum + (ch.wordCount || 0), 0)

      // Batch access check: 3-4 queries total instead of 3-5 per chapter
      const accessMap = await checkChaptersAccess(
        publishedChapters.map(ch => ({
          chapterId: ch.chapterId,
          publishedAt: ch.publishedAt,
          publicReleaseDate: ch.publicReleaseDate
        })),
        projectId,
        userId,
        defaultVisibility,
        viewer.simulate
      )

      const slugMap = await getSlugsForEntities(projectId, publishedChapters.map(ch => ch.chapterId))

      const accessibleChapters = publishedChapters.map(chapter => {
        const access = accessMap.get(chapter.chapterId) ?? { canAccess: true }
        if (access.canAccess) {
          return {
            id: chapter.chapterId,
            slug: slugMap.get(chapter.chapterId) ?? null,
            title: chapter.title,
            publishedAt: chapter.publishedAt,
            viewCount: chapter.viewCount,
            order: chapter.order
          }
        } else {
          return {
            id: chapter.chapterId,
            slug: slugMap.get(chapter.chapterId) ?? null,
            title: chapter.title,
            embargoUntil: access.embargoUntil,
            order: chapter.order,
            locked: true,
            lockReason: access.reason === 'Subscription required' ? 'subscription_required' : 'embargo'
          }
        }
      })

      return reply.send({
        toc: accessibleChapters,
        totalChapters: accessibleChapters.length,
        totalWords,
        subscriberOnly: defaultVisibility === 'subscribers_only',
        correlationId
      })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get TOC')
      return reply.status(500).send({ error: 'Failed to get table of contents', correlationId })
    }
  })

  /**
   * Get a published chapter for reading
   * Respects access control and embargo schedules
   */
  fastify.get<{
    Params: { projectId: string; chapterId: string }
    Querystring: { viewAs?: string }
  }>('/public/projects/:projectId/chapters/:chapterId', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { projectId, chapterId: chapterParam } = request.params
      // Identity sourced from authenticated session only — see /toc handler above
      // for why query-string userId would have been an embargo-bypass.
      const viewer = await resolveViewAs(projectId, request.user?.id, request.query.viewAs)
      const userId = viewer.userId

      if (!(await canViewProject(projectId, userId, viewer.simulate))) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }

      // The URL param may be the chapter's slug, an old slug alias, or a UUID.
      const resolved = await resolveSlug(projectId, chapterParam)
      if (!resolved) {
        return reply.status(404).send({ error: 'Chapter not found', correlationId })
      }
      const chapterId = resolved.entityId

      // Get project visibility setting
      const [chapterPublishConfig] = await db
        .select({ defaultVisibility: projectPublishConfig.defaultVisibility })
        .from(projectPublishConfig)
        .where(eq(projectPublishConfig.projectId, projectId))
        .limit(1)

      // Check access
      const access = await checkChapterAccess(chapterId, projectId, userId, chapterPublishConfig?.defaultVisibility || 'public', viewer.simulate)
      if (!access.canAccess) {
        return reply.status(403).send({
          error: access.reason || 'Access denied',
          embargoUntil: access.embargoUntil,
          correlationId
        })
      }

      // Get chapter content
      const [chapter] = await db
        .select({
          id: entities.id,
          title: sql<string>`(${entities.entityData}->>'title')`,
          content: sql<string>`(${entities.entityData}->>'body')`,
          publishedAt: chapterPublications.publishedAt,
          viewCount: chapterPublications.viewCount,
          order: sql<number>`COALESCE((${entities.entityData}->>'order')::bigint, 0)`,
          contentDisplaySettings: sql<unknown>`(${entities.entityData}->'displaySettings')`,
          projectOwnerId: projects.ownerId
        })
        .from(entities)
        .innerJoin(chapterPublications, and(
          eq(chapterPublications.chapterId, entities.id),
          eq(chapterPublications.isPublished, true)
        ))
        .innerJoin(projects, eq(projects.id, entities.projectId))
        .where(and(
          eq(entities.id, chapterId),
          eq(entities.projectId, projectId),
          notDeleted()
        ))
        .limit(1)

      if (!chapter) {
        return reply.status(404).send({ error: 'Chapter not found', correlationId })
      }

      // Resolve the manuscript display cascade: author user → project → content.
      let userDisplay: PartialManuscriptDisplaySettings | null = null
      let projectDisplay: PartialManuscriptDisplaySettings | null = null
      try {
        if (chapter.projectOwnerId) {
          const userRows = await db
            .select()
            .from(userManuscriptDisplaySettings)
            .where(eq(userManuscriptDisplaySettings.userId, chapter.projectOwnerId))
            .limit(1)
          if (userRows[0]) userDisplay = sanitizeDisplaySettings(userRows[0])
        }
        const projectRows = await db
          .select()
          .from(projectManuscriptDisplaySettings)
          .where(eq(projectManuscriptDisplaySettings.projectId, projectId))
          .limit(1)
        if (projectRows[0]) projectDisplay = sanitizeDisplaySettings(projectRows[0])
      } catch (err) {
        fastify.log.warn({ err, correlationId }, 'Failed to load manuscript display cascade — using defaults')
      }
      const contentDisplay = sanitizeDisplaySettings(chapter.contentDisplaySettings)
      const resolvedDisplay = resolveDisplaySettings(userDisplay, projectDisplay, contentDisplay)

      // Get navigation (previous/next chapters) — must match TOC reader order.
      const navOrderClauses = await getChapterOrderClauses(projectId)
      const allChapters = await db
        .select({
          id: entities.id,
          order: sql<number>`COALESCE((${entities.entityData}->>'order')::bigint, 0)`
        })
        .from(entities)
        .innerJoin(chapterPublications, eq(chapterPublications.chapterId, entities.id))
        .where(and(
          eq(entities.projectId, projectId),
          eq(chapterPublications.isPublished, true),
          notDeleted()
        ))
        .orderBy(...navOrderClauses)

      const currentIndex = allChapters.findIndex(c => c.id === chapterId)
      const previousChapter = currentIndex > 0 ? allChapters[currentIndex - 1] : null
      const nextChapter = currentIndex < allChapters.length - 1 ? allChapters[currentIndex + 1] : null

      const navSlugs = await getSlugsForEntities(
        projectId,
        [previousChapter?.id, nextChapter?.id].filter((id): id is string => Boolean(id))
      )

      return reply.send({
        chapter: {
          id: chapter.id,
          slug: resolved.currentSlug,
          title: chapter.title,
          content: chapter.content,
          publishedAt: chapter.publishedAt,
          viewCount: chapter.viewCount
        },
        navigation: {
          previous: previousChapter ? { id: previousChapter.id, slug: navSlugs.get(previousChapter.id) ?? null } : null,
          next: nextChapter ? { id: nextChapter.id, slug: navSlugs.get(nextChapter.id) ?? null } : null
        },
        resolvedDisplay,
        correlationId
      })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get chapter')
      return reply.status(500).send({ error: 'Failed to get chapter', correlationId })
    }
  })

  /**
   * Track a chapter view
   * Anonymous tracking via session ID
   */
  fastify.post<{
    Params: { projectId: string; chapterId: string }
    Body: {
      sessionId?: string
      deviceType?: string
      referrer?: string
      readTime?: number
      position?: number
    }
  }>('/public/projects/:projectId/chapters/:chapterId/view', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { chapterId } = request.params
      const { sessionId, deviceType, referrer, readTime, position } = request.body
      // readerId is sourced from the authenticated session only — never the
      // request body — so anonymous attackers can't fabricate reads attributed
      // to other accounts.
      const userId = request.user?.id

      const [pub] = await db
        .select({ isPublished: chapterPublications.isPublished })
        .from(chapterPublications)
        .where(and(
          eq(chapterPublications.chapterId, chapterId),
          eq(chapterPublications.projectId, request.params.projectId)
        ))
        .limit(1)
      if (!pub?.isPublished || !(await canViewProject(request.params.projectId, userId))) {
        return reply.status(404).send({ error: 'Chapter not found', correlationId })
      }

      let viewId: string
      let isNewView = false

      // Upsert one row per reader+chapter (signed in) or session+chapter
      // (anonymous). Anonymous calls without a session id always insert.
      const existingWhere = userId
        ? and(eq(chapterViews.readerId, userId), eq(chapterViews.chapterId, chapterId))
        : sessionId
          ? and(isNull(chapterViews.readerId), eq(chapterViews.sessionId, sessionId), eq(chapterViews.chapterId, chapterId))
          : null
      const [existing] = existingWhere
        ? await db.select({ id: chapterViews.id }).from(chapterViews).where(existingWhere).limit(1)
        : []

      if (existing) {
        const updates: Record<string, any> = {}
        if (position !== undefined) updates.lastPositionPercent = Number(position)
        if (readTime !== undefined) updates.readTimeSeconds = sql`${chapterViews.readTimeSeconds} + ${Number(readTime)}`
        if (deviceType) updates.deviceType = deviceType
        // Mark as completed if position is >= 95%
        if (position !== undefined && Number(position) >= 95) {
          updates.completedAt = new Date()
        }
        if (Object.keys(updates).length > 0) {
          await db.update(chapterViews).set(updates).where(eq(chapterViews.id, existing.id))
        }
        viewId = existing.id
      } else {
        const [view] = await db
          .insert(chapterViews)
          .values({
            chapterId,
            readerId: userId ?? null,
            sessionId: sessionId || randomUUID(),
            deviceType,
            referrer,
            readTimeSeconds: readTime ? Number(readTime) : 0,
            lastPositionPercent: position ? Number(position) : 0
          })
          .returning()
        if (!view) {
          return reply.status(500).send({ error: 'Failed to create view record', correlationId })
        }
        viewId = view.id
        isNewView = true
      }

      // Only increment view count for new views
      if (isNewView) {
        await db
          .update(chapterPublications)
          .set({
            viewCount: sql`CAST(${chapterPublications.viewCount} AS INTEGER) + 1`,
            updatedAt: new Date()
          })
          .where(eq(chapterPublications.chapterId, chapterId))
      }

      return reply.status(201).send({
        viewId,
        correlationId
      })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to track view')
      return reply.status(500).send({ error: 'Failed to track view', correlationId })
    }
  })

  /**
   * Get analytics for a project
   * Public aggregate statistics
   */
  fastify.get<{
    Params: { projectId: string }
  }>('/public/projects/:projectId/stats', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { projectId } = request.params

      if (!(await canViewProject(projectId, request.user?.id))) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }

      // Get aggregate stats
      const stats = await db
        .select({
          totalChapters: sql<number>`COUNT(DISTINCT ${chapterPublications.chapterId})`,
          totalViews: sql<number>`SUM(CAST(${chapterPublications.viewCount} AS INTEGER))`,
          averageViews: sql<number>`AVG(CAST(${chapterPublications.viewCount} AS INTEGER))`
        })
        .from(chapterPublications)
        .where(and(
          eq(chapterPublications.projectId, projectId),
          eq(chapterPublications.isPublished, true)
        ))

      return reply.send({
        stats: stats[0] || { totalChapters: 0, totalViews: 0, averageViews: 0 },
        correlationId
      })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get stats')
      return reply.status(500).send({ error: 'Failed to get stats', correlationId })
    }
  })
}

export default chaptersRoutes
