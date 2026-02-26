import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import {
  contentTags,
  projects,
  chapterPublications,
  embargoSchedules,
  entities,
  projectPublishConfig,
  bobbinsInstalled,
  userProfiles
} from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { requireAuth, requireProjectOwnership } from '../middleware/auth'

const VALID_TAG_CATEGORIES = ['genre', 'theme', 'trope', 'setting', 'custom'] as const

const projectTagsPlugin: FastifyPluginAsync = async (fastify) => {
  // ============================================
  // CONTENT TAGS CRUD
  // ============================================

  // List all tags for a project
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/tags', {
    preHandler: [requireAuth]
  }, async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params

      const isOwner = await requireProjectOwnership(request, reply, projectId)
      if (!isOwner) return

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
    preHandler: [requireAuth]
  }, async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params
      const { tagCategory, tagName } = request.body

      const isOwner = await requireProjectOwnership(request, reply, projectId)
      if (!isOwner) return

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
    preHandler: [requireAuth]
  }, async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, tagId } = request.params

      const isOwner = await requireProjectOwnership(request, reply, projectId)
      if (!isOwner) return

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
  }>('/projects/:projectId/dashboard', {
    preHandler: [requireAuth]
  }, async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params

      const isOwner = await requireProjectOwnership(request, reply, projectId)
      if (!isOwner) return

      const [
        projectResult,
        tagsResult,
        publicationsResult,
        chaptersResult,
        scheduledResult,
        configResult,
        bobbinsResult,
        authorProfileResult
      ] = await Promise.all([
        // 1. Project details
        db
          .select()
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1),

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
            pubId: chapterPublications.id,
            publishStatus: chapterPublications.publishStatus,
            publishedAt: chapterPublications.publishedAt,
            viewCount: chapterPublications.viewCount,
            uniqueViewCount: chapterPublications.uniqueViewCount,
            completionCount: chapterPublications.completionCount,
            avgReadTimeSeconds: chapterPublications.avgReadTimeSeconds
          })
          .from(entities)
          .leftJoin(
            chapterPublications,
            eq(chapterPublications.chapterId, entities.id)
          )
          .where(eq(entities.projectId, projectId)),

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

        // 6. Publish config
        db
          .select()
          .from(projectPublishConfig)
          .where(eq(projectPublishConfig.projectId, projectId))
          .limit(1),

        // 7. Installed bobbins
        db
          .select({
            id: bobbinsInstalled.id,
            bobbinId: bobbinsInstalled.bobbinId,
            version: bobbinsInstalled.version,
            manifestJson: bobbinsInstalled.manifestJson
          })
          .from(bobbinsInstalled)
          .where(eq(bobbinsInstalled.projectId, projectId)),

        // 8. Author profile (for reader URL)
        db
          .select({
            username: userProfiles.username
          })
          .from(userProfiles)
          .where(eq(userProfiles.userId, request.user!.id))
          .limit(1)
      ])

      const project = projectResult[0]
      if (!project) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }

      // Compute analytics from publications
      const totalViews = publicationsResult.reduce((sum, p) => sum + (p.viewCount ?? 0), 0)
      const totalCompletions = publicationsResult.reduce((sum, p) => sum + (p.completionCount ?? 0), 0)
      const publishedCount = publicationsResult.filter(p => p.publishStatus === 'published').length

      // Format chapters
      const chapters = chaptersResult.map(ch => {
        const data = ch.entityData as Record<string, any>
        return {
          id: ch.id,
          title: data?.title || 'Untitled',
          order: data?.order ?? data?.sortOrder ?? 0,
          collectionName: ch.collectionName,
          publication: ch.pubId ? {
            publishStatus: ch.publishStatus,
            publishedAt: ch.publishedAt,
            viewCount: ch.viewCount,
            uniqueViewCount: ch.uniqueViewCount,
            completionCount: ch.completionCount,
            avgReadTimeSeconds: ch.avgReadTimeSeconds
          } : null
        }
      }).sort((a, b) => a.order - b.order)

      // Format scheduled releases - get titles from chapters
      const chapterTitleMap = new Map(chapters.map(ch => [ch.id, ch.title]))
      const scheduledReleases = scheduledResult.map(s => ({
        chapterId: s.chapterId,
        chapterTitle: chapterTitleMap.get(s.chapterId) || 'Untitled',
        scheduledDate: s.publicReleaseDate || s.baseReleaseDate || s.publishedAt,
        publishStatus: s.publishStatus
      }))

      // Format publish config with defaults
      const config = configResult[0] || {
        projectId,
        publishingMode: 'draft',
        defaultVisibility: 'public',
        autoReleaseEnabled: false,
        releaseFrequency: 'manual',
        enableComments: true,
        enableReactions: true,
        moderationMode: 'open'
      }

      // Format bobbins
      const bobbins = bobbinsResult.map(b => {
        const manifest = b.manifestJson as Record<string, any>
        return {
          id: b.id,
          bobbinId: b.bobbinId,
          version: b.version,
          manifest: {
            name: manifest?.name || b.bobbinId,
            description: manifest?.description || ''
          }
        }
      })

      const authorUsername = authorProfileResult[0]?.username || null

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
          avgViewsPerChapter: publicationsResult.length > 0 ? Math.round(totalViews / publicationsResult.length) : 0
        },
        chapters,
        scheduledReleases,
        publishConfig: config,
        bobbins,
        correlationId
      })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to load dashboard')
      return reply.status(500).send({ error: 'Failed to load dashboard', correlationId })
    }
  })
}

export default projectTagsPlugin
