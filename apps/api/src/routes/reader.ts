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
  projectPublishConfig,
  subscriptions,
  subscriptionTiers,
  embargoSchedules,
  userProfiles,
  users,
  comments,
  reactions
} from '../db/schema'
import { eq, and, desc, asc, sql, isNull, or, count } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { env } from '../lib/env'
import { optionalAuth } from '../middleware/auth'

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
  userId?: string
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
        eq(betaReaders.projectId, projectId),
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
        eq(accessGrants.projectId, projectId),
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
      const [sub] = await db
        .select({
          tierId: subscriptions.tierId,
          status: subscriptions.status,
          chapterDelayDays: subscriptionTiers.chapterDelayDays
        })
        .from(subscriptions)
        .innerJoin(subscriptionTiers, eq(subscriptionTiers.id, subscriptions.tierId))
        .where(and(
          eq(subscriptions.subscriberId, userId),
          eq(subscriptions.authorId, project.ownerId),
          eq(subscriptions.status, 'active')
        ))
        .limit(1)

      if (sub) {
        // Subscriber: check if their tier delay has passed since publication
        if (chapterPub.publishedAt) {
          const delayMs = (sub.chapterDelayDays ?? 0) * 24 * 60 * 60 * 1000
          const accessDate = new Date(chapterPub.publishedAt.getTime() + delayMs)
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

      // Filter chapters based on access control
      const accessibleChapters = []
      for (const chapter of publishedChapters) {
        const access = await checkPublicChapterAccess(chapter.chapterId, projectId, userId)
        if (access.canAccess) {
          accessibleChapters.push({
            id: chapter.chapterId,
            title: chapter.title,
            publishedAt: chapter.publishedAt,
            viewCount: chapter.viewCount,
            order: chapter.order
          })
        } else if (access.embargoUntil) {
          // Show embargoed chapters but mark them
          accessibleChapters.push({
            id: chapter.chapterId,
            title: chapter.title,
            embargoUntil: access.embargoUntil,
            order: chapter.order,
            locked: true
          })
        }
      }

      return reply.send({
        toc: accessibleChapters,
        totalChapters: accessibleChapters.length,
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

      // Check access
      const access = await checkPublicChapterAccess(chapterId, projectId, userId)
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

      // Track view
      const [view] = await db
        .insert(chapterViews)
        .values({
          chapterId,
          readerId: userId || null,
          sessionId: sessionId || randomUUID(),
          deviceType,
          referrer,
          readTimeSeconds: readTime ? String(readTime) : '0',
          lastPositionPercent: position ? String(position) : '0'
        })
        .returning()

      if (!view) {
        return reply.status(500).send({ error: 'Failed to create view record', correlationId })
      }

      // Increment view count
      await db
        .update(chapterPublications)
        .set({
          viewCount: sql`CAST(${chapterPublications.viewCount} AS INTEGER) + 1`,
          updatedAt: new Date()
        })
        .where(eq(chapterPublications.chapterId, chapterId))

      return reply.status(201).send({
        viewId: view.id,
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

      // Get project info
      const [project] = await db
        .select()
        .from(entities)
        .where(eq(entities.id, projectId))
        .limit(1)

      if (!project) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }

      const projectData = project.entityData as any
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
          creator: projectData.twitterHandle || ''
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

      const [project] = await db
        .select()
        .from(entities)
        .where(eq(entities.id, projectId))
        .limit(1)

      const projectData = project?.entityData as any
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
    }
  }>('/public/projects/:projectId/feed.xml', async (request, reply) => {
    const correlationId = randomUUID()
    try {
      const { projectId } = request.params
      const { limit = 20 } = request.query

      // Get project info
      const [project] = await db
        .select()
        .from(entities)
        .where(eq(entities.id, projectId))
        .limit(1)

      if (!project) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }

      const projectData = project.entityData as any
      const baseUrl = env.WEB_ORIGIN

      // Get recent published chapters
      const chapters = await db
        .select({
          id: entities.id,
          title: sql<string>`(${entities.entityData}->>'title')`,
          content: sql<string>`(${entities.entityData}->>'body')`,
          publishedAt: chapterPublications.publishedAt,
          updatedAt: chapterPublications.updatedAt
        })
        .from(entities)
        .innerJoin(chapterPublications, eq(chapterPublications.chapterId, entities.id))
        .where(and(
          eq(entities.projectId, projectId),
          eq(chapterPublications.isPublished, true)
        ))
        .orderBy(desc(chapterPublications.publishedAt))
        .limit(limit)

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

      // Look up by shortUrl or slugPrefix in publish config
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
        .where(eq(projects.shortUrl, slug))
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
          .where(eq(projectPublishConfig.slugPrefix, slug))
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

      // Try username first, then fall back to user ID (UUID)
      let [author] = await db
        .select({
          userId: userProfiles.userId,
          username: userProfiles.username,
          displayName: userProfiles.displayName,
          avatarUrl: userProfiles.avatarUrl,
          userName: users.name
        })
        .from(userProfiles)
        .innerJoin(users, eq(users.id, userProfiles.userId))
        .where(eq(userProfiles.username, username))
        .limit(1)

      // If not found by username, try as a user ID
      if (!author) {
        [author] = await db
          .select({
            userId: userProfiles.userId,
            username: userProfiles.username,
            displayName: userProfiles.displayName,
            avatarUrl: userProfiles.avatarUrl,
            userName: users.name
          })
          .from(userProfiles)
          .innerJoin(users, eq(users.id, userProfiles.userId))
          .where(eq(userProfiles.userId, username))
          .limit(1)
      }

      // Last resort: check users table directly (no profile created yet)
      if (!author) {
        const [user] = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, username))
          .limit(1)
        if (user) {
          author = { userId: user.id, username: null, displayName: null, avatarUrl: null, userName: user.name }
        }
      }

      if (!author) {
        return reply.status(404).send({ error: 'Author not found', correlationId })
      }

      // Find project by owner + shortUrl
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
          eq(projects.shortUrl, projectSlug)
        ))
        .limit(1)

      if (!project) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }

      return reply.send({ project, author, correlationId })
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

      // Try username first, then fall back to user ID (UUID)
      let [author] = await db
        .select({
          userId: userProfiles.userId,
          username: userProfiles.username,
          displayName: userProfiles.displayName,
          avatarUrl: userProfiles.avatarUrl,
          bio: userProfiles.bio,
          userName: users.name
        })
        .from(userProfiles)
        .innerJoin(users, eq(users.id, userProfiles.userId))
        .where(eq(userProfiles.username, username))
        .limit(1)

      // If not found by username, try as a user ID
      if (!author) {
        [author] = await db
          .select({
            userId: userProfiles.userId,
            username: userProfiles.username,
            displayName: userProfiles.displayName,
            avatarUrl: userProfiles.avatarUrl,
            bio: userProfiles.bio,
            userName: users.name
          })
          .from(userProfiles)
          .innerJoin(users, eq(users.id, userProfiles.userId))
          .where(eq(userProfiles.userId, username))
          .limit(1)
      }

      // Last resort: check users table directly (no profile created yet)
      if (!author) {
        const [user] = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, username))
          .limit(1)
        if (user) {
          author = { userId: user.id, username: null, displayName: null, avatarUrl: null, bio: null, userName: user.name }
        }
      }

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
          sql`${projects.shortUrl} IS NOT NULL`
        ))
        .orderBy(desc(projects.createdAt))

      return reply.send({ author, projects: publishedProjects, correlationId })
    } catch (error) {
      fastify.log.error({ error, correlationId }, 'Failed to get author projects')
      return reply.status(500).send({ error: 'Failed to get author projects', correlationId })
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

      const chapterComments = await db
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
        .orderBy(desc(comments.createdAt))
        .limit(limit)
        .offset(offset)

      const [total] = await db
        .select({ count: count() })
        .from(comments)
        .where(and(
          eq(comments.chapterId, chapterId),
          eq(comments.moderationStatus, 'approved')
        ))

      return reply.send({
        comments: chapterComments,
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
}

export default readerPlugin
