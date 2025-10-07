/**
 * Web Publisher Bobbin - Action Handlers
 *
 * These handlers implement the custom actions defined in the manifest.
 * They are invoked by the API when the bobbin receives action requests via the message bus.
 */

import type { FastifyInstance } from 'fastify'

export interface ActionContext {
  projectId: string
  bobbinId: string
  viewId?: string
  userId?: string
  entityId?: string
}

export interface ActionResult {
  success: boolean
  data?: any
  error?: string
}

/**
 * Action: publishChapter
 * Make chapter available to readers based on access rules
 */
export async function publishChapter(
  params: {
    chapterId: string
    accessLevel?: 'public' | 'subscribers_only' | 'tier_specific'
    embargoUntil?: string
    previewParagraphs?: number
  },
  context: ActionContext,
  fastify: FastifyInstance
): Promise<ActionResult> {
  try {
    const { db } = await import('../../../apps/api/src/db/connection')
    const { entities, chapterPublications } = await import('../../../apps/api/src/db/schema')
    const { eq, and } = await import('drizzle-orm')

    const { chapterId, accessLevel = 'public', embargoUntil, previewParagraphs = 0 } = params

    // Get chapter
    const [chapter] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.id, chapterId), eq(entities.projectId, context.projectId)))
      .limit(1)

    if (!chapter) {
      return { success: false, error: 'Chapter not found' }
    }

    // Create or update chapter publication record
    const [publication] = await db
      .insert(chapterPublications)
      .values({
        chapterId,
        projectId: context.projectId,
        isPublished: true,
        publishedAt: new Date(),
        publicReleaseDate: embargoUntil ? new Date(embargoUntil) : new Date(),
        viewCount: '0'
      })
      .onConflictDoUpdate({
        target: chapterPublications.chapterId,
        set: {
          isPublished: true,
          publishedAt: new Date(),
          publicReleaseDate: embargoUntil ? new Date(embargoUntil) : new Date(),
          updatedAt: new Date()
        }
      })
      .returning()

    return {
      success: true,
      data: {
        publicationId: publication.id,
        publishedAt: publication.publishedAt,
        isPublished: publication.isPublished
      }
    }
  } catch (error) {
    fastify.log.error({ error }, 'publishChapter action failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Action: scheduleChapterRelease
 * Set future publish date with tier-based delays
 */
export async function scheduleChapterRelease(
  params: {
    chapterId: string
    releaseDate: string
    tierSchedule?: Array<{ tierId: string; delayDays: number }>
  },
  context: ActionContext,
  fastify: FastifyInstance
): Promise<ActionResult> {
  try {
    const { db } = await import('../../../apps/api/src/db/connection')
    const { chapterPublications, embargoSchedules } = await import('../../../apps/api/src/db/schema')
    const { eq } = await import('drizzle-orm')

    const { chapterId, releaseDate, tierSchedule = [] } = params

    // Create/update publication record with future date
    const [publication] = await db
      .insert(chapterPublications)
      .values({
        chapterId,
        projectId: context.projectId,
        isPublished: true,
        publishedAt: new Date(),
        publicReleaseDate: new Date(releaseDate),
        viewCount: '0'
      })
      .onConflictDoUpdate({
        target: chapterPublications.chapterId,
        set: {
          publicReleaseDate: new Date(releaseDate),
          updatedAt: new Date()
        }
      })
      .returning()

    // Create embargo schedules for each tier
    const embargoRecords = []
    for (const tier of tierSchedule) {
      const tierReleaseDate = new Date(releaseDate)
      tierReleaseDate.setDate(tierReleaseDate.getDate() + tier.delayDays)

      const [embargo] = await db
        .insert(embargoSchedules)
        .values({
          chapterId,
          tierId: tier.tierId,
          releaseDate: tierReleaseDate
        })
        .returning()

      embargoRecords.push(embargo)
    }

    return {
      success: true,
      data: {
        publicationId: publication.id,
        releaseDate: publication.publicReleaseDate,
        embargoCount: embargoRecords.length
      }
    }
  } catch (error) {
    fastify.log.error({ error }, 'scheduleChapterRelease action failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Action: unpublishChapter
 * Remove chapter from public view
 */
export async function unpublishChapter(
  params: {
    chapterId: string
  },
  context: ActionContext,
  fastify: FastifyInstance
): Promise<ActionResult> {
  try {
    const { db } = await import('../../../apps/api/src/db/connection')
    const { chapterPublications } = await import('../../../apps/api/src/db/schema')
    const { eq, and } = await import('drizzle-orm')

    const { chapterId } = params

    // Update publication record
    await db
      .update(chapterPublications)
      .set({
        isPublished: false,
        updatedAt: new Date()
      })
      .where(and(
        eq(chapterPublications.chapterId, chapterId),
        eq(chapterPublications.projectId, context.projectId)
      ))

    return {
      success: true,
      data: { chapterId, isPublished: false }
    }
  } catch (error) {
    fastify.log.error({ error }, 'unpublishChapter action failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Action: trackChapterView
 * Record analytics for chapter view
 */
export async function trackChapterView(
  params: {
    chapterId: string
    sessionId?: string
    deviceType?: string
    referrer?: string
  },
  context: ActionContext,
  fastify: FastifyInstance
): Promise<ActionResult> {
  try {
    const { db } = await import('../../../apps/api/src/db/connection')
    const { chapterViews, chapterPublications } = await import('../../../apps/api/src/db/schema')
    const { eq, sql } = await import('drizzle-orm')
    const { randomUUID } = await import('crypto')

    const { chapterId, sessionId, deviceType, referrer } = params

    // Track view
    const [view] = await db
      .insert(chapterViews)
      .values({
        chapterId,
        readerId: context.userId || null,
        sessionId: sessionId || randomUUID(),
        deviceType,
        referrer,
        readTimeSeconds: '0',
        lastPositionPercent: '0'
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

    return {
      success: true,
      data: { viewId: view.id }
    }
  } catch (error) {
    fastify.log.error({ error }, 'trackChapterView action failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Action: updateReaderProgress
 * Save reader's current position
 */
export async function updateReaderProgress(
  params: {
    chapterId: string
    positionPercent: number
    completed?: boolean
    readTimeSeconds?: number
  },
  context: ActionContext,
  fastify: FastifyInstance
): Promise<ActionResult> {
  try {
    const { db } = await import('../../../apps/api/src/db/connection')
    const { chapterViews } = await import('../../../apps/api/src/db/schema')
    const { eq, and, desc } = await import('drizzle-orm')

    const { chapterId, positionPercent, completed = false, readTimeSeconds = 0 } = params

    if (!context.userId) {
      return { success: false, error: 'User ID required for progress tracking' }
    }

    // Find most recent view for this user and chapter
    const [existingView] = await db
      .select()
      .from(chapterViews)
      .where(and(
        eq(chapterViews.chapterId, chapterId),
        eq(chapterViews.readerId, context.userId)
      ))
      .orderBy(desc(chapterViews.viewedAt))
      .limit(1)

    if (existingView) {
      // Update existing view
      await db
        .update(chapterViews)
        .set({
          lastPositionPercent: String(positionPercent),
          readTimeSeconds: String(readTimeSeconds),
          viewedAt: new Date() // Update timestamp
        })
        .where(eq(chapterViews.id, existingView.id))
    }

    return {
      success: true,
      data: {
        chapterId,
        positionPercent,
        completed
      }
    }
  } catch (error) {
    fastify.log.error({ error }, 'updateReaderProgress action failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Action: checkReaderAccess
 * Determine if reader can access chapter
 */
export async function checkReaderAccess(
  params: {
    chapterId: string
  },
  context: ActionContext,
  fastify: FastifyInstance
): Promise<ActionResult> {
  try {
    const { db } = await import('../../../apps/api/src/db/connection')
    const {
      chapterPublications,
      betaReaders,
      accessGrants,
      subscriptions
    } = await import('../../../apps/api/src/db/schema')
    const { eq, and, or, isNull } = await import('drizzle-orm')

    const { chapterId } = params

    // Get chapter publication info
    const [chapterPub] = await db
      .select()
      .from(chapterPublications)
      .where(eq(chapterPublications.chapterId, chapterId))
      .limit(1)

    if (!chapterPub || !chapterPub.isPublished) {
      return {
        success: true,
        data: { canAccess: false, reason: 'Chapter not published' }
      }
    }

    // Check if user is beta reader
    if (context.userId) {
      const [betaReader] = await db
        .select()
        .from(betaReaders)
        .where(and(
          eq(betaReaders.projectId, context.projectId),
          eq(betaReaders.userId, context.userId),
          eq(betaReaders.isActive, true)
        ))
        .limit(1)

      if (betaReader) {
        return { success: true, data: { canAccess: true, reason: 'Beta reader' } }
      }

      // Check for access grants
      const [grant] = await db
        .select()
        .from(accessGrants)
        .where(and(
          eq(accessGrants.projectId, context.projectId),
          eq(accessGrants.userId, context.userId),
          or(
            eq(accessGrants.chapterId, chapterId),
            isNull(accessGrants.chapterId)
          ),
          eq(accessGrants.isActive, true)
        ))
        .limit(1)

      if (grant) {
        return { success: true, data: { canAccess: true, reason: 'Access grant' } }
      }
    }

    // Check embargo
    if (chapterPub.publicReleaseDate) {
      const now = new Date()
      if (chapterPub.publicReleaseDate > now) {
        return {
          success: true,
          data: {
            canAccess: false,
            reason: 'Chapter embargoed',
            embargoUntil: chapterPub.publicReleaseDate
          }
        }
      }
    }

    // Public access
    return { success: true, data: { canAccess: true, reason: 'Public' } }
  } catch (error) {
    fastify.log.error({ error }, 'checkReaderAccess action failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Action: exportAnalyticsData
 * Generate CSV/JSON export of analytics
 */
export async function exportAnalyticsData(
  params: {
    format?: 'csv' | 'json'
    startDate?: string
    endDate?: string
  },
  context: ActionContext,
  fastify: FastifyInstance
): Promise<ActionResult> {
  try {
    const { db } = await import('../../../apps/api/src/db/connection')
    const { chapterPublications, chapterViews } = await import('../../../apps/api/src/db/schema')
    const { eq, and, gte, lte, sql } = await import('drizzle-orm')

    const { format = 'json', startDate, endDate } = params

    // Get analytics data
    const stats = await db
      .select({
        chapterId: chapterPublications.chapterId,
        title: sql<string>`(SELECT data->>'title' FROM entities WHERE id = ${chapterPublications.chapterId})`,
        viewCount: chapterPublications.viewCount,
        publishedAt: chapterPublications.publishedAt
      })
      .from(chapterPublications)
      .where(and(
        eq(chapterPublications.projectId, context.projectId),
        eq(chapterPublications.isPublished, true)
      ))

    if (format === 'csv') {
      // Convert to CSV
      const headers = 'Chapter ID,Title,View Count,Published At\n'
      const rows = stats.map(s =>
        `${s.chapterId},"${s.title}",${s.viewCount},${s.publishedAt?.toISOString() || ''}`
      ).join('\n')

      return {
        success: true,
        data: {
          format: 'csv',
          content: headers + rows
        }
      }
    } else {
      return {
        success: true,
        data: {
          format: 'json',
          content: stats
        }
      }
    }
  } catch (error) {
    fastify.log.error({ error }, 'exportAnalyticsData action failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Action: sendSubscriberAnnouncement
 * Email all subscribers in a tier
 */
export async function sendSubscriberAnnouncement(
  params: {
    tierId?: string
    subject: string
    message: string
  },
  context: ActionContext,
  fastify: FastifyInstance
): Promise<ActionResult> {
  try {
    const { db } = await import('../../../apps/api/src/db/connection')
    const { subscriptions, users } = await import('../../../apps/api/src/db/schema')
    const { eq, and } = await import('drizzle-orm')

    const { tierId, subject, message } = params

    // Get subscribers
    let query = db
      .select({
        userId: subscriptions.userId,
        email: users.email
      })
      .from(subscriptions)
      .innerJoin(users, eq(users.id, subscriptions.userId))
      .where(and(
        eq(subscriptions.projectId, context.projectId),
        eq(subscriptions.status, 'active')
      ))

    if (tierId) {
      query = query.where(eq(subscriptions.tierId, tierId)) as any
    }

    const subscribers = await query

    // TODO: Implement actual email sending
    // For now, just log the intent
    fastify.log.info({
      subscriberCount: subscribers.length,
      subject,
      tierId: tierId || 'all'
    }, 'Announcement prepared (email sending not implemented)')

    return {
      success: true,
      data: {
        recipientCount: subscribers.length,
        message: 'Announcement queued (email sending not implemented)'
      }
    }
  } catch (error) {
    fastify.log.error({ error }, 'sendSubscriberAnnouncement action failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Action registry - maps action IDs from manifest to handler functions
export const actions = {
  publish_chapter: publishChapter,
  schedule_release: scheduleChapterRelease,
  unpublish_chapter: unpublishChapter,
  track_view: trackChapterView,
  update_reading_progress: updateReaderProgress,
  check_access: checkReaderAccess,
  export_analytics: exportAnalyticsData,
  send_announcement: sendSubscriberAnnouncement
}

export type ActionHandler = (
  params: any,
  context: ActionContext,
  fastify: FastifyInstance
) => Promise<ActionResult>
