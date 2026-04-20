/**
 * Public Reader API
 *
 * Provides public-facing endpoints for anonymous readers to access published content.
 * Respects access control, embargo schedules, and subscription tiers.
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import {
  chapterPublications,
  chapterViews,
  entities,
  betaReaders,
  accessGrants,
  projects,
  projectCollections,
  projectCollectionMemberships,
  projectPublishConfig,
  subscriptions,
  subscriptionTiers,
  userProfiles,
  users,
  comments,
  reactions,
  chapterAnnotations,
  rssFeedTokens
} from '../db/schema'
import { eq, and, desc, asc, sql, isNull, or, count, inArray } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { env } from '../lib/env'
import { optionalAuth, requireAuth, requireProjectOwnership } from '../middleware/auth'
import { hashRssToken } from './rss-tokens'
import {
  getEffectiveBobbins,
  getCollectionIdsForProject,
  buildScopeCondition,
} from '../lib/effective-bobbins'

// ============================================
// AUTHOR RESOLUTION
// ============================================

interface ResolvedAuthor {
  userId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  bio: string | null
  userName: string | null
}

/** Resolve a public author by username or user ID (3-step fallback). */
async function resolveAuthor(identifier: string): Promise<ResolvedAuthor | null> {
  // 1. Try by username
  let [author] = await db
    .select({
      userId: userProfiles.userId,
      username: userProfiles.username,
      displayName: userProfiles.displayName,
      avatarUrl: userProfiles.avatarUrl,
      bio: userProfiles.bio,
      userName: users.name,
    })
    .from(userProfiles)
    .innerJoin(users, eq(users.id, userProfiles.userId))
    .where(eq(userProfiles.username, identifier))
    .limit(1)

  // 2. Try as a user ID
  if (!author) {
    [author] = await db
      .select({
        userId: userProfiles.userId,
        username: userProfiles.username,
        displayName: userProfiles.displayName,
        avatarUrl: userProfiles.avatarUrl,
        bio: userProfiles.bio,
        userName: users.name,
      })
      .from(userProfiles)
      .innerJoin(users, eq(users.id, userProfiles.userId))
      .where(eq(userProfiles.userId, identifier))
      .limit(1)
  }

  // 3. Last resort: users table directly (no profile created yet)
  if (!author) {
    const [user] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, identifier))
      .limit(1)
    if (user) {
      return { userId: user.id, username: null, displayName: null, avatarUrl: null, bio: null, userName: user.name }
    }
  }

  return author ?? null
}

// ============================================
// ACCESS CONTROL
// ============================================

interface AccessCheckResult {
  canAccess: boolean
  reason?: string
  embargoUntil?: Date
}

async function checkPublicChapterAccess(
  chapterId: string,
  projectId: string,
  userId?: string,
  defaultVisibility?: string
): Promise<AccessCheckResult> {
  // Get chapter publication info
  const [chapterPub] = await db
    .select()
    .from(chapterPublications)
    .where(eq(chapterPublications.chapterId, chapterId))
    .limit(1)

  if (!chapterPub || !chapterPub.isPublished) {
    return { canAccess: false, reason: 'Chapter not published' }
  }

  // Check if user is a beta reader (early access)
  if (userId) {
    const [betaReader] = await db
      .select()
      .from(betaReaders)
      .where(and(
        or(eq(betaReaders.projectId, projectId), isNull(betaReaders.projectId)),
        eq(betaReaders.readerId, userId),
        eq(betaReaders.isActive, true)
      ))
      .limit(1)

    if (betaReader) {
      return { canAccess: true }
    }

    // Check for explicit access grants
    const [grant] = await db
      .select()
      .from(accessGrants)
      .where(and(
        or(eq(accessGrants.projectId, projectId), isNull(accessGrants.projectId)),
        eq(accessGrants.grantedTo, userId),
        or(
          eq(accessGrants.chapterId, chapterId),
          isNull(accessGrants.chapterId)
        ),
        eq(accessGrants.isActive, true)
      ))
      .limit(1)

    if (grant) {
      return { canAccess: true }
    }

    // Check subscription tier-based access
    // Find the project owner to look up subscription
    const [project] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    if (project) {
      // Project owner always has full access to their own chapters
      if (project.ownerId === userId) {
        return { canAccess: true }
      }

      const [sub] = await db
        .select({
          tierId: subscriptions.tierId,
          status: subscriptions.status,
          earlyAccessDays: subscriptionTiers.earlyAccessDays
        })
        .from(subscriptions)
        .innerJoin(subscriptionTiers, eq(subscriptionTiers.id, subscriptions.tierId))
        .where(and(
          eq(subscriptions.subscriberId, userId),
          eq(subscriptions.authorId, project.ownerId),
          eq(subscriptions.status, 'active'),
          sql`${subscriptions.currentPeriodEnd} > NOW()`
        ))
        .limit(1)

      if (sub) {
        // Subscriber: can access chapters earlyAccessDays before the public release
        if (chapterPub.publishedAt) {
          const earlyMs = (sub.earlyAccessDays ?? 0) * 24 * 60 * 60 * 1000
          const accessDate = new Date(chapterPub.publishedAt.getTime() - earlyMs)
          const now = new Date()
          if (now >= accessDate) {
            return { canAccess: true }
          } else {
            return {
              canAccess: false,
              reason: 'Chapter not yet available for your tier',
              embargoUntil: accessDate
            }
          }
        }
        // Published but no date? Grant access
        return { canAccess: true }
      }
    }
  }

  // Project-level subscriber-only restriction
  if (defaultVisibility === 'subscribers_only') {
    return { canAccess: false, reason: 'Subscription required' }
  }

  // Check embargo (public release date) for free/anonymous users
  if (chapterPub.publicReleaseDate) {
    const now = new Date()
    if (chapterPub.publicReleaseDate > now) {
      return {
        canAccess: false,
        reason: 'Chapter embargoed',
        embargoUntil: chapterPub.publicReleaseDate
      }
    }
  }

  // Public chapter - anyone can access
  return { canAccess: true }
}

/**
 * Batch version of checkPublicChapterAccess.
 * Pre-loads all access data in 3-4 queries total (instead of 3-5 per chapter),
 * then resolves access in memory.
 */
