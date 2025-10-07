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
  accessGrants
} from '../db/schema'
import { eq, and, desc, sql, isNull, or } from 'drizzle-orm'
import { randomUUID } from 'crypto'

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
  }

  // Check embargo (public release date)
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
          title: sql<string>`(${entities}.data->>'title')`,
          publishedAt: chapterPublications.publishedAt,
          publicReleaseDate: chapterPublications.publicReleaseDate,
          viewCount: chapterPublications.viewCount,
          order: sql<number>`COALESCE((${entities}.data->>'order')::int, 0)`
        })
        .from(chapterPublications)
        .innerJoin(entities, eq(entities.id, chapterPublications.chapterId))
        .where(and(
          eq(chapterPublications.projectId, projectId),
          eq(chapterPublications.isPublished, true)
        ))
        .orderBy(sql`COALESCE((${entities}.data->>'order')::int, 0)`)

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
          title: sql<string>`(${entities}.data->>'title')`,
          content: sql<string>`(${entities}.data->>'content')`,
          publishedAt: chapterPublications.publishedAt,
          viewCount: chapterPublications.viewCount,
          order: sql<number>`COALESCE((${entities}.data->>'order')::int, 0)`
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
          order: sql<number>`COALESCE((${entities}.data->>'order')::int, 0)`
        })
        .from(entities)
        .innerJoin(chapterPublications, eq(chapterPublications.chapterId, entities.id))
        .where(and(
          eq(entities.projectId, projectId),
          eq(chapterPublications.isPublished, true)
        ))
        .orderBy(sql`COALESCE((${entities}.data->>'order')::int, 0)`)

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
      const baseUrl = process.env.WEB_ORIGIN || 'http://localhost:3000'

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
          title: sql<string>`(${entities}.data->>'title')`,
          content: sql<string>`(${entities}.data->>'content')`,
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
      const baseUrl = process.env.WEB_ORIGIN || 'http://localhost:3000'

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
        .orderBy(sql`COALESCE((${entities}.data->>'order')::int, 0)`)

      const baseUrl = process.env.WEB_ORIGIN || 'http://localhost:3000'

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
      const baseUrl = process.env.WEB_ORIGIN || 'http://localhost:3000'

      // Get recent published chapters
      const chapters = await db
        .select({
          id: entities.id,
          title: sql<string>`(${entities}.data->>'title')`,
          content: sql<string>`(${entities}.data->>'content')`,
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
}

export default readerPlugin
