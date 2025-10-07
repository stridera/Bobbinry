import type { FastifyPluginAsync } from 'fastify'
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
  projectId: string
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
    // Check if embargo has passed
    const [embargo] = await db
      .select()
      .from(embargoSchedules)
      .where(and(eq(embargoSchedules.entityId, chapterId), eq(embargoSchedules.projectId, projectId)))
      .limit(1)

    if (embargo && embargo.publicReleaseDate) {
      const now = new Date()
      if (now < new Date(embargo.publicReleaseDate)) {
        return {
          canAccess: false,
          reason: 'Chapter is under embargo',
          embargoUntil: new Date(embargo.publicReleaseDate)
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
    .select()
    .from(subscriptions)
    .innerJoin(subscriptionTiers, eq(subscriptions.tierId, subscriptionTiers.id))
    .where(
      and(
        eq(subscriptions.subscriberId, userId),
        eq(subscriptions.authorId, project.ownerId),
        eq(subscriptions.status, 'active')
      )
    )
    .limit(1)

  if (subscription) {
    // Check if embargo delay has passed for this tier
    const [embargo] = await db
      .select()
      .from(embargoSchedules)
      .where(and(eq(embargoSchedules.entityId, chapterId), eq(embargoSchedules.projectId, projectId)))
      .limit(1)

    if (embargo && embargo.tierSchedules) {
      const tierSchedules = embargo.tierSchedules as any[]
      const tierSchedule = tierSchedules.find(
        (ts) => ts.tierId === subscription.subscriptions.tierId
      )

      if (tierSchedule && tierSchedule.releaseDate) {
        const now = new Date()
        if (now < new Date(tierSchedule.releaseDate)) {
          return {
            canAccess: false,
            reason: 'Chapter embargo for tier not yet lifted',
            embargoUntil: new Date(tierSchedule.releaseDate)
          }
        }
      }
    }

    return { canAccess: true, reason: 'Active subscription' }
  }

  // Check if chapter is public (embargo passed)
  const [embargo] = await db
    .select()
    .from(embargoSchedules)
    .where(and(eq(embargoSchedules.entityId, chapterId), eq(embargoSchedules.projectId, projectId)))
    .limit(1)

  if (embargo && embargo.publicReleaseDate) {
    const now = new Date()
    if (now < new Date(embargo.publicReleaseDate)) {
      return {
        canAccess: false,
        reason: 'Chapter is under embargo',
        embargoUntil: new Date(embargo.publicReleaseDate)
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
    }
  }>('/projects/:projectId/chapters/:chapterId/publish', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, chapterId } = request.params
      const { publishStatus, publishedVersion, firstPublishedAt } = request.body

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

      if (existing) {
        // Update existing
        const [updated] = await db
          .update(chapterPublications)
          .set({
            publishStatus,
            publishedVersion: version,
            lastPublishedAt: publishStatus === 'published' ? now : existing.lastPublishedAt,
            updatedAt: now
          })
          .where(eq(chapterPublications.id, existing.id))
          .returning()

        return reply.send({ publication: updated, correlationId })
      } else {
        // Create new publication record
        const [publication] = await db
          .insert(chapterPublications)
          .values({
            projectId,
            chapterId,
            publishStatus,
            publishedVersion: version,
            firstPublishedAt: firstPublishedAt ? new Date(firstPublishedAt) : publishStatus === 'published' ? now : null,
            lastPublishedAt: publishStatus === 'published' ? now : null
          })
          .returning()

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

        return reply.status(201).send({ publication, correlationId })
      }
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
          updatedAt: new Date()
        })
        .where(and(eq(chapterPublications.chapterId, chapterId), eq(chapterPublications.projectId, projectId)))
        .returning()

      if (!updated) {
        return reply.status(404).send({ error: 'Chapter publication not found', correlationId })
      }

      return reply.send({ publication: updated, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to unpublish chapter')
      return reply.status(500).send({ error: 'Failed to unpublish chapter', correlationId })
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

  // List all published chapters for a project
  fastify.get<{
    Params: { projectId: string }
    Querystring: { status?: string }
  }>('/projects/:projectId/publications', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params
      const { status } = request.query

      const whereConditions = status
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
  }>('/projects/:projectId/publish-config', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params

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
  }>('/projects/:projectId/publish-config', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params
      const updates = request.body

      // Check if config exists
      const [existing] = await db
        .select()
        .from(projectPublishConfig)
        .where(eq(projectPublishConfig.projectId, projectId))
        .limit(1)

      if (existing) {
        // Update
        const [updated] = await db
          .update(projectPublishConfig)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(projectPublishConfig.projectId, projectId))
          .returning()

        return reply.send({ config: updated, correlationId })
      } else {
        // Insert
        const [created] = await db
          .insert(projectPublishConfig)
          .values({ projectId, ...updates })
          .returning()

        return reply.status(201).send({ config: created, correlationId })
      }
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
      const totalReadTime = views.reduce((sum, v) => sum + parseInt(v.readTimeSeconds || '0'), 0)
      const avgReadTime = views.length > 0 ? Math.round(totalReadTime / views.length) : 0

      return reply.send({
        analytics: {
          totalViews: parseInt(publication.viewCount),
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

      const totalViews = publications.reduce((sum, p) => sum + parseInt(p.viewCount), 0)
      const totalCompletions = publications.reduce((sum, p) => sum + parseInt(p.completionCount), 0)
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

      const result = await checkChapterAccess(userId || null, chapterId, projectId)

      return reply.send({ ...result, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to check access')
      return reply.status(500).send({ error: 'Failed to check access', correlationId })
    }
  })
}

export default publishingPlugin