async function checkMultipleChaptersAccess(
  chapters: { chapterId: string; publishedAt: Date | null; publicReleaseDate: Date | null }[],
  projectId: string,
  userId: string | undefined,
  defaultVisibility: string | undefined
): Promise<Map<string, AccessCheckResult>> {
  const results = new Map<string, AccessCheckResult>()
  if (chapters.length === 0) return results

  const chapterIds = chapters.map(c => c.chapterId)
  const now = new Date()

  // Build lookup maps for user-specific access (if userId provided)
  let accessGrantMap = new Map<string, boolean>() // chapterId -> has grant (or project-wide grant)
  let hasProjectWideGrant = false
  let isOwner = false
  let subscription: { earlyAccessDays: number | null } | null = null

  if (userId) {
    // Query 1: Beta readers for this project + user
    const [betaReaderRow] = await db
      .select({ readerId: betaReaders.readerId })
      .from(betaReaders)
      .where(and(
        or(eq(betaReaders.projectId, projectId), isNull(betaReaders.projectId)),
        eq(betaReaders.readerId, userId),
        eq(betaReaders.isActive, true)
      ))
      .limit(1)

    if (betaReaderRow) {
      // Beta reader has access to all chapters
      for (const ch of chapters) {
        results.set(ch.chapterId, { canAccess: true })
      }
      return results
    }

    // Query 2: Access grants for this project + user (chapter-specific and project-wide)
    const grants = await db
      .select({ chapterId: accessGrants.chapterId })
      .from(accessGrants)
      .where(and(
        or(eq(accessGrants.projectId, projectId), isNull(accessGrants.projectId)),
        eq(accessGrants.grantedTo, userId),
        eq(accessGrants.isActive, true),
        or(
          inArray(accessGrants.chapterId, chapterIds),
          isNull(accessGrants.chapterId)
        )
      ))

    for (const g of grants) {
      if (g.chapterId === null) {
        hasProjectWideGrant = true
      } else {
        accessGrantMap.set(g.chapterId, true)
      }
    }

    if (hasProjectWideGrant) {
      for (const ch of chapters) {
        results.set(ch.chapterId, { canAccess: true })
      }
      return results
    }

    // Query 3: Project owner + subscription
    const [project] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    if (project) {
      if (project.ownerId === userId) {
        isOwner = true
      } else {
        // Query 4: Active subscription for this user -> project owner
        const [sub] = await db
          .select({
            earlyAccessDays: subscriptionTiers.earlyAccessDays
          })
          .from(subscriptions)
          .innerJoin(subscriptionTiers, eq(subscriptionTiers.id, subscriptions.tierId))
          .where(and(
            eq(subscriptions.subscriberId, userId),
            eq(subscriptions.authorId, project.ownerId),
            eq(subscriptions.status, 'active'),
            sql`${subscriptions.currentPeriodEnd} > NOW()`
          ))
          .limit(1)

        if (sub) {
          subscription = sub
        }
      }
    }
  }

  // Resolve access per chapter in memory
  for (const ch of chapters) {
    // Owner always has access
    if (isOwner) {
      results.set(ch.chapterId, { canAccess: true })
      continue
    }

    // Chapter-specific access grant
    if (accessGrantMap.has(ch.chapterId)) {
      results.set(ch.chapterId, { canAccess: true })
      continue
    }

    // Subscription tier-based access
    if (subscription) {
      if (ch.publishedAt) {
        const earlyMs = (subscription.earlyAccessDays ?? 0) * 24 * 60 * 60 * 1000
        const accessDate = new Date(ch.publishedAt.getTime() - earlyMs)
        if (now >= accessDate) {
          results.set(ch.chapterId, { canAccess: true })
          continue
        } else {
          results.set(ch.chapterId, {
            canAccess: false,
            reason: 'Chapter not yet available for your tier',
            embargoUntil: accessDate
          })
          continue
        }
      }
      // Published but no date? Grant access
      results.set(ch.chapterId, { canAccess: true })
      continue
    }

    // Project-level subscriber-only restriction
    if (defaultVisibility === 'subscribers_only') {
      results.set(ch.chapterId, { canAccess: false, reason: 'Subscription required' })
      continue
    }

    // Embargo for free/anonymous users
    if (ch.publicReleaseDate) {
      if (ch.publicReleaseDate > now) {
        results.set(ch.chapterId, {
          canAccess: false,
          reason: 'Chapter embargoed',
          embargoUntil: ch.publicReleaseDate
        })
        continue
      }
    }

    // Public chapter - anyone can access
    results.set(ch.chapterId, { canAccess: true })
  }

  return results
}

/**
 * Check whether a user can leave annotations on a project's chapters.
 * Annotations must be enabled via projectPublishConfig (like comments/reactions),
 * then annotationAccess controls who can annotate.
 */
async function canUserAnnotate(
  userId: string,
  projectId: string
): Promise<boolean> {
  const [config] = await db
    .select({
      enableAnnotations: projectPublishConfig.enableAnnotations,
      annotationAccess: projectPublishConfig.annotationAccess
    })
    .from(projectPublishConfig)
    .where(eq(projectPublishConfig.projectId, projectId))
    .limit(1)

  if (!config || !config.enableAnnotations) return false

  const access = config.annotationAccess ?? 'beta_only'

  if (access === 'all_authenticated') return true

  // Check beta reader status
  const [betaReader] = await db
    .select({ id: betaReaders.id })
    .from(betaReaders)
    .where(and(
      or(eq(betaReaders.projectId, projectId), isNull(betaReaders.projectId)),
      eq(betaReaders.readerId, userId),
      eq(betaReaders.isActive, true)
    ))
    .limit(1)

  if (betaReader) return true

  if (access === 'subscribers') {
    // Check active subscription to the project owner
    const [project] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    if (project) {
      const [sub] = await db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(and(
          eq(subscriptions.subscriberId, userId),
          eq(subscriptions.authorId, project.ownerId),
          eq(subscriptions.status, 'active'),
          sql`${subscriptions.currentPeriodEnd} > NOW()`
        ))
        .limit(1)

      if (sub) return true
    }
  }

  return false
}

