import type { FastifyPluginAsync } from 'fastify'
import { requireAuth, requireProjectOwnership, requireVerified } from '../middleware/auth'
import { db } from '../db/connection'
import {
  chapterPublications,
  chapterViews,
  projectPublishConfig,
  embargoSchedules,
  projectDestinations,
  contentWarnings,
  publishSnapshots,
  entities,
  subscriptions,
  subscriptionTiers,
  betaReaders,
  accessGrants
} from '../db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { serverEventBus, contentPublished, contentStatusChange } from '../lib/event-bus'
import {
  getNextAvailableReleaseSlot,
  getProjectReleaseSchedule,
  reorderScheduleByEntityOrder,
  shouldAutoPublishAsGapFill,
  shiftFollowingScheduledChaptersUp,
  upsertScheduledChapterPublication
} from '../lib/release-schedule'

// ============================================
// ACCESS CONTROL HELPERS
// ============================================

interface AccessCheckResult {
  canAccess: boolean
  reason?: string
  embargoUntil?: Date
}

/**
 * Check if a user can access a specific chapter based on:
 * - Active subscription tier
 * - Beta reader status
 * - Access grants
 * - Embargo schedules
 */
async function checkChapterAccess(
  userId: string | null,
  chapterId: string,
  projectId: string,
  defaultVisibility?: string
): Promise<AccessCheckResult> {
  // Get chapter publication info
  const [chapterPub] = await db
    .select()
    .from(chapterPublications)
    .where(eq(chapterPublications.chapterId, chapterId))
    .limit(1)

  if (!chapterPub) {
    return { canAccess: false, reason: 'Chapter not published' }
  }

  // Draft chapters are not accessible
  if (chapterPub.publishStatus === 'draft') {
    return { canAccess: false, reason: 'Chapter is in draft' }
  }

  // Archived chapters are not accessible
  if (chapterPub.publishStatus === 'archived') {
    return { canAccess: false, reason: 'Chapter is archived' }
  }

  // Anonymous users can only access fully public chapters
  if (!userId) {
    if (defaultVisibility === 'subscribers_only') {
      return { canAccess: false, reason: 'Subscription required' }
    }

    if (chapterPub.publicReleaseDate) {
      const now = new Date()
      if (now < new Date(chapterPub.publicReleaseDate)) {
        return {
          canAccess: false,
          reason: 'Chapter is under embargo',
          embargoUntil: new Date(chapterPub.publicReleaseDate)
        }
      }
    }

    return { canAccess: true }
  }

  // Check beta reader status
  const [betaReader] = await db
    .select()
    .from(betaReaders)
    .where(
      and(
        eq(betaReaders.readerId, userId),
        eq(betaReaders.projectId, projectId),
        eq(betaReaders.isActive, true)
      )
    )
    .limit(1)

  if (betaReader) {
    return { canAccess: true, reason: 'Beta reader access' }
  }

  // Check access grants
  const [grant] = await db
    .select()
    .from(accessGrants)
    .where(
      and(
        eq(accessGrants.grantedTo, userId),
        eq(accessGrants.isActive, true),
        sql`(${accessGrants.projectId} = ${projectId} OR ${accessGrants.projectId} IS NULL)`,
        sql`(${accessGrants.expiresAt} IS NULL OR ${accessGrants.expiresAt} > NOW())`
      )
    )
    .limit(1)

  if (grant) {
    return { canAccess: true, reason: 'Access grant' }
  }

  // Get author from project
  const [project] = await db.query.projects.findMany({
    where: (projects, { eq }) => eq(projects.id, projectId),
    limit: 1
  })

  if (!project) {
    return { canAccess: false, reason: 'Project not found' }
  }

  // Check active subscription
  const [subscription] = await db
    .select({
      earlyAccessDays: subscriptionTiers.earlyAccessDays
    })
    .from(subscriptions)
    .innerJoin(subscriptionTiers, eq(subscriptions.tierId, subscriptionTiers.id))
    .where(
      and(
        eq(subscriptions.subscriberId, userId),
        eq(subscriptions.authorId, project.ownerId),
        eq(subscriptions.status, 'active'),
        sql`${subscriptions.currentPeriodEnd} > NOW()`
      )
    )
    .limit(1)

  if (subscription) {
    if (chapterPub.publishedAt) {
      const earlyMs = (subscription.earlyAccessDays ?? 0) * 24 * 60 * 60 * 1000
      const accessDate = new Date(chapterPub.publishedAt.getTime() - earlyMs)
      const now = new Date()

      if (now < accessDate) {
        return {
          canAccess: false,
          reason: 'Chapter not yet available for your tier',
          embargoUntil: accessDate
        }
      }
    }

    return { canAccess: true, reason: 'Active subscription' }
  }

  // Project-level subscriber-only restriction
  if (defaultVisibility === 'subscribers_only') {
    return { canAccess: false, reason: 'Subscription required' }
  }

  // Check if chapter is public (embargo passed)
  if (chapterPub.publicReleaseDate) {
    const now = new Date()
    if (now < new Date(chapterPub.publicReleaseDate)) {
      return {
        canAccess: false,
        reason: 'Chapter is under embargo',
        embargoUntil: new Date(chapterPub.publicReleaseDate)
      }
    }
  }

  return { canAccess: true }
}

