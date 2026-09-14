import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import {
  contentTags,
  chapterPublications,
  embargoSchedules,
  entities,
  comments,
  reactions,
  chapterAnnotations,
  users
} from '../db/schema'
import { eq, and, sql, isNotNull, desc } from 'drizzle-orm'
import { chapterViewStats, getChapterViewStats } from '../lib/chapter-view-stats'
import { requireAuth, ownsProject } from '../middleware/auth'
import { loadProjectSummary } from '../lib/project-summary'
import { getSlugsForEntities } from '../lib/slugs'
import { countsTowardWordCount, type ContentType } from '@bobbinry/types'
import { notDeleted, TRASH_RETENTION_MS } from '../lib/entity-scope'
import { getManuscriptOrder } from '../lib/manuscript-order'

/** Rows per feed list on the dashboard. */
const ACTIVITY_FEED_LIMIT = 10

function snippet(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/** Matches the content_tags.tag_name column width. */
const MAX_TAG_NAME_LENGTH = 100

const VALID_TAG_CATEGORIES = ['genre', 'theme', 'trope', 'setting', 'custom'] as const

const projectTagsPlugin: FastifyPluginAsync = async (fastify) => {
  // ============================================
  // CONTENT TAGS CRUD
  // ============================================

  // List all tags for a project
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/tags', {
    preHandler: [requireAuth, ownsProject()]
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { projectId } = request.params

      const tags = await db
        .select({
          id: contentTags.id,
          tagCategory: contentTags.tagCategory,
          tagName: contentTags.tagName,
          createdAt: contentTags.createdAt
        })
        .from(contentTags)
        .where(eq(contentTags.projectId, projectId))

      return reply.send({ tags, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to list tags')
      return reply.status(500).send({ error: 'Failed to list tags', correlationId })
    }
  })

  // Add a tag to a project
  fastify.post<{
    Params: { projectId: string }
    Body: { tagCategory: string; tagName: string }
  }>('/projects/:projectId/tags', {
    preHandler: [requireAuth, ownsProject()]
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { projectId } = request.params
      const { tagCategory, tagName } = request.body

      // Validate category
      if (!VALID_TAG_CATEGORIES.includes(tagCategory as any)) {
        return reply.status(400).send({
          error: `Invalid tag category. Must be one of: ${VALID_TAG_CATEGORIES.join(', ')}`,
          correlationId
        })
      }

      // Validate tag name
      if (!tagName || tagName.trim().length === 0) {
        return reply.status(400).send({ error: 'Tag name is required', correlationId })
      }

      const trimmedName = tagName.trim()
      // content_tags.tag_name is varchar(100); without this the insert threw a
      // Postgres "value too long" error that surfaced as a 500.
      if (trimmedName.length > MAX_TAG_NAME_LENGTH) {
        return reply.status(400).send({
          error: `Tag name must be ${MAX_TAG_NAME_LENGTH} characters or fewer`,
          correlationId
        })
      }

      // Check for duplicate
      const [existing] = await db
        .select({ id: contentTags.id })
        .from(contentTags)
        .where(and(
          eq(contentTags.projectId, projectId),
          eq(contentTags.tagCategory, tagCategory),
          eq(contentTags.tagName, trimmedName)
        ))
        .limit(1)

      if (existing) {
        return reply.status(409).send({
          error: 'Tag already exists for this project',
          correlationId
        })
      }

      const [tag] = await db
        .insert(contentTags)
        .values({
          projectId,
          tagCategory,
          tagName: trimmedName
        })
        .returning()

      return reply.status(201).send({ tag, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to add tag')
      return reply.status(500).send({ error: 'Failed to add tag', correlationId })
    }
  })

  // Remove a tag
  fastify.delete<{
    Params: { projectId: string; tagId: string }
  }>('/projects/:projectId/tags/:tagId', {
    preHandler: [requireAuth, ownsProject()]
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { projectId, tagId } = request.params

      const deleted = await db
        .delete(contentTags)
        .where(and(
          eq(contentTags.id, tagId),
          eq(contentTags.projectId, projectId)
        ))
        .returning()

      if (deleted.length === 0) {
        return reply.status(404).send({ error: 'Tag not found', correlationId })
      }

      return reply.send({ success: true, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to delete tag')
      return reply.status(500).send({ error: 'Failed to delete tag', correlationId })
    }
  })

  // ============================================
  // DASHBOARD AGGREGATE ENDPOINT
  // ============================================

  fastify.get<{
    Params: { projectId: string }
    Querystring: {
      includeArchived?: 'archived-only' | 'all'
      includeDeleted?: 'deleted-only' | 'all'
    }
  }>('/projects/:projectId/dashboard', {
    preHandler: [requireAuth, ownsProject()]
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { projectId } = request.params
      const includeArchived = request.query.includeArchived
      const includeDeleted = request.query.includeDeleted

      // Trash is filtered in SQL, not in JS like archive is: this select pulls
      // full entity_data, so a client-side filter would ship every trashed
      // chapter's body to the browser on every dashboard load.
      const deletedFilter =
        includeDeleted === 'deleted-only' ? isNotNull(entities.deletedAt)
        : includeDeleted === 'all' ? undefined
        : notDeleted()

      // We always fetch every *live* chapter (active + archived) and partition
      // in JS before returning. Project chapter counts are small enough that
      // this is simpler than two queries and lets us return an accurate
      // `archivedCount` alongside any filter view.
      //
      // Trash is the exception — see `deletedFilter` above. It is excluded in
      // SQL and counted separately, because these rows carry full entity_data
      // and the default dashboard load must not ship deleted bodies.

      const [
        summary,
        tagsResult,
        publicationsResult,
        chaptersResult,
        trashCountResult,
        scheduledResult,
        commentCountsResult,
        reactionCountsResult,
        annotationCountsResult,
        recentCommentsResult,
        openAnnotationsResult
      ] = await Promise.all([
        // 1. Project identity, publish config, bobbins projection, per-bobbin
        // counts, and annotation totals — shared with the summary route.
        loadProjectSummary(projectId, request.user!.id),

        // 2. Content tags
        db
          .select({
            id: contentTags.id,
            tagCategory: contentTags.tagCategory,
            tagName: contentTags.tagName
          })
          .from(contentTags)
          .where(eq(contentTags.projectId, projectId)),

        // 3. Publications for analytics
        db
          .select()
          .from(chapterPublications)
          .where(eq(chapterPublications.projectId, projectId)),

        // 4. Chapters with publication data
        db
          .select({
            id: entities.id,
            entityData: entities.entityData,
            collectionName: entities.collectionName,
            contentType: entities.contentType,
            archivedAt: entities.archivedAt,
            deletedAt: entities.deletedAt,
            deletedBatchId: entities.deletedBatchId,
            pubId: chapterPublications.id,
            publishStatus: chapterPublications.publishStatus,
            publishedAt: chapterPublications.publishedAt,
            viewCount: chapterPublications.viewCount,
            // Derived from chapter_views rather than the stored counters of the
            // same name: unique_view_count and avg_read_time_seconds are never
            // written, and completion_count is only maintained by the legacy
            // PATCH /views/:viewId endpoint the reader does not call.
            uniqueViewCount: sql<number>`COALESCE(${sql.raw('view_stats.unique_viewers')}, 0)`,
            completionCount: sql<number>`COALESCE(${sql.raw('view_stats.completions')}, 0)`,
            avgReadTimeSeconds: sql<number>`COALESCE(${sql.raw('view_stats.avg_read_seconds')}, 0)`
          })
          .from(entities)
          .leftJoin(
            chapterPublications,
            eq(chapterPublications.chapterId, entities.id)
          )
          .leftJoin(
            chapterViewStats,
            sql`${sql.raw('view_stats.chapter_id')} = ${entities.id}`
          )
          .where(and(
            eq(entities.projectId, projectId),
            eq(entities.collectionName, 'content'),
            deletedFilter
          )),

        // 4b. Trash count — a separate count so the Trash chip can show a
        // number without the default view having to fetch trashed bodies.
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(entities)
          .where(and(
            eq(entities.projectId, projectId),
            eq(entities.collectionName, 'content'),
            isNotNull(entities.deletedAt)
          )),

        // 5. Scheduled releases
        db
          .select({
            chapterId: chapterPublications.chapterId,
            publishStatus: chapterPublications.publishStatus,
            publishedAt: chapterPublications.publishedAt,
            entityId: embargoSchedules.entityId,
            baseReleaseDate: embargoSchedules.baseReleaseDate,
            publicReleaseDate: embargoSchedules.publicReleaseDate
          })
          .from(chapterPublications)
          .leftJoin(
            embargoSchedules,
            eq(embargoSchedules.entityId, chapterPublications.chapterId)
          )
          .where(and(
            eq(chapterPublications.projectId, projectId),
            eq(chapterPublications.publishStatus, 'scheduled')
          )),

        // 6. Comment counts per chapter
        db
          .select({
            chapterId: comments.chapterId,
            count: sql<number>`count(*)::int`.as('count')
          })
          .from(comments)
          .innerJoin(entities, and(eq(entities.id, comments.chapterId), notDeleted()))
          .where(and(
            eq(entities.projectId, projectId),
            eq(comments.moderationStatus, 'approved')
          ))
          .groupBy(comments.chapterId),

        // 7. Reaction counts per chapter
        db
          .select({
            chapterId: reactions.chapterId,
            count: sql<number>`count(*)::int`.as('count')
          })
          .from(reactions)
          .innerJoin(entities, and(eq(entities.id, reactions.chapterId), notDeleted()))
          .where(eq(entities.projectId, projectId))
          .groupBy(reactions.chapterId),

        // 8. Annotation counts per chapter (open + acknowledged only)
        db
          .select({
            chapterId: chapterAnnotations.chapterId,
            count: sql<number>`count(*)::int`.as('count')
          })
          .from(chapterAnnotations)
          .where(and(
            eq(chapterAnnotations.projectId, projectId),
            sql`${chapterAnnotations.status} IN ('open', 'acknowledged')`
          ))
          .groupBy(chapterAnnotations.chapterId),

        // 9. Latest approved comments, for the dashboard's activity feed.
        // Replies included: a reader answering another reader is activity too.
        db
          .select({
            id: comments.id,
            chapterId: comments.chapterId,
            parentId: comments.parentId,
            authorName: users.name,
            content: comments.content,
            createdAt: comments.createdAt
          })
          .from(comments)
          .innerJoin(entities, and(eq(entities.id, comments.chapterId), notDeleted()))
          .leftJoin(users, eq(users.id, comments.authorId))
          .where(and(
            eq(entities.projectId, projectId),
            eq(comments.moderationStatus, 'approved')
          ))
          .orderBy(desc(comments.createdAt))
          .limit(ACTIVITY_FEED_LIMIT),

        // 10. Annotations still waiting on the author, newest first.
        db
          .select({
            id: chapterAnnotations.id,
            chapterId: chapterAnnotations.chapterId,
            authorName: users.name,
            annotationType: chapterAnnotations.annotationType,
            errorCategory: chapterAnnotations.errorCategory,
            anchorQuote: chapterAnnotations.anchorQuote,
            content: chapterAnnotations.content,
            status: chapterAnnotations.status,
            createdAt: chapterAnnotations.createdAt
          })
          .from(chapterAnnotations)
          .innerJoin(entities, and(eq(entities.id, chapterAnnotations.chapterId), notDeleted()))
          .leftJoin(users, eq(users.id, chapterAnnotations.authorId))
          .where(and(
            eq(chapterAnnotations.projectId, projectId),
            sql`${chapterAnnotations.status} IN ('open', 'acknowledged')`
          ))
          .orderBy(desc(chapterAnnotations.createdAt))
          .limit(ACTIVITY_FEED_LIMIT)
      ])

      if (!summary) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }
      const { project, config, bobbins, bobbinStats, annotationStats, authorUsername } = summary

      // Compute analytics from publications
      const totalViews = publicationsResult.reduce((sum, p) => sum + (p.viewCount ?? 0), 0)
      // completion_count on the row is unmaintained; count from chapter_views.
      const publicationViewStats = await getChapterViewStats(publicationsResult.map(p => p.chapterId))
      const totalCompletions = publicationsResult.reduce(
        (sum, p) => sum + (publicationViewStats.get(p.chapterId)?.completionCount ?? 0), 0)
      const publishedCount = publicationsResult.filter(p => p.publishStatus === 'published').length

      // Build lookup maps for comment/reaction/annotation counts
      const commentCountMap = new Map(commentCountsResult.map(c => [c.chapterId, c.count]))
      const reactionCountMap = new Map(reactionCountsResult.map(r => [r.chapterId, r.count]))
      const annotationCountMap = new Map(annotationCountsResult.map(a => [a.chapterId, a.count]))

      // Reader-URL slugs so the dashboard chapter list links the pretty URL,
      // and each row's place in the writing tab's tree.
      const [chapterSlugMap, manuscriptOrder] = await Promise.all([
        getSlugsForEntities(projectId, chaptersResult.map(ch => ch.id)),
        getManuscriptOrder(projectId),
      ])

      // Format chapters. `contentType` defaults to 'chapter' for legacy rows
      // that haven't been backfilled (the migration handles this on deploy).
      const allChapters = chaptersResult.map(ch => {
        const data = ch.entityData as Record<string, any>
        const contentType = (ch.contentType ?? 'chapter') as ContentType
        const wordCount = typeof data?.word_count === 'number' ? data.word_count : 0
        // Trashed rows are outside the tree, so they sort last.
        const placement = manuscriptOrder.get(ch.id)
        return {
          id: ch.id,
          slug: chapterSlugMap.get(ch.id) ?? null,
          title: data?.title || 'Untitled',
          order: data?.order ?? data?.sortOrder ?? 0,
          manuscriptPosition: placement?.position ?? Number.MAX_SAFE_INTEGER,
          folderPath: placement?.folderPath ?? null,
          collectionName: ch.collectionName,
          contentType,
          archivedAt: ch.archivedAt ? ch.archivedAt.toISOString() : null,
          deletedAt: ch.deletedAt ? ch.deletedAt.toISOString() : null,
          deletedBatchId: ch.deletedBatchId,
          // When this row is purged for good, so the trash view can count down.
          autoDeleteAt: ch.deletedAt
            ? new Date(ch.deletedAt.getTime() + TRASH_RETENTION_MS).toISOString()
            : null,
          wordCount,
          commentCount: commentCountMap.get(ch.id) ?? 0,
          reactionCount: reactionCountMap.get(ch.id) ?? 0,
          annotationCount: annotationCountMap.get(ch.id) ?? 0,
          publication: ch.pubId ? {
            publishStatus: ch.publishStatus,
            publishedAt: ch.publishedAt,
            viewCount: ch.viewCount,
            // Coerced because the derived aggregates come back from postgres as
            // strings, and consumers type these as numbers.
            uniqueViewCount: Number(ch.uniqueViewCount ?? 0),
            completionCount: Number(ch.completionCount ?? 0),
            avgReadTimeSeconds: Number(ch.avgReadTimeSeconds ?? 0)
          } : null
        }
      }).sort((a, b) => a.manuscriptPosition - b.manuscriptPosition)

      // Project-wide word count from narrative types only. Always excludes
      // archived rows so the total reflects active narrative content.
      const narrativeWordCount = allChapters.reduce((sum, ch) => {
        if (ch.archivedAt) return sum
        return sum + (countsTowardWordCount(ch.contentType) ? ch.wordCount : 0)
      }, 0)

      const archivedCount = allChapters.reduce(
        (n, ch) => (ch.archivedAt ? n + 1 : n),
        0,
      )

      // Counted in SQL, not from allChapters — the default view never fetches
      // trashed rows, so it has nothing to count.
      const trashedCount = trashCountResult[0]?.count ?? 0

      // Apply the includeArchived view filter for what we ship back as `chapters`.
      const chapters =
        includeArchived === 'archived-only'
          ? allChapters.filter(ch => ch.archivedAt !== null)
          : includeArchived === 'all'
            ? allChapters
            : allChapters.filter(ch => ch.archivedAt === null)

      // Format scheduled releases - get titles from chapters
      const chapterTitleMap = new Map(chapters.map(ch => [ch.id, ch.title]))
      const scheduledReleases = scheduledResult.map(s => ({
        chapterId: s.chapterId,
        chapterTitle: chapterTitleMap.get(s.chapterId) || 'Untitled',
        scheduledDate: s.publicReleaseDate || s.baseReleaseDate || s.publishedAt,
        publishStatus: s.publishStatus
      }))

      // Feed rows carry a snippet, not the whole body: the dashboard shows one
      // line per item and links through to the full text.
      const recentComments = recentCommentsResult.map(c => ({
        id: c.id,
        chapterId: c.chapterId,
        parentId: c.parentId,
        authorName: c.authorName,
        content: snippet(c.content),
        createdAt: c.createdAt
      }))
      const openAnnotations = openAnnotationsResult.map(a => ({
        id: a.id,
        chapterId: a.chapterId,
        authorName: a.authorName,
        annotationType: a.annotationType,
        errorCategory: a.errorCategory,
        anchorQuote: snippet(a.anchorQuote, 80),
        content: snippet(a.content),
        status: a.status,
        createdAt: a.createdAt
      }))

      return reply.send({
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          coverImage: project.coverImage,
          shortUrl: project.shortUrl,
          isArchived: project.isArchived,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt
        },
        authorUsername,
        tags: tagsResult,
        analytics: {
          totalChapters: publicationsResult.length,
          publishedChapters: publishedCount,
          totalViews,
          totalCompletions,
          avgViewsPerChapter: publicationsResult.length > 0 ? Math.round(totalViews / publicationsResult.length) : 0,
          narrativeWordCount,
          archivedCount,
          trashedCount
        },
        chapters,
        scheduledReleases,
        publishConfig: config,
        bobbins,
        bobbinStats,
        annotationStats,
        recentComments,
        openAnnotations,
        correlationId
      })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to load dashboard')
      return reply.status(500).send({ error: 'Failed to load dashboard', correlationId })
    }
  })

  /**
   * GET /projects/:projectId/summary
   *
   * What a project page's header needs and nothing else: identity, publish
   * state, the installed-bobbin projection with counts, and annotation
   * totals. The dashboard aggregate carries every chapter body alongside the
   * same data; the feedback, settings, and bobbins pages only need this.
   */
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/summary', {
    preHandler: [requireAuth, ownsProject()]
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { projectId } = request.params
      const summary = await loadProjectSummary(projectId, request.user!.id)
      if (!summary) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }
      const { project, config, bobbins, bobbinStats, annotationStats, authorUsername } = summary
      return reply.send({
        project: {
          id: project.id,
          name: project.name,
          coverImage: project.coverImage,
          shortUrl: project.shortUrl,
          isArchived: project.isArchived
        },
        authorUsername,
        publishConfig: {
          publishingMode: config.publishingMode,
          projectVisibility: config.projectVisibility,
          enableAnnotations: config.enableAnnotations ?? false
        },
        bobbins,
        bobbinStats,
        annotationStats,
        correlationId
      })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to load project summary')
      return reply.status(500).send({ error: 'Failed to load project summary', correlationId })
    }
  })
}

export default projectTagsPlugin