const readerPlugin: FastifyPluginAsync = async (fastify) => {
  // ============================================
  // PUBLIC READER ENDPOINTS
  // ============================================

  /**
   * Get table of contents for a project
   * Lists all publicly accessible chapters
   */
  fastify.get<{
    Params: { projectId: string }
    Querystring: {
      userId?: string
    }
  }>('/public/projects/:projectId/toc', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params
      const { userId } = request.query

      // Get project visibility setting
      const [publishConfig] = await db
        .select({ defaultVisibility: projectPublishConfig.defaultVisibility })
        .from(projectPublishConfig)
        .where(eq(projectPublishConfig.projectId, projectId))
        .limit(1)
      const defaultVisibility = publishConfig?.defaultVisibility || 'public'

      // Get all published chapters for this project
      const publishedChapters = await db
        .select({
          chapterId: chapterPublications.chapterId,
          title: sql<string>`(${entities.entityData}->>'title')`,
          publishedAt: chapterPublications.publishedAt,
          publicReleaseDate: chapterPublications.publicReleaseDate,
          viewCount: chapterPublications.viewCount,
          order: sql<number>`COALESCE((${entities.entityData}->>'order')::bigint, 0)`
        })
        .from(chapterPublications)
        .innerJoin(entities, eq(entities.id, chapterPublications.chapterId))
        .where(and(
          eq(chapterPublications.projectId, projectId),
          eq(chapterPublications.isPublished, true)
        ))
        .orderBy(sql`COALESCE((${entities.entityData}->>'order')::bigint, 0)`)

      // Batch access check: 3-4 queries total instead of 3-5 per chapter
      const accessMap = await checkMultipleChaptersAccess(
        publishedChapters.map(ch => ({
          chapterId: ch.chapterId,
          publishedAt: ch.publishedAt,
          publicReleaseDate: ch.publicReleaseDate
        })),
        projectId,
        userId,
        defaultVisibility
      )

      const accessibleChapters = publishedChapters.map(chapter => {
        const access = accessMap.get(chapter.chapterId) ?? { canAccess: true }
        if (access.canAccess) {
          return {
            id: chapter.chapterId,
            title: chapter.title,
            publishedAt: chapter.publishedAt,
            viewCount: chapter.viewCount,
            order: chapter.order
          }
        } else {
          return {
            id: chapter.chapterId,
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
    Querystring: {
      userId?: string
    }
  }>('/public/projects/:projectId/chapters/:chapterId', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, chapterId } = request.params
      const { userId } = request.query

      // Get project visibility setting
      const [chapterPublishConfig] = await db
        .select({ defaultVisibility: projectPublishConfig.defaultVisibility })
        .from(projectPublishConfig)
        .where(eq(projectPublishConfig.projectId, projectId))
        .limit(1)

      // Check access
      const access = await checkPublicChapterAccess(chapterId, projectId, userId, chapterPublishConfig?.defaultVisibility || 'public')
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
          order: sql<number>`COALESCE((${entities.entityData}->>'order')::bigint, 0)`
        })
        .from(entities)
        .innerJoin(chapterPublications, and(
          eq(chapterPublications.chapterId, entities.id),
          eq(chapterPublications.isPublished, true)
        ))
        .where(and(
          eq(entities.id, chapterId),
          eq(entities.projectId, projectId)
        ))
        .limit(1)

      if (!chapter) {
        return reply.status(404).send({ error: 'Chapter not found', correlationId })
      }

      // Get navigation (previous/next chapters)
      const allChapters = await db
        .select({
          id: entities.id,
          order: sql<number>`COALESCE((${entities.entityData}->>'order')::bigint, 0)`
        })
        .from(entities)
        .innerJoin(chapterPublications, eq(chapterPublications.chapterId, entities.id))
        .where(and(
          eq(entities.projectId, projectId),
          eq(chapterPublications.isPublished, true)
        ))
        .orderBy(sql`COALESCE((${entities.entityData}->>'order')::bigint, 0)`)

      const currentIndex = allChapters.findIndex(c => c.id === chapterId)
      const previousChapter = currentIndex > 0 ? allChapters[currentIndex - 1] : null
      const nextChapter = currentIndex < allChapters.length - 1 ? allChapters[currentIndex + 1] : null

      return reply.send({
        chapter: {
          id: chapter.id,
          title: chapter.title,
          content: chapter.content,
          publishedAt: chapter.publishedAt,
          viewCount: chapter.viewCount
        },
        navigation: {
          previous: previousChapter?.id || null,
          next: nextChapter?.id || null
        },
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
      userId?: string
      sessionId?: string
      deviceType?: string
      referrer?: string
      readTime?: number
      position?: number
    }
  }>('/public/projects/:projectId/chapters/:chapterId/view', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { chapterId } = request.params
      const { userId, sessionId, deviceType, referrer, readTime, position } = request.body

      let viewId: string
      let isNewView = false

      // For authenticated users, upsert on (readerId, chapterId) to prevent duplicate rows
      if (userId) {
        const [existing] = await db
          .select({ id: chapterViews.id })
          .from(chapterViews)
          .where(and(
            eq(chapterViews.readerId, userId),
            eq(chapterViews.chapterId, chapterId)
          ))
          .limit(1)

        if (existing) {
          // Update existing view record
          const updates: Record<string, any> = {}
          if (position !== undefined) updates.lastPositionPercent = Number(position)
          if (readTime !== undefined) updates.readTimeSeconds = sql`${chapterViews.readTimeSeconds} + ${Number(readTime)}`
          if (deviceType) updates.deviceType = deviceType

          // Mark as completed if position is >= 95%
          if (position !== undefined && Number(position) >= 95) {
            updates.completedAt = new Date()
          }

          if (Object.keys(updates).length > 0) {
            await db
              .update(chapterViews)
              .set(updates)
              .where(eq(chapterViews.id, existing.id))
          }
          viewId = existing.id
        } else {
          // Create new view record for this reader+chapter pair
          const [view] = await db
            .insert(chapterViews)
            .values({
              chapterId,
              readerId: userId,
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
      } else {
        // Anonymous users: always create a new view (tracked by session)
        const [view] = await db
          .insert(chapterViews)
          .values({
            chapterId,
            readerId: null,
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
  }>('/public/projects/:projectId/stats', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params

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

  // ============================================
  // SEO & METADATA ENDPOINTS
  // ============================================

  /**
   * Get SEO metadata for a project
   * Returns Open Graph, Twitter Card, and structured data
   */
  fastify.get<{
    Params: { projectId: string }
  }>('/public/projects/:projectId/metadata', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params

      // Project info — projects live in `projects`, not `entities`.
      const [project] = await db
        .select({
          name: projects.name,
          description: projects.description,
          coverImage: projects.coverImage,
          ownerName: users.name,
        })
        .from(projects)
        .leftJoin(users, eq(projects.ownerId, users.id))
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1)

      if (!project) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }

      const projectData = {
        title: project.name,
        description: project.description,
        author: project.ownerName,
        coverImage: project.coverImage,
      }
      const baseUrl = env.WEB_ORIGIN

      // Get stats
      const stats = await db
        .select({
          totalChapters: sql<number>`COUNT(DISTINCT ${chapterPublications.chapterId})`,
          totalViews: sql<number>`SUM(CAST(${chapterPublications.viewCount} AS INTEGER))`
        })
        .from(chapterPublications)
        .where(and(
          eq(chapterPublications.projectId, projectId),
          eq(chapterPublications.isPublished, true)
        ))

      const metadata = {
        // Basic metadata
        title: projectData.title || 'Untitled Project',
        description: projectData.description || '',
        author: projectData.author || 'Unknown Author',

        // Open Graph
        openGraph: {
          type: 'website',
          title: projectData.title || 'Untitled Project',
          description: projectData.description || '',
          url: `${baseUrl}/projects/${projectId}`,
          image: projectData.coverImage || `${baseUrl}/default-cover.jpg`,
          siteName: 'Bobbinry'
        },

        // Twitter Card
        twitter: {
          card: 'summary_large_image',
          title: projectData.title || 'Untitled Project',
          description: projectData.description || '',
          image: projectData.coverImage || `${baseUrl}/default-cover.jpg`,
          creator: ''
        },

        // Structured Data (JSON-LD)
        structuredData: {
          '@context': 'https://schema.org',
          '@type': 'Book',
          name: projectData.title || 'Untitled Project',
          author: {
            '@type': 'Person',
            name: projectData.author || 'Unknown Author'
          },
          description: projectData.description || '',
          numberOfPages: stats[0]?.totalChapters || 0,
          interactionStatistic: {
            '@type': 'InteractionCounter',
            interactionType: 'https://schema.org/ReadAction',
            userInteractionCount: stats[0]?.totalViews || 0
          }
        },

        // Additional
        canonical: `${baseUrl}/projects/${projectId}`,
        stats: stats[0]
      }

      return reply.send({ metadata, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get metadata')
      return reply.status(500).send({ error: 'Failed to get metadata', correlationId })
    }
  })

  /**
   * Get SEO metadata for a specific chapter
   */
  fastify.get<{
    Params: { projectId: string; chapterId: string }
  }>('/public/projects/:projectId/chapters/:chapterId/metadata', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, chapterId } = request.params

      // Get chapter and project
      const [chapter] = await db
        .select({
          id: entities.id,
          title: sql<string>`(${entities.entityData}->>'title')`,
          content: sql<string>`(${entities.entityData}->>'body')`,
          publishedAt: chapterPublications.publishedAt,
          viewCount: chapterPublications.viewCount
        })
        .from(entities)
        .innerJoin(chapterPublications, eq(chapterPublications.chapterId, entities.id))
        .where(and(
          eq(entities.id, chapterId),
          eq(entities.projectId, projectId),
          eq(chapterPublications.isPublished, true)
        ))
        .limit(1)

      if (!chapter) {
        return reply.status(404).send({ error: 'Chapter not found', correlationId })
      }

      // Project info — projects live in `projects`, not `entities`.
      const [project] = await db
        .select({
          name: projects.name,
          coverImage: projects.coverImage,
          ownerName: users.name,
        })
        .from(projects)
        .leftJoin(users, eq(projects.ownerId, users.id))
        .where(eq(projects.id, projectId))
        .limit(1)

      const projectData = project
        ? { title: project.name, coverImage: project.coverImage, author: project.ownerName }
        : null
      const baseUrl = env.WEB_ORIGIN

      // Generate excerpt from content
      const excerpt = (chapter.content || '').substring(0, 200).replace(/\n/g, ' ') + '...'

      const metadata = {
        title: `${chapter.title} - ${projectData?.title || 'Untitled Project'}`,
        description: excerpt,

        openGraph: {
          type: 'article',
          title: chapter.title,
          description: excerpt,
          url: `${baseUrl}/projects/${projectId}/chapters/${chapterId}`,
          image: projectData?.coverImage || `${baseUrl}/default-cover.jpg`,
          siteName: 'Bobbinry',
          publishedTime: chapter.publishedAt?.toISOString(),
          author: projectData?.author || 'Unknown Author'
        },

        twitter: {
          card: 'summary',
          title: chapter.title,
          description: excerpt,
          image: projectData?.coverImage || `${baseUrl}/default-cover.jpg`
        },

        structuredData: {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: chapter.title,
          description: excerpt,
          author: {
            '@type': 'Person',
            name: projectData?.author || 'Unknown Author'
          },
          datePublished: chapter.publishedAt?.toISOString(),
          isPartOf: {
            '@type': 'Book',
            name: projectData?.title || 'Untitled Project'
          }
        },

        canonical: `${baseUrl}/projects/${projectId}/chapters/${chapterId}`
      }

      return reply.send({ metadata, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get chapter metadata')
      return reply.status(500).send({ error: 'Failed to get chapter metadata', correlationId })
    }
  })

  /**
   * Generate XML sitemap for a project
   */
  fastify.get<{
    Params: { projectId: string }
  }>('/public/projects/:projectId/sitemap.xml', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params

      // Get all published chapters
      const chapters = await db
        .select({
          id: entities.id,
          publishedAt: chapterPublications.publishedAt,
          updatedAt: chapterPublications.updatedAt
        })
        .from(entities)
        .innerJoin(chapterPublications, eq(chapterPublications.chapterId, entities.id))
        .where(and(
          eq(entities.projectId, projectId),
          eq(chapterPublications.isPublished, true)
        ))
        .orderBy(sql`COALESCE((${entities.entityData}->>'order')::bigint, 0)`)

      const baseUrl = env.WEB_ORIGIN

      // Build XML sitemap
      const urls = chapters.map(chapter => {
        const lastmod = (chapter.updatedAt || chapter.publishedAt)?.toISOString().split('T')[0]
        return `
  <url>
    <loc>${baseUrl}/projects/${projectId}/chapters/${chapter.id}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`
      }).join('')

      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/projects/${projectId}</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>${urls}
</urlset>`

      return reply
        .header('Content-Type', 'application/xml')
        .send(sitemap)
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to generate sitemap')
      return reply.status(500).send({ error: 'Failed to generate sitemap', correlationId })
    }
  })

  /**
   * Generate RSS feed for a project
   * Returns RSS 2.0 XML feed with recent chapter updates
   */
  fastify.get<{
    Params: { projectId: string }
    Querystring: {
      limit?: number
      reader?: string
    }
  }>('/public/projects/:projectId/feed.xml', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params
      const { limit = 20, reader: readerToken } = request.query

      // Get project info — projects live in `projects`, not `entities`.
      const [project] = await db
        .select({
          name: projects.name,
          description: projects.description,
          coverImage: projects.coverImage,
          ownerName: users.name,
        })
        .from(projects)
        .leftJoin(users, eq(projects.ownerId, users.id))
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1)

      if (!project) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }

      const projectData = {
        title: project.name,
        description: project.description,
        author: project.ownerName,
        coverImage: project.coverImage,
      }
      const baseUrl = env.WEB_ORIGIN

      // Optional `?reader=<rss-feed-token>` identifies a subscriber so their
      // feed includes early-access / subscriber-only chapters. Invalid tokens
      // silently fall back to the public-only view.
      let readerUserId: string | undefined
      if (readerToken) {
        const tokenHash = hashRssToken(readerToken)
        const [tokenRow] = await db
          .select({ userId: rssFeedTokens.userId, id: rssFeedTokens.id })
          .from(rssFeedTokens)
          .where(and(eq(rssFeedTokens.tokenHash, tokenHash), isNull(rssFeedTokens.revokedAt)))
          .limit(1)
        if (tokenRow) {
          readerUserId = tokenRow.userId
          // Fire-and-forget lastUsedAt update.
          db.update(rssFeedTokens)
            .set({ lastUsedAt: new Date() })
            .where(eq(rssFeedTokens.id, tokenRow.id))
            .catch(() => {})
        }
      }

      const [publishConfig] = await db
        .select({ defaultVisibility: projectPublishConfig.defaultVisibility })
        .from(projectPublishConfig)
        .where(eq(projectPublishConfig.projectId, projectId))
        .limit(1)

      // Pull every published chapter; the access helper decides what the caller
      // actually gets to see (owner / beta / grant / subscriber / public).
      const candidateChapters = await db
        .select({
          id: entities.id,
          title: sql<string>`(${entities.entityData}->>'title')`,
          content: sql<string>`(${entities.entityData}->>'body')`,
          publishedAt: chapterPublications.publishedAt,
          publicReleaseDate: chapterPublications.publicReleaseDate,
          updatedAt: chapterPublications.updatedAt
        })
        .from(entities)
        .innerJoin(chapterPublications, eq(chapterPublications.chapterId, entities.id))
        .where(and(
          eq(entities.projectId, projectId),
          eq(chapterPublications.isPublished, true)
        ))
        .orderBy(desc(chapterPublications.publishedAt))
        .limit(limit * 2) // over-fetch so filtering still has enough for `limit`

      const accessMap = await checkMultipleChaptersAccess(
        candidateChapters.map(c => ({
          chapterId: c.id,
          publishedAt: c.publishedAt,
          publicReleaseDate: c.publicReleaseDate,
        })),
        projectId,
        readerUserId,
        publishConfig?.defaultVisibility || 'public'
      )

      const chapters = candidateChapters
        .filter(c => accessMap.get(c.id)?.canAccess === true)
        .slice(0, limit)

      // Build RSS feed items
      const items = chapters.map(chapter => {
        const excerpt = (chapter.content || '').substring(0, 500).replace(/\n/g, ' ')
        const pubDate = (chapter.publishedAt || new Date()).toUTCString()
        const link = `${baseUrl}/projects/${projectId}/chapters/${chapter.id}`

        // Escape XML special characters
        const escapeXml = (str: string) =>
          str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;')

        return `
    <item>
      <title>${escapeXml(chapter.title || 'Untitled')}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(excerpt)}...</description>
      <author>${escapeXml(projectData.author || 'Unknown Author')}</author>
    </item>`
      }).join('')

      const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${projectData.title || 'Untitled Project'}</title>
    <link>${baseUrl}/projects/${projectId}</link>
    <description>${projectData.description || 'No description'}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${baseUrl}/projects/${projectId}/feed.xml" rel="self" type="application/rss+xml" />
    <image>
      <url>${projectData.coverImage || `${baseUrl}/default-cover.jpg`}</url>
      <title>${projectData.title || 'Untitled Project'}</title>
      <link>${baseUrl}/projects/${projectId}</link>
    </image>${items}
  </channel>
</rss>`

      return reply
        .header('Content-Type', 'application/rss+xml')
        .send(rss)
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to generate RSS feed')
      return reply.status(500).send({ error: 'Failed to generate RSS feed', correlationId })
    }
  })
  // ============================================
  // SLUG-BASED LOOKUP
  // ============================================

  /**
   * Resolve a project slug to project details (public)
   */
  fastify.get<{
    Params: { slug: string }
  }>('/public/projects/by-slug/:slug', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { slug } = request.params

      // Look up by shortUrl or slugPrefix in publish config (exclude trashed)
      const [project] = await db
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          coverImage: projects.coverImage,
          shortUrl: projects.shortUrl,
          ownerId: projects.ownerId,
          createdAt: projects.createdAt
        })
        .from(projects)
        .where(and(eq(projects.shortUrl, slug), isNull(projects.deletedAt)))
        .limit(1)

      if (!project) {
        // Try looking up by publish config slugPrefix
        const [configMatch] = await db
          .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            coverImage: projects.coverImage,
            shortUrl: projects.shortUrl,
            ownerId: projects.ownerId,
            createdAt: projects.createdAt
          })
          .from(projects)
          .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
          .where(and(eq(projectPublishConfig.slugPrefix, slug), isNull(projects.deletedAt)))
          .limit(1)

        if (!configMatch) {
          return reply.status(404).send({ error: 'Project not found', correlationId })
        }

        // Get author info
        const [author] = await db
          .select({
            userId: userProfiles.userId,
            username: userProfiles.username,
            displayName: userProfiles.displayName,
            avatarUrl: userProfiles.avatarUrl,
            userName: users.name
          })
          .from(userProfiles)
          .innerJoin(users, eq(users.id, userProfiles.userId))
          .where(eq(userProfiles.userId, configMatch.ownerId))
          .limit(1)

        return reply.send({ project: configMatch, author: author || null, correlationId })
      }

      // Get author info
      const [author] = await db
        .select({
          userId: userProfiles.userId,
          username: userProfiles.username,
          displayName: userProfiles.displayName,
          avatarUrl: userProfiles.avatarUrl,
          userName: users.name
        })
        .from(userProfiles)
        .innerJoin(users, eq(users.id, userProfiles.userId))
        .where(eq(userProfiles.userId, project.ownerId))
        .limit(1)

      return reply.send({ project, author: author || null, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to resolve project slug')
      return reply.status(500).send({ error: 'Failed to resolve project slug', correlationId })
    }
  })

  /**
   * Resolve many projects by short slug in one call (public).
   * POST /public/projects/by-slugs
   */
  fastify.post<{
    Body: { slugs?: string[] }
  }>('/public/projects/by-slugs', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const inputSlugs = request.body?.slugs || []
      const slugs = [...new Set(inputSlugs.map((slug) => slug.trim()).filter(Boolean))]

      if (slugs.length === 0) {
        return reply.send({ projects: [], correlationId })
      }
      if (slugs.length > 100) {
        return reply.status(400).send({ error: 'Maximum 100 slugs allowed', correlationId })
      }

      const projectRows = await db
        .select({
          shortUrl: projects.shortUrl,
          projectId: projects.id,
          ownerId: projects.ownerId,
          authorUsername: userProfiles.username,
          authorDisplayName: userProfiles.displayName,
          authorName: users.name
        })
        .from(projects)
        .leftJoin(userProfiles, eq(userProfiles.userId, projects.ownerId))
        .leftJoin(users, eq(users.id, projects.ownerId))
        .where(and(inArray(projects.shortUrl, slugs), isNull(projects.deletedAt)))

      const results = projectRows
        .filter((row) => Boolean(row.shortUrl))
        .map((row) => ({
          slug: row.shortUrl!,
          project: {
            id: row.projectId,
            ownerId: row.ownerId
          },
          author: {
            userId: row.ownerId,
            username: row.authorUsername || null,
            displayName: row.authorDisplayName || row.authorName || null
          }
        }))

      return reply.send({ projects: results, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to resolve projects by slugs')
      return reply.status(500).send({ error: 'Failed to resolve project slugs', correlationId })
    }
  })

  /**
   * Resolve a project by author identifier + project slug (public)
   * GET /public/projects/by-author-and-slug/:authorIdOrUsername/:projectSlug
   * The author identifier can be a username or a user UUID.
   */
  fastify.get<{
    Params: { username: string; projectSlug: string }
  }>('/public/projects/by-author-and-slug/:username/:projectSlug', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { username, projectSlug } = request.params

      const author = await resolveAuthor(username)
      if (!author) {
        return reply.status(404).send({ error: 'Author not found', correlationId })
      }

      // Find project by owner + shortUrl (exclude trashed)
      const [project] = await db
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          coverImage: projects.coverImage,
          shortUrl: projects.shortUrl,
          ownerId: projects.ownerId,
          createdAt: projects.createdAt
        })
        .from(projects)
        .where(and(
          eq(projects.ownerId, author.userId),
          eq(projects.shortUrl, projectSlug),
          isNull(projects.deletedAt)
        ))
        .limit(1)

      if (!project) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }

      // Get project visibility setting
      const [projPublishConfig] = await db
        .select({ defaultVisibility: projectPublishConfig.defaultVisibility })
        .from(projectPublishConfig)
        .where(eq(projectPublishConfig.projectId, project.id))
        .limit(1)

      // Look up qualifying collection (2+ published projects) for this project
      let collectionInfo: {
        id: string
        name: string
        description: string | null
        coverImage: string | null
        colorTheme: string | null
        publishedProjectCount: number
      } | null = null

      const [collMatch] = await db
        .select({
          id: projectCollections.id,
          name: projectCollections.name,
          description: projectCollections.description,
          coverImage: projectCollections.coverImage,
          colorTheme: projectCollections.colorTheme,
        })
        .from(projectCollectionMemberships)
        .innerJoin(projectCollections, eq(projectCollections.id, projectCollectionMemberships.collectionId))
        .where(and(
          eq(projectCollectionMemberships.projectId, project.id),
          isNull(projectCollections.deletedAt),
        ))
        .limit(1)

      if (collMatch) {
        const [publishedCount] = await db
          .select({ count: count() })
          .from(projectCollectionMemberships)
          .innerJoin(projects, eq(projects.id, projectCollectionMemberships.projectId))
          .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
          .where(and(
            eq(projectCollectionMemberships.collectionId, collMatch.id),
            isNull(projects.deletedAt),
            eq(projectPublishConfig.publishingMode, 'live'),
            sql`EXISTS (SELECT 1 FROM ${chapterPublications} WHERE ${chapterPublications.projectId} = ${projects.id} AND ${chapterPublications.isPublished} = true)`
          ))

        const pubCount = Number(publishedCount?.count ?? 0)
        if (pubCount >= 2) {
          collectionInfo = { ...collMatch, publishedProjectCount: pubCount }
        }
      }

      return reply.send({
        project: { ...project, defaultVisibility: projPublishConfig?.defaultVisibility || 'public' },
        author,
        collection: collectionInfo,
        correlationId
      })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to resolve project by author and slug')
      return reply.status(500).send({ error: 'Failed to resolve project', correlationId })
    }
  })

  /**
   * Get published projects for a given author (public)
   * GET /public/authors/:username/projects
   * The identifier can be a username or a user UUID.
   */
  fastify.get<{
    Params: { username: string }
  }>('/public/authors/:username/projects', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { username } = request.params

      const author = await resolveAuthor(username)
      if (!author) {
        return reply.status(404).send({ error: 'Author not found', correlationId })
      }

      // Get published projects (those with shortUrl and live publish config)
      const publishedProjects = await db
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          coverImage: projects.coverImage,
          shortUrl: projects.shortUrl,
          createdAt: projects.createdAt
        })
        .from(projects)
        .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
        .where(and(
          eq(projects.ownerId, author.userId),
          eq(projectPublishConfig.publishingMode, 'live'),
          sql`${projects.shortUrl} IS NOT NULL`,
          isNull(projects.deletedAt)
        ))
        .orderBy(desc(projects.createdAt))

      // Get collections that contain published projects (for grouping on author page)
      const publishedIds = publishedProjects.map(p => p.id)
      let collections: {
        id: string
        name: string
        description: string | null
        coverImage: string | null
        colorTheme: string | null
        projectIds: string[]
      }[] = []

      if (publishedIds.length > 0) {
        const memberships = await db
          .select({
            collectionId: projectCollectionMemberships.collectionId,
            projectId: projectCollectionMemberships.projectId,
            orderIndex: projectCollectionMemberships.orderIndex,
            name: projectCollections.name,
            description: projectCollections.description,
            coverImage: projectCollections.coverImage,
            colorTheme: projectCollections.colorTheme,
          })
          .from(projectCollectionMemberships)
          .innerJoin(projectCollections, eq(projectCollections.id, projectCollectionMemberships.collectionId))
          .where(and(
            inArray(projectCollectionMemberships.projectId, publishedIds),
            isNull(projectCollections.deletedAt),
          ))
          .orderBy(asc(projectCollectionMemberships.orderIndex))

        // Group by collection, only include those with 2+ published projects
        const collMap = new Map<string, typeof memberships>()
        for (const m of memberships) {
          const list = collMap.get(m.collectionId) || []
          list.push(m)
          collMap.set(m.collectionId, list)
        }

        for (const [collId, members] of collMap) {
          if (members.length >= 2) {
            const first = members[0]!
            collections.push({
              id: collId,
              name: first.name,
              description: first.description,
              coverImage: first.coverImage,
              colorTheme: first.colorTheme,
              projectIds: members.map(m => m.projectId),
            })
          }
        }
      }

      return reply.send({ author, projects: publishedProjects, collections, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get author projects')
      return reply.status(500).send({ error: 'Failed to get author projects', correlationId })
    }
  })

  // ============================================
  // COLLECTIONS (public reader)
  // ============================================

  /**
   * Get collection details and published projects for reader page
   * GET /public/collections/by-author/:username/:collectionId
   */
  fastify.get<{
    Params: { username: string; collectionId: string }
  }>('/public/collections/by-author/:username/:collectionId', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { username, collectionId } = request.params

      const author = await resolveAuthor(username)
      if (!author) {
        return reply.status(404).send({ error: 'Author not found', correlationId })
      }

      // Fetch collection owned by this author
      const [collection] = await db
        .select({
          id: projectCollections.id,
          name: projectCollections.name,
          description: projectCollections.description,
          coverImage: projectCollections.coverImage,
          colorTheme: projectCollections.colorTheme,
        })
        .from(projectCollections)
        .where(and(
          eq(projectCollections.id, collectionId),
          eq(projectCollections.userId, author.userId),
          isNull(projectCollections.deletedAt),
        ))
        .limit(1)

      if (!collection) {
        return reply.status(404).send({ error: 'Collection not found', correlationId })
      }

      // Fetch ordered published projects in this collection
      const publishedProjects = await db
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          coverImage: projects.coverImage,
          shortUrl: projects.shortUrl,
          createdAt: projects.createdAt,
          orderIndex: projectCollectionMemberships.orderIndex,
        })
        .from(projectCollectionMemberships)
        .innerJoin(projects, eq(projects.id, projectCollectionMemberships.projectId))
        .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
        .where(and(
          eq(projectCollectionMemberships.collectionId, collection.id),
          isNull(projects.deletedAt),
          eq(projectPublishConfig.publishingMode, 'live'),
          sql`EXISTS (SELECT 1 FROM ${chapterPublications} WHERE ${chapterPublications.projectId} = ${projects.id} AND ${chapterPublications.isPublished} = true)`
        ))
        .orderBy(asc(projectCollectionMemberships.orderIndex))

      // Only expose collection if it has 2+ published projects
      if (publishedProjects.length < 2) {
        return reply.status(404).send({ error: 'Collection not found', correlationId })
      }

      return reply.send({ collection, author, projects: publishedProjects, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get public collection')
      return reply.status(500).send({ error: 'Failed to get collection', correlationId })
    }
  })

  // ============================================
  // COMMENTS & REACTIONS
  // ============================================

  /**
   * Get comments for a chapter (public)
   */
  fastify.get<{
    Params: { chapterId: string }
    Querystring: { limit?: number; offset?: number }
  }>('/public/chapters/:chapterId/comments', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { chapterId } = request.params
      const { limit = 50, offset = 0 } = request.query

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
    const correlationId = randomUUID()
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
  }>('/public/chapters/:chapterId/reactions', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { chapterId } = request.params

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
    const correlationId = randomUUID()
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
    const correlationId = randomUUID()
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

  // ============================================
  // PUBLISHED ENTITIES (READER CODEX)
  // ============================================

  /**
   * Resolve the caller's effective subscription tier level against a project
   * owner. Owner → Infinity, active subscriber → their tier_level, otherwise 0.
   */
  async function resolveCallerTierLevel(projectId: string, callerId: string | undefined): Promise<number> {
    if (!callerId) return 0
    const [project] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    if (!project) return 0
    if (project.ownerId === callerId) return Number.POSITIVE_INFINITY

    const [sub] = await db
      .select({ tierLevel: subscriptionTiers.tierLevel })
      .from(subscriptions)
      .innerJoin(subscriptionTiers, eq(subscriptionTiers.id, subscriptions.tierId))
      .where(and(
        eq(subscriptions.subscriberId, callerId),
        eq(subscriptions.authorId, project.ownerId),
        eq(subscriptions.status, 'active'),
        sql`${subscriptions.currentPeriodEnd} > NOW()`
      ))
      .orderBy(sql`${subscriptionTiers.tierLevel} DESC`)
      .limit(1)

    return sub?.tierLevel ?? 0
  }

  /**
   * List published entities for the public reader, grouped by published type.
   * Gated by subscriber tier level when minimum_tier_level > 0.
   */
  fastify.get<{
    Params: { projectId: string }
  }>('/public/projects/:projectId/entities', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    try {
      const { projectId } = request.params

      // Confirm project exists and grab owner for bobbin-installed lookup
      const [project] = await db
        .select({ id: projects.id, ownerId: projects.ownerId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)

      if (!project) {
        return reply.status(404).send({ error: 'Project not found' })
      }

      const effective = await getEffectiveBobbins(projectId, project.ownerId)
      const entitiesInstalled = effective.find(b => b.bobbinId === 'entities' && b.enabled)
      if (!entitiesInstalled) {
        return { installed: false, callerTierLevel: 0, types: [], lockedPreviews: { types: 0, entities: 0 } }
      }

      const callerTier = await resolveCallerTierLevel(projectId, request.user?.id)
      const isOwner = callerTier === Number.POSITIVE_INFINITY

      // Resolve entity-visibility scope for this project: project, any
      // collections it belongs to, and the owner's global entities. This
      // mirrors buildScopeCondition() used by the author-side routes so
      // collection-scoped type defs + entities show on the reader too.
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, project.ownerId)

      // 1) Load all published type-definition rows visible from this project
      const typeRows = await db
        .select({
          id: entities.id,
          data: entities.entityData,
          isPublished: entities.isPublished,
          publishOrder: entities.publishOrder,
          minimumTierLevel: entities.minimumTierLevel,
        })
        .from(entities)
        .where(and(
          scopeFilter,
          eq(entities.collectionName, 'entity_type_definitions'),
          eq(entities.isPublished, true)
        ))
        .orderBy(asc(entities.publishOrder))

      const visibleTypes = typeRows.filter(t => isOwner || t.minimumTierLevel <= callerTier)
      const lockedTypes = typeRows.length - visibleTypes.length

      // 2) Load published entities for each visible type, tier-filtered
      let lockedEntityCount = 0
      const typeIds = visibleTypes
        .map(t => (t.data as Record<string, unknown>)?.type_id)
        .filter((v): v is string => typeof v === 'string')

      const entityRowsByType = new Map<string, typeof entities.$inferSelect[]>()
      if (typeIds.length > 0) {
        const entityRows = await db
          .select()
          .from(entities)
          .where(and(
            scopeFilter,
            inArray(entities.collectionName, typeIds),
            eq(entities.isPublished, true)
          ))
          .orderBy(asc(entities.publishOrder))

        for (const row of entityRows) {
          const list = entityRowsByType.get(row.collectionName) ?? []
          list.push(row)
          entityRowsByType.set(row.collectionName, list)
        }
      }

      const types = visibleTypes.map(t => {
        const typeData = t.data as Record<string, any>
        const typeId = typeData.type_id as string
        const rows = entityRowsByType.get(typeId) ?? []
        const visibleRows = isOwner ? rows : rows.filter(r => r.minimumTierLevel <= callerTier)
        lockedEntityCount += rows.length - visibleRows.length

        return {
          typeId,
          label: typeData.label,
          icon: typeData.icon ?? '📋',
          listLayout: typeData.list_layout,
          editorLayout: typeData.editor_layout,
          customFields: typeData.custom_fields ?? [],
          baseFields: typeData.base_fields ?? ['name', 'description', 'tags', 'image_url'],
          versionableBaseFields: typeData.versionable_base_fields ?? [],
          subtitleFields: typeData.subtitle_fields ?? [],
          variantAxis: typeData.variant_axis ?? null,
          minimumTierLevel: t.minimumTierLevel,
          publishOrder: t.publishOrder,
          entities: visibleRows.map(r => {
            const data = r.entityData as Record<string, unknown>
            return {
              id: r.id,
              typeId,
              name: data?.name ?? null,
              description: data?.description ?? null,
              imageUrl: data?.image_url ?? null,
              tags: Array.isArray(data?.tags) ? data.tags : [],
              entityData: data,
              publishOrder: r.publishOrder,
              minimumTierLevel: r.minimumTierLevel,
              publishedAt: r.publishedAt,
              publishBase: r.publishBase,
              publishedVariantIds: r.publishedVariantIds ?? [],
            }
          }),
        }
      })

      return {
        installed: true,
        callerTierLevel: isOwner ? -1 : callerTier,
        types,
        lockedPreviews: { types: lockedTypes, entities: lockedEntityCount },
      }
    } catch (error) {
      fastify.log.error(error, 'Failed to list published entities')
      return reply.status(500).send({ error: 'Failed to list published entities' })
    }
  })

  /**
   * Lightweight list of published entity names for the chapter-page highlighter.
   * Returns only { id, name, typeId, typeIcon, typeLabel } rows — matches the
   * EntityEntry shape in bobbins/manuscript/src/extensions/entity-highlight.ts.
   */
  fastify.get<{
    Params: { projectId: string }
  }>('/public/projects/:projectId/entities/published-names', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    try {
      const { projectId } = request.params

      const [project] = await db
        .select({ id: projects.id, ownerId: projects.ownerId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)
      if (!project) return reply.status(404).send({ error: 'Project not found' })

      const effective = await getEffectiveBobbins(projectId, project.ownerId)
      const installed = effective.find(b => b.bobbinId === 'entities' && b.enabled)
      if (!installed) return { installed: false, entities: [] }

      const callerTier = await resolveCallerTierLevel(projectId, request.user?.id)
      const isOwner = callerTier === Number.POSITIVE_INFINITY

      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, project.ownerId)

      const typeRows = await db
        .select({
          id: entities.id,
          data: entities.entityData,
          minimumTierLevel: entities.minimumTierLevel,
        })
        .from(entities)
        .where(and(
          scopeFilter,
          eq(entities.collectionName, 'entity_type_definitions'),
          eq(entities.isPublished, true),
        ))

      interface TypeMeta { label: string; icon: string; nameVersionable: boolean }
      const visibleTypeMeta = new Map<string, TypeMeta>()
      for (const t of typeRows) {
        if (!isOwner && t.minimumTierLevel > callerTier) continue
        const d = t.data as Record<string, any>
        if (typeof d?.type_id !== 'string') continue
        // Name is versionable if the type flags `name` in its versionable_base_fields,
        // or if a custom field named `name` is marked versionable (rare — handled
        // defensively).
        const versionableBase: string[] = Array.isArray(d.versionable_base_fields)
          ? d.versionable_base_fields
          : []
        const customFields: Array<{ name?: string; versionable?: boolean }> = Array.isArray(d.custom_fields)
          ? d.custom_fields
          : []
        const nameVersionable =
          versionableBase.includes('name') ||
          customFields.some(f => f?.name === 'name' && f?.versionable === true)
        visibleTypeMeta.set(d.type_id, {
          label: d.label ?? d.type_id,
          icon: d.icon ?? '📋',
          nameVersionable,
        })
      }

      if (visibleTypeMeta.size === 0) return { installed: true, entities: [] }

      const entityRows = await db
        .select({
          id: entities.id,
          data: entities.entityData,
          collectionName: entities.collectionName,
          minimumTierLevel: entities.minimumTierLevel,
          publishBase: entities.publishBase,
          publishedVariantIds: entities.publishedVariantIds,
        })
        .from(entities)
        .where(and(
          scopeFilter,
          inArray(entities.collectionName, Array.from(visibleTypeMeta.keys())),
          eq(entities.isPublished, true),
        ))

      // Build one row per (entity, distinct visible name). The highlight matcher
      // on the client dedupes by lowercase name and keeps a list per match.
      const rows: { id: string; name: string; typeId: string; typeIcon: string; typeLabel: string }[] = []
      for (const r of entityRows) {
        if (!isOwner && r.minimumTierLevel > callerTier) continue
        const meta = visibleTypeMeta.get(r.collectionName)!
        const data = r.data as Record<string, any>
        const baseName = typeof data?.name === 'string' ? (data.name as string) : ''
        const seen = new Set<string>()
        const pushName = (candidate: unknown) => {
          if (typeof candidate !== 'string') return
          const trimmed = candidate.trim()
          if (!trimmed) return
          const key = trimmed.toLowerCase()
          if (seen.has(key)) return
          seen.add(key)
          rows.push({
            id: r.id,
            name: trimmed,
            typeId: r.collectionName,
            typeIcon: meta.icon,
            typeLabel: meta.label,
          })
        }

        if (r.publishBase) pushName(baseName)

        const variantIds = r.publishedVariantIds ?? []
        if (variantIds.length > 0) {
          const variantsRoot = data?._variants
          const items = variantsRoot?.items as Record<string, { overrides?: Record<string, unknown> }> | undefined
          if (items) {
            for (const vid of variantIds) {
              const item = items[vid]
              if (!item) continue
              if (meta.nameVersionable && item.overrides && typeof item.overrides.name === 'string') {
                pushName(item.overrides.name)
              } else {
                // Fall back to base name for this entry since variant doesn't override it
                pushName(baseName)
              }
            }
          }
        }
      }

      return { installed: true, entities: rows }
    } catch (error) {
      fastify.log.error(error, 'Failed to list published entity names')
      return reply.status(500).send({ error: 'Failed to list entities' })
    }
  })

  // ============================================
  // ANNOTATIONS (READER FEEDBACK)
  // ============================================

  /**
   * Check if current user can annotate a project
   */
  fastify.get<{
    Params: { projectId: string }
  }>('/public/projects/:projectId/can-annotate', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = randomUUID()
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
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = randomUUID()
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
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = randomUUID()
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
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = randomUUID()
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
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = randomUUID()
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
    preHandler: requireAuth
  }, async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params
      const { status: statusFilter, annotationType, chapterId, limit = 50, offset = 0 } = request.query

      const isOwner = await requireProjectOwnership(request, reply, projectId)
      if (!isOwner) return

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
        .leftJoin(entities, eq(entities.id, chapterAnnotations.chapterId))
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
          .where(inArray(entities.id, chapterIds))

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
        .leftJoin(entities, eq(entities.id, chapterAnnotations.chapterId))
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
    const correlationId = randomUUID()
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
   */
  fastify.put<{
    Params: { projectId: string; annotationId: string }
    Body: { status: string; authorResponse?: string }
  }>('/projects/:projectId/annotations/:annotationId/status', {
    preHandler: requireAuth
  }, async (request, reply) => {
    const correlationId = randomUUID()
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
  })

  /**
   * Accept a suggestion — apply the text replacement and resolve the annotation
   */
  fastify.post<{
    Params: { projectId: string; annotationId: string }
  }>('/projects/:projectId/annotations/:annotationId/accept', {
    preHandler: requireAuth
  }, async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId, annotationId } = request.params

      const isOwner = await requireProjectOwnership(request, reply, projectId)
      if (!isOwner) return

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
          .select({ id: entities.id, entityData: entities.entityData, version: entities.version })
          .from(entities)
          .where(eq(entities.id, annotation.chapterId))
          .limit(1)

        if (chapter) {
          const data = chapter.entityData as Record<string, any>
          const chapterBody = data?.body as string | undefined
          if (chapterBody?.includes(annotation.anchorQuote)) {
            const updatedBody = chapterBody.replace(annotation.anchorQuote, annotation.suggestedText)
            await db
              .update(entities)
              .set({
                entityData: { ...data, body: updatedBody },
                version: (chapter.version ?? 0) + 1,
                lastEditedAt: new Date()
              })
              .where(eq(entities.id, chapter.id))
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

export default readerPlugin