// ============================================
// PLUGIN
// ============================================

const publishingPlugin: FastifyPluginAsync = async (fastify) => {
  // ============================================
  // CHAPTER PUBLICATION WORKFLOW
  // ============================================

  // Publish a chapter
  fastify.post<{
    Params: { projectId: string; chapterId: string }
    Body: {
      publishStatus: 'scheduled' | 'published'
      publishedVersion?: string
      firstPublishedAt?: string
      scheduledFor?: string
      publishEarly?: boolean
    }
  }>('/projects/:projectId/chapters/:chapterId/publish', {
    preHandler: [requireAuth, requireVerified]
  }, async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, chapterId } = request.params
      const { publishStatus, publishedVersion, firstPublishedAt, scheduledFor, publishEarly } = request.body

      // Check if chapter exists
      const [chapter] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.id, chapterId), eq(entities.projectId, projectId)))
        .limit(1)

      if (!chapter) {
        return reply.status(404).send({ error: 'Chapter not found', correlationId })
      }

      // Check if publication record exists
      const [existing] = await db
        .select()
        .from(chapterPublications)
        .where(and(eq(chapterPublications.chapterId, chapterId), eq(chapterPublications.projectId, projectId)))
        .limit(1)

      const now = new Date()
      const version = publishedVersion || '1.0'
      const scheduledDate = publishStatus === 'scheduled' && scheduledFor ? new Date(scheduledFor) : null
      const baseReleaseDate = publishStatus === 'scheduled' && scheduledDate ? scheduledDate : now
      const scheduledSlotBeingReleasedEarly =
        publishStatus === 'published' &&
        publishEarly &&
        existing?.publishStatus === 'scheduled' &&
        existing.publishedAt &&
        existing.publishedAt.getTime() > now.getTime()
          ? existing.publishedAt
          : null
      const publicReleaseDate = baseReleaseDate // public release = publish date

      if (publishStatus === 'scheduled' && (!scheduledDate || Number.isNaN(scheduledDate.getTime()))) {
        return reply.status(400).send({ error: 'scheduledFor is required for scheduled publication', correlationId })
      }

      let publication
      let isNew = false

      if (existing) {
        // Update existing
        const [updated] = await db
          .update(chapterPublications)
          .set({
            publishStatus,
            isPublished: publishStatus === 'published' || publishStatus === 'scheduled',
            publishedVersion: version,
            publishedAt: baseReleaseDate,
            publicReleaseDate,
            lastPublishedAt: publishStatus === 'published' ? now : existing.lastPublishedAt,
            updatedAt: now
          })
          .where(eq(chapterPublications.id, existing.id))
          .returning()
        publication = updated
      } else {
        // Create new publication record
        const [created] = await db
          .insert(chapterPublications)
          .values({
            projectId,
            chapterId,
            publishStatus,
            isPublished: publishStatus === 'published' || publishStatus === 'scheduled',
            publishedVersion: version,
            publishedAt: baseReleaseDate,
            publicReleaseDate,
            firstPublishedAt: firstPublishedAt ? new Date(firstPublishedAt) : baseReleaseDate,
            lastPublishedAt: publishStatus === 'published' ? now : null
          })
          .returning()
        publication = created
        isNew = true

        // Create snapshot
        if (chapter.lastEditedBy) {
          await db.insert(publishSnapshots).values({
            projectId,
            entityId: chapterId,
            versionNumber: version,
            snapshotData: chapter.entityData,
            publishedBy: chapter.lastEditedBy,
            notes: 'Initial publication'
          })
        }
      }

      // Emit content:published event
      if (publishStatus === 'published') {
        if (scheduledSlotBeingReleasedEarly) {
          const schedule = await getProjectReleaseSchedule(projectId)
          if (schedule?.autoReleaseEnabled && schedule.releaseFrequency !== 'manual') {
            await shiftFollowingScheduledChaptersUp(projectId, scheduledSlotBeingReleasedEarly, { excludeChapterId: chapterId })
          }
        }

        serverEventBus.fire(contentPublished(
          projectId, chapterId, chapter.lastEditedBy || 'system', true
        ))
      }

      return reply.status(isNew ? 201 : 200).send({ publication, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to publish chapter')
      return reply.status(500).send({ error: 'Failed to publish chapter', correlationId })
    }
  })

  // Unpublish a chapter
  fastify.post<{
    Params: { projectId: string; chapterId: string }
  }>('/projects/:projectId/chapters/:chapterId/unpublish', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, chapterId } = request.params

      const [updated] = await db
        .update(chapterPublications)
        .set({
          publishStatus: 'draft',
          isPublished: false,
          publishedAt: null,
          publicReleaseDate: null,
          updatedAt: new Date()
        })
        .where(and(eq(chapterPublications.chapterId, chapterId), eq(chapterPublications.projectId, projectId)))
        .returning()

      if (!updated) {
        return reply.status(404).send({ error: 'Chapter publication not found', correlationId })
      }

      // Emit content:published event (unpublished)
      serverEventBus.fire(contentPublished(projectId, chapterId, 'system', false))

      return reply.send({ publication: updated, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to unpublish chapter')
      return reply.status(500).send({ error: 'Failed to unpublish chapter', correlationId })
    }
  })

  // Mark a chapter as complete (writing -> complete, gates audience publishing)
  fastify.post<{
    Params: { projectId: string; chapterId: string }
  }>('/projects/:projectId/chapters/:chapterId/complete', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, chapterId } = request.params

      // Check if chapter exists
      const [chapter] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.id, chapterId), eq(entities.projectId, projectId)))
        .limit(1)

      if (!chapter) {
        return reply.status(404).send({ error: 'Chapter not found', correlationId })
      }

      // Check/create publication record
      const [existing] = await db
        .select()
        .from(chapterPublications)
        .where(and(eq(chapterPublications.chapterId, chapterId), eq(chapterPublications.projectId, projectId)))
        .limit(1)

      const now = new Date()

      let publication
      let isNew = false

      if (existing) {
        const [updated] = await db
          .update(chapterPublications)
          .set({ publishStatus: 'complete', updatedAt: now })
          .where(eq(chapterPublications.id, existing.id))
          .returning()
        publication = updated
      } else {
        const [created] = await db
          .insert(chapterPublications)
          .values({
            projectId, chapterId,
            publishStatus: 'complete',
            isPublished: false
          })
          .returning()
        publication = created
        isNew = true
      }

      try {
        // Check if this chapter fills a gap between published chapters
        const isGapFill = await shouldAutoPublishAsGapFill(projectId, chapterId)
        if (isGapFill) {
          // Auto-publish immediately — it fills a gap in the published sequence
          const now2 = new Date()
          const [autoPublished] = await db
            .update(chapterPublications)
            .set({
              publishStatus: 'published',
              isPublished: true,
              publishedAt: now2,
              publicReleaseDate: now2,
              lastPublishedAt: now2,
              updatedAt: now2,
            })
            .where(and(eq(chapterPublications.chapterId, chapterId), eq(chapterPublications.projectId, projectId)))
            .returning()
          if (autoPublished) publication = autoPublished
        } else {
          // Normal auto-scheduling: assign next available slot, then reorder by entity order
          const nextReleaseSlot = await getNextAvailableReleaseSlot(projectId, { excludeChapterId: chapterId })
          if (nextReleaseSlot) {
            const publishedVersion = publication?.publishedVersion || '1.0'
            publication = await upsertScheduledChapterPublication(projectId, chapterId, nextReleaseSlot, publishedVersion)
            await reorderScheduleByEntityOrder(projectId)
            // Re-fetch to get potentially reordered date
            const [refreshed] = await db
              .select()
              .from(chapterPublications)
              .where(and(eq(chapterPublications.chapterId, chapterId), eq(chapterPublications.projectId, projectId)))
              .limit(1)
            if (refreshed) publication = refreshed
          }
        }
      } catch (scheduleError) {
        fastify.log.warn({ err: scheduleError, projectId, chapterId }, 'Failed to auto-schedule completed chapter')
      }

      if (!publication) {
        return reply.status(500).send({ error: 'Failed to update chapter status', correlationId })
      }

      serverEventBus.fire(contentStatusChange(projectId, chapterId, chapter.lastEditedBy || 'system', 'complete'))
      return reply.status(isNew ? 201 : 200).send({ publication, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to mark chapter complete')
      return reply.status(500).send({ error: 'Failed to mark chapter complete', correlationId })
    }
  })

  // Revert a chapter to draft status (complete -> draft)
  fastify.post<{
    Params: { projectId: string; chapterId: string }
  }>('/projects/:projectId/chapters/:chapterId/revert-to-draft', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, chapterId } = request.params

      const [updated] = await db
        .update(chapterPublications)
        .set({ publishStatus: 'draft', updatedAt: new Date() })
        .where(and(eq(chapterPublications.chapterId, chapterId), eq(chapterPublications.projectId, projectId)))
        .returning()

      if (!updated) {
        return reply.status(404).send({ error: 'Chapter publication not found', correlationId })
      }

      serverEventBus.fire(contentStatusChange(projectId, chapterId, 'system', 'draft'))
      return reply.send({ publication: updated, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to revert chapter to draft')
      return reply.status(500).send({ error: 'Failed to revert chapter to draft', correlationId })
    }
  })

  // Get chapter publication status
  fastify.get<{
    Params: { projectId: string; chapterId: string }
  }>('/projects/:projectId/chapters/:chapterId/publication', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, chapterId } = request.params

      const [publication] = await db
        .select()
        .from(chapterPublications)
        .where(and(eq(chapterPublications.chapterId, chapterId), eq(chapterPublications.projectId, projectId)))
        .limit(1)

      if (!publication) {
        return reply.status(404).send({ error: 'Chapter publication not found', correlationId })
      }

      return reply.send({ publication, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get publication status')
      return reply.status(500).send({ error: 'Failed to get publication status', correlationId })
    }
  })

  // Preview the next auto-release slot for a chapter
  fastify.get<{
    Params: { projectId: string; chapterId: string }
  }>('/projects/:projectId/chapters/:chapterId/next-release-slot', {
    preHandler: requireAuth
  }, async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, chapterId } = request.params
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      const nextReleaseSlot = await getNextAvailableReleaseSlot(projectId, { excludeChapterId: chapterId })
      return reply.send({
        nextReleaseSlot,
        correlationId,
      })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get next release slot')
      return reply.status(500).send({ error: 'Failed to get next release slot', correlationId })
    }
  })

  // List all published chapters for a project
  fastify.get<{
    Params: { projectId: string }
    Querystring: { status?: string }
  }>('/projects/:projectId/publications', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params
      const { status } = request.query

      const whereConditions = (status && status !== 'all')
        ? and(eq(chapterPublications.projectId, projectId), eq(chapterPublications.publishStatus, status))
        : eq(chapterPublications.projectId, projectId)

      const publications = await db
        .select()
        .from(chapterPublications)
        .where(whereConditions)
        .orderBy(desc(chapterPublications.lastPublishedAt))

      return reply.send({ publications, count: publications.length, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to list publications')
      return reply.status(500).send({ error: 'Failed to list publications', correlationId })
    }
  })

  // ============================================
  // PROJECT PUBLISH CONFIGURATION
  // ============================================

  // Get project publish config
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/publish-config', {
    preHandler: requireAuth
  }, async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      const [config] = await db
        .select()
        .from(projectPublishConfig)
        .where(eq(projectPublishConfig.projectId, projectId))
        .limit(1)

      if (!config) {
        // Return defaults
        return reply.send({
          config: {
            projectId,
            publishingMode: 'draft',
            defaultVisibility: 'public',
            autoReleaseEnabled: false,
            releaseFrequency: 'manual',
            enableComments: true,
            enableReactions: true,
            moderationMode: 'open'
          },
          correlationId
        })
      }

      return reply.send({ config, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get publish config')
      return reply.status(500).send({ error: 'Failed to get publish config', correlationId })
    }
  })

  // Update project publish config
  fastify.put<{
    Params: { projectId: string }
    Body: {
      publishingMode?: string
      defaultVisibility?: string
      autoReleaseEnabled?: boolean
      releaseFrequency?: string
      releaseDay?: string
      releaseTime?: string
      slugPrefix?: string
      seoDescription?: string
      ogImageUrl?: string
      enableComments?: boolean
      enableReactions?: boolean
      moderationMode?: string
    }
  }>('/projects/:projectId/publish-config', {
    preHandler: [requireAuth, requireVerified]
  }, async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params
      const updates = request.body
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      // Check if config exists
      const [existing] = await db
        .select()
        .from(projectPublishConfig)
        .where(eq(projectPublishConfig.projectId, projectId))
        .limit(1)

      let config
      let statusCode = 200

      if (existing) {
        const [updated] = await db
          .update(projectPublishConfig)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(projectPublishConfig.projectId, projectId))
          .returning()
        config = updated
      } else {
        const [created] = await db
          .insert(projectPublishConfig)
          .values({ projectId, ...updates })
          .returning()
        config = created
        statusCode = 201
      }

      // When auto-release is enabled, schedule any complete chapters that aren't scheduled yet
      if (config?.autoReleaseEnabled && config.releaseFrequency && config.releaseFrequency !== 'manual') {
        try {
          const completeChapters = await db
            .select({ chapterId: chapterPublications.chapterId, publishedVersion: chapterPublications.publishedVersion })
            .from(chapterPublications)
            .where(and(
              eq(chapterPublications.projectId, projectId),
              eq(chapterPublications.publishStatus, 'complete')
            ))

          for (const chapter of completeChapters) {
            const slot = await getNextAvailableReleaseSlot(projectId, { excludeChapterId: chapter.chapterId })
            if (slot) {
              await upsertScheduledChapterPublication(projectId, chapter.chapterId, slot, chapter.publishedVersion || '1.0')
            }
          }
        } catch (scheduleError) {
          fastify.log.warn({ err: scheduleError, projectId }, 'Failed to auto-schedule complete chapters after config update')
        }
      }

      return reply.status(statusCode).send({ config, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to update publish config')
      return reply.status(500).send({ error: 'Failed to update publish config', correlationId })
    }
  })

  // ============================================
  // EMBARGO SCHEDULES
  // ============================================

  // Create embargo schedule for a chapter
  fastify.post<{
    Params: { projectId: string }
    Body: {
      entityId: string
      publishMode: string
      baseReleaseDate?: string
      publicReleaseDate?: string
      tierSchedules?: Array<{ tierId: string; releaseDate: string }>
    }
  }>('/projects/:projectId/embargoes', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params
      const { entityId, publishMode, baseReleaseDate, publicReleaseDate, tierSchedules } = request.body

      const [embargo] = await db
        .insert(embargoSchedules)
        .values({
          projectId,
          entityId,
          publishMode,
          baseReleaseDate: baseReleaseDate ? new Date(baseReleaseDate) : null,
          publicReleaseDate: publicReleaseDate ? new Date(publicReleaseDate) : null,
          tierSchedules: tierSchedules || []
        })
        .returning()

      return reply.status(201).send({ embargo, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to create embargo')
      return reply.status(500).send({ error: 'Failed to create embargo', correlationId })
    }
  })

  // Get embargo schedule for a chapter
  fastify.get<{
    Params: { projectId: string; chapterId: string }
  }>('/projects/:projectId/chapters/:chapterId/embargo', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, chapterId } = request.params

      const [embargo] = await db
        .select()
        .from(embargoSchedules)
        .where(and(eq(embargoSchedules.projectId, projectId), eq(embargoSchedules.entityId, chapterId)))
        .limit(1)

      if (!embargo) {
        return reply.status(404).send({ error: 'Embargo not found', correlationId })
      }

      return reply.send({ embargo, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get embargo')
      return reply.status(500).send({ error: 'Failed to get embargo', correlationId })
    }
  })

  // Update embargo schedule
  fastify.put<{
    Params: { embargoId: string }
    Body: {
      publishMode?: string
      baseReleaseDate?: string
      publicReleaseDate?: string
      tierSchedules?: Array<{ tierId: string; releaseDate: string }>
      isPublished?: boolean
    }
  }>('/embargoes/:embargoId', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { embargoId } = request.params
      const updates = request.body

      const updateData: any = { updatedAt: new Date() }
      if (updates.publishMode) updateData.publishMode = updates.publishMode
      if (updates.baseReleaseDate) updateData.baseReleaseDate = new Date(updates.baseReleaseDate)
      if (updates.publicReleaseDate) updateData.publicReleaseDate = new Date(updates.publicReleaseDate)
      if (updates.tierSchedules) updateData.tierSchedules = updates.tierSchedules
      if (updates.isPublished !== undefined) updateData.isPublished = updates.isPublished

      const [updated] = await db
        .update(embargoSchedules)
        .set(updateData)
        .where(eq(embargoSchedules.id, embargoId))
        .returning()

      if (!updated) {
        return reply.status(404).send({ error: 'Embargo not found', correlationId })
      }

      return reply.send({ embargo: updated, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to update embargo')
      return reply.status(500).send({ error: 'Failed to update embargo', correlationId })
    }
  })

  // Delete embargo schedule
  fastify.delete<{
    Params: { embargoId: string }
  }>('/embargoes/:embargoId', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { embargoId } = request.params

      await db.delete(embargoSchedules).where(eq(embargoSchedules.id, embargoId))

      return reply.send({ success: true, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to delete embargo')
      return reply.status(500).send({ error: 'Failed to delete embargo', correlationId })
    }
  })

  // ============================================
  // DESTINATIONS (Google Drive, etc.)
  // ============================================

  // List destinations for a project
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/destinations', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params

      const destinations = await db
        .select()
        .from(projectDestinations)
        .where(eq(projectDestinations.projectId, projectId))
        .orderBy(desc(projectDestinations.createdAt))

      return reply.send({ destinations, count: destinations.length, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to list destinations')
      return reply.status(500).send({ error: 'Failed to list destinations', correlationId })
    }
  })

  // Create destination
  fastify.post<{
    Params: { projectId: string }
    Body: {
      type: string
      name: string
      config: any
      isActive?: boolean
    }
  }>('/projects/:projectId/destinations', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params
      const { type, name, config, isActive } = request.body

      const [destination] = await db
        .insert(projectDestinations)
        .values({
          projectId,
          type,
          name,
          config,
          isActive: isActive !== undefined ? isActive : true
        })
        .returning()

      return reply.status(201).send({ destination, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to create destination')
      return reply.status(500).send({ error: 'Failed to create destination', correlationId })
    }
  })

  // Update destination
  fastify.put<{
    Params: { destinationId: string }
    Body: {
      name?: string
      config?: any
      isActive?: boolean
      lastSyncStatus?: string
      lastSyncError?: string
    }
  }>('/destinations/:destinationId', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { destinationId } = request.params
      const updates = request.body

      const [updated] = await db
        .update(projectDestinations)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(projectDestinations.id, destinationId))
        .returning()

      if (!updated) {
        return reply.status(404).send({ error: 'Destination not found', correlationId })
      }

      return reply.send({ destination: updated, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to update destination')
      return reply.status(500).send({ error: 'Failed to update destination', correlationId })
    }
  })

  // Delete destination
  fastify.delete<{
    Params: { destinationId: string }
  }>('/destinations/:destinationId', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { destinationId } = request.params

      await db.delete(projectDestinations).where(eq(projectDestinations.id, destinationId))

      return reply.send({ success: true, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to delete destination')
      return reply.status(500).send({ error: 'Failed to delete destination', correlationId })
    }
  })

  // Record sync attempt
  fastify.post<{
    Params: { destinationId: string }
    Body: {
      status: 'success' | 'failed'
      error?: string
    }
  }>('/destinations/:destinationId/sync', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { destinationId } = request.params
      const { status, error } = request.body

      const [updated] = await db
        .update(projectDestinations)
        .set({
          lastSyncedAt: new Date(),
          lastSyncStatus: status,
          lastSyncError: error || null,
          updatedAt: new Date()
        })
        .where(eq(projectDestinations.id, destinationId))
        .returning()

      if (!updated) {
        return reply.status(404).send({ error: 'Destination not found', correlationId })
      }

      return reply.send({ destination: updated, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to record sync')
      return reply.status(500).send({ error: 'Failed to record sync', correlationId })
    }
  })

  // ============================================
  // CONTENT WARNINGS
  // ============================================

  // List content warnings for a project
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/content-warnings', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params

      const warnings = await db
        .select()
        .from(contentWarnings)
        .where(eq(contentWarnings.projectId, projectId))

      return reply.send({ warnings, count: warnings.length, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to list content warnings')
      return reply.status(500).send({ error: 'Failed to list content warnings', correlationId })
    }
  })

  // Create content warning
  fastify.post<{
    Params: { projectId: string }
    Body: {
      warningType: string
      customLabel?: string
      severity?: string
      displayInSummary?: boolean
      requireAgeGate?: boolean
    }
  }>('/projects/:projectId/content-warnings', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params
      const { warningType, customLabel, severity, displayInSummary, requireAgeGate } = request.body

      const [warning] = await db
        .insert(contentWarnings)
        .values({
          projectId,
          warningType,
          customLabel,
          severity: severity || 'moderate',
          displayInSummary: displayInSummary !== undefined ? displayInSummary : true,
          requireAgeGate: requireAgeGate !== undefined ? requireAgeGate : false
        })
        .returning()

      return reply.status(201).send({ warning, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to create content warning')
      return reply.status(500).send({ error: 'Failed to create content warning', correlationId })
    }
  })

  // Delete content warning
  fastify.delete<{
    Params: { warningId: string }
  }>('/content-warnings/:warningId', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { warningId } = request.params

      await db.delete(contentWarnings).where(eq(contentWarnings.id, warningId))

      return reply.send({ success: true, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to delete content warning')
      return reply.status(500).send({ error: 'Failed to delete content warning', correlationId })
    }
  })

  // ============================================
  // ANALYTICS
  // ============================================

  // Track chapter view
  fastify.post<{
    Params: { chapterId: string }
    Body: {
      readerId?: string
      sessionId?: string
      deviceType?: string
      referrer?: string
    }
  }>('/chapters/:chapterId/views', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { chapterId } = request.params
      const { readerId, sessionId, deviceType, referrer } = request.body

      const [view] = await db
        .insert(chapterViews)
        .values({
          chapterId,
          readerId: readerId || null,
          sessionId: sessionId || randomUUID(),
          deviceType,
          referrer
        })
        .returning()

      // Increment view count
      await db
        .update(chapterPublications)
        .set({
          viewCount: sql`CAST(${chapterPublications.viewCount} AS INTEGER) + 1`,
          updatedAt: new Date()
        })
        .where(eq(chapterPublications.chapterId, chapterId))

      return reply.status(201).send({ view, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to track view')
      return reply.status(500).send({ error: 'Failed to track view', correlationId })
    }
  })

  // Update reading progress
  fastify.put<{
    Params: { viewId: string }
    Body: {
      lastPositionPercent?: string
      readTimeSeconds?: string
      completed?: boolean
    }
  }>('/chapter-views/:viewId/progress', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { viewId } = request.params
      const { lastPositionPercent, readTimeSeconds, completed } = request.body

      const updateData: any = {}
      if (lastPositionPercent) updateData.lastPositionPercent = lastPositionPercent
      if (readTimeSeconds) updateData.readTimeSeconds = readTimeSeconds
      if (completed) {
        updateData.completedAt = new Date()

        // Increment completion count
        const [view] = await db.select().from(chapterViews).where(eq(chapterViews.id, viewId)).limit(1)
        if (view) {
          await db
            .update(chapterPublications)
            .set({
              completionCount: sql`CAST(${chapterPublications.completionCount} AS INTEGER) + 1`
            })
            .where(eq(chapterPublications.chapterId, view.chapterId))
        }
      }

      const [updated] = await db
        .update(chapterViews)
        .set(updateData)
        .where(eq(chapterViews.id, viewId))
        .returning()

      if (!updated) {
        return reply.status(404).send({ error: 'View not found', correlationId })
      }

      return reply.send({ view: updated, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to update progress')
      return reply.status(500).send({ error: 'Failed to update progress', correlationId })
    }
  })

  // Get analytics for a chapter
  fastify.get<{
    Params: { projectId: string; chapterId: string }
  }>('/projects/:projectId/chapters/:chapterId/analytics', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { chapterId } = request.params

      const [publication] = await db
        .select()
        .from(chapterPublications)
        .where(eq(chapterPublications.chapterId, chapterId))
        .limit(1)

      if (!publication) {
        return reply.status(404).send({ error: 'Chapter publication not found', correlationId })
      }

      // Get view statistics
      const views = await db
        .select()
        .from(chapterViews)
        .where(eq(chapterViews.chapterId, chapterId))

      const uniqueReaders = new Set(views.filter((v) => v.readerId).map((v) => v.readerId)).size
      const completedViews = views.filter((v) => v.completedAt).length
      const totalReadTime = views.reduce((sum, v) => sum + (v.readTimeSeconds || 0), 0)
      const avgReadTime = views.length > 0 ? Math.round(totalReadTime / views.length) : 0

      return reply.send({
        analytics: {
          totalViews: publication.viewCount,
          uniqueReaders,
          completions: completedViews,
          completionRate: views.length > 0 ? ((completedViews / views.length) * 100).toFixed(1) : '0',
          avgReadTimeSeconds: avgReadTime,
          firstPublishedAt: publication.firstPublishedAt,
          lastPublishedAt: publication.lastPublishedAt
        },
        correlationId
      })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get analytics')
      return reply.status(500).send({ error: 'Failed to get analytics', correlationId })
    }
  })

  // Get per-chapter analytics breakdown (device, progress, referrers)
  fastify.get<{
    Params: { projectId: string; chapterId: string }
  }>('/projects/:projectId/chapters/:chapterId/analytics/breakdown', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { chapterId } = request.params

      const progressBucket = sql`CASE
        WHEN ${chapterViews.completedAt} IS NOT NULL THEN 'completed'
        WHEN ${chapterViews.lastPositionPercent} >= 75 THEN '75-100'
        WHEN ${chapterViews.lastPositionPercent} >= 50 THEN '50-75'
        WHEN ${chapterViews.lastPositionPercent} >= 25 THEN '25-50'
        ELSE '0-25'
      END`

      // Run all three aggregations concurrently
      const [deviceRows, progressRows, referrerRows] = await Promise.all([
        db
          .select({
            deviceType: chapterViews.deviceType,
            count: sql<number>`count(*)::int`
          })
          .from(chapterViews)
          .where(eq(chapterViews.chapterId, chapterId))
          .groupBy(chapterViews.deviceType),

        db
          .select({
            bucket: sql<string>`${progressBucket}`,
            count: sql<number>`count(*)::int`
          })
          .from(chapterViews)
          .where(eq(chapterViews.chapterId, chapterId))
          .groupBy(progressBucket),

        db
          .select({
            referrer: chapterViews.referrer,
            count: sql<number>`count(*)::int`
          })
          .from(chapterViews)
          .where(and(eq(chapterViews.chapterId, chapterId), sql`${chapterViews.referrer} IS NOT NULL`))
          .groupBy(chapterViews.referrer)
          .orderBy(sql`count(*) DESC`)
          .limit(5),
      ])

      const devices: Record<string, number> = {}
      for (const row of deviceRows) {
        devices[row.deviceType || 'unknown'] = row.count
      }

      const progress: Record<string, number> = { '0-25': 0, '25-50': 0, '50-75': 0, '75-100': 0, completed: 0 }
      for (const row of progressRows) {
        progress[row.bucket] = row.count
      }

      const referrers = referrerRows.map(r => ({ referrer: r.referrer || 'direct', count: r.count }))

      return reply.send({ breakdown: { devices, progress, referrers }, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get analytics breakdown')
      return reply.status(500).send({ error: 'Failed to get analytics breakdown', correlationId })
    }
  })

  // Get per-chapter analytics for an entire project
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/analytics/chapters', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params

      const rows = await db
        .select({
          chapterId: chapterPublications.chapterId,
          title: sql<string>`${entities.entityData}->>'title'`,
          order: sql<number>`(${entities.entityData}->>'order')::int`,
          viewCount: chapterPublications.viewCount,
          uniqueViewCount: chapterPublications.uniqueViewCount,
          completionCount: chapterPublications.completionCount,
          avgReadTimeSeconds: chapterPublications.avgReadTimeSeconds,
        })
        .from(chapterPublications)
        .innerJoin(entities, eq(entities.id, chapterPublications.chapterId))
        .where(eq(chapterPublications.projectId, projectId))
        .orderBy(sql`(${entities.entityData}->>'order')::int`)

      const chapters = rows.map(r => ({
        chapterId: r.chapterId,
        title: r.title || 'Untitled',
        order: r.order ?? 0,
        viewCount: Number(r.viewCount || 0),
        uniqueViewCount: Number(r.uniqueViewCount || 0),
        completionCount: Number(r.completionCount || 0),
        avgReadTimeSeconds: Number(r.avgReadTimeSeconds || 0),
      }))

      return reply.send({ chapters, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get chapter analytics')
      return reply.status(500).send({ error: 'Failed to get chapter analytics', correlationId })
    }
  })

  // Get project-level analytics
  fastify.get<{
    Params: { projectId: string }
    Querystring: { startDate?: string; endDate?: string }
  }>('/projects/:projectId/analytics', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params
      // const { startDate, endDate } = request.query // TODO: Use for date filtering

      let query = db
        .select()
        .from(chapterPublications)
        .where(eq(chapterPublications.projectId, projectId))

      const publications = await query

      const totalViews = publications.reduce((sum, p) => sum + (p.viewCount || 0), 0)
      const totalCompletions = publications.reduce((sum, p) => sum + (p.completionCount || 0), 0)
      const publishedCount = publications.filter((p) => p.publishStatus === 'published').length

      return reply.send({
        analytics: {
          totalChapters: publications.length,
          publishedChapters: publishedCount,
          totalViews,
          totalCompletions,
          avgViewsPerChapter: publications.length > 0 ? Math.round(totalViews / publications.length) : 0
        },
        correlationId
      })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get project analytics')
      return reply.status(500).send({ error: 'Failed to get project analytics', correlationId })
    }
  })

  // ============================================
  // VERSION HISTORY ENDPOINT
  // ============================================

  // Get publish snapshots for a chapter (version history)
  fastify.get<{
    Params: { projectId: string; chapterId: string }
    Querystring: { limit?: number; offset?: number }
  }>('/projects/:projectId/chapters/:chapterId/snapshots', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, chapterId } = request.params
      const { limit = 20, offset = 0 } = request.query

      const snapshots = await db
        .select({
          id: publishSnapshots.id,
          versionNumber: publishSnapshots.versionNumber,
          publishedAt: publishSnapshots.publishedAt,
          notes: publishSnapshots.notes,
          publishedBy: publishSnapshots.publishedBy
        })
        .from(publishSnapshots)
        .where(and(
          eq(publishSnapshots.projectId, projectId),
          eq(publishSnapshots.entityId, chapterId)
        ))
        .orderBy(desc(publishSnapshots.publishedAt))
        .limit(limit)
        .offset(offset)

      return reply.send({ snapshots, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get snapshots')
      return reply.status(500).send({ error: 'Failed to get snapshots', correlationId })
    }
  })

  // Get a specific snapshot's content
  fastify.get<{
    Params: { projectId: string; snapshotId: string }
  }>('/projects/:projectId/snapshots/:snapshotId', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, snapshotId } = request.params

      const [snapshot] = await db
        .select()
        .from(publishSnapshots)
        .where(and(
          eq(publishSnapshots.id, snapshotId),
          eq(publishSnapshots.projectId, projectId)
        ))
        .limit(1)

      if (!snapshot) {
        return reply.status(404).send({ error: 'Snapshot not found', correlationId })
      }

      return reply.send({ snapshot, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get snapshot')
      return reply.status(500).send({ error: 'Failed to get snapshot', correlationId })
    }
  })

  // ============================================
  // ACCESS CHECK ENDPOINT
  // ============================================

  // Check if user can access a chapter
  fastify.get<{
    Params: { projectId: string; chapterId: string }
    Querystring: { userId?: string }
  }>('/projects/:projectId/chapters/:chapterId/access', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, chapterId } = request.params
      const { userId } = request.query

      // Get project visibility setting
      const [accessPublishConfig] = await db
        .select({ defaultVisibility: projectPublishConfig.defaultVisibility })
        .from(projectPublishConfig)
        .where(eq(projectPublishConfig.projectId, projectId))
        .limit(1)

      const result = await checkChapterAccess(userId || null, chapterId, projectId, accessPublishConfig?.defaultVisibility || 'public')

      return reply.send({ ...result, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to check access')
      return reply.status(500).send({ error: 'Failed to check access', correlationId })
    }
  })
}

export default publishingPlugin
