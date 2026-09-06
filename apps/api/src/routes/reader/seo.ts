/** SEO & metadata: sitemap, RSS, OpenGraph metadata. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { chapterPublications, entities, projects, projectPublishConfig, userProfiles, users, rssFeedTokens } from '../../db/schema'
import { eq, and, desc, sql, isNull } from 'drizzle-orm'
import { env } from '../../lib/env'
import { optionalAuth } from '../../middleware/auth'
import { hashRssToken } from '../rss-tokens'
import { escapeXml, htmlToPlainText } from '../../lib/text'
import { notDeleted } from '../../lib/entity-scope'
import { checkChaptersAccess } from '../../lib/chapter-access'
import { resolveSlug, getSlugsForEntities } from '../../lib/slugs'
import { getChapterOrderClauses, canViewProject, getReaderProjectBase } from './shared'

const seoRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================
  // SEO & METADATA ENDPOINTS
  // ============================================

  /**
   * Get SEO metadata for a project
   * Returns Open Graph, Twitter Card, and structured data
   */
  fastify.get<{
    Params: { projectId: string }
  }>('/public/projects/:projectId/metadata', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { projectId } = request.params

      if (!(await canViewProject(projectId, request.user?.id))) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }

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
  }>('/public/projects/:projectId/chapters/:chapterId/metadata', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = request.id
    try {
      const { projectId, chapterId: chapterParam } = request.params

      if (!(await canViewProject(projectId, request.user?.id))) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }

      const resolved = await resolveSlug(projectId, chapterParam)
      if (!resolved) {
        return reply.status(404).send({ error: 'Chapter not found', correlationId })
      }
      const chapterId = resolved.entityId

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
          eq(chapterPublications.isPublished, true),
          notDeleted()
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
          shortUrl: projects.shortUrl,
          ownerName: users.name,
          ownerUsername: userProfiles.username,
          ownerId: projects.ownerId,
        })
        .from(projects)
        .leftJoin(users, eq(projects.ownerId, users.id))
        .leftJoin(userProfiles, eq(userProfiles.userId, projects.ownerId))
        .where(eq(projects.id, projectId))
        .limit(1)

      const projectData = project
        ? { title: project.name, coverImage: project.coverImage, author: project.ownerName }
        : null
      const baseUrl = env.WEB_ORIGIN

      // Pretty reader URL when the project has a claimed short URL; the old
      // /projects/<uuid>/chapters/<uuid> form otherwise.
      const authorSegment = project?.ownerUsername || project?.ownerId
      const readerUrl = project?.shortUrl && authorSegment
        ? `${baseUrl}/read/${authorSegment}/${project.shortUrl}/${resolved.currentSlug ?? chapterId}`
        : `${baseUrl}/projects/${projectId}/chapters/${chapterId}`

      // Excerpt from the prose, not the stored HTML.
      const excerpt = htmlToPlainText(chapter.content).replace(/\s+/g, ' ').trim().substring(0, 200) + '...'

      const metadata = {
        title: `${chapter.title} - ${projectData?.title || 'Untitled Project'}`,
        description: excerpt,
        slug: resolved.currentSlug,
        isCurrentSlug: resolved.requestedIsCurrent,

        openGraph: {
          type: 'article',
          title: chapter.title,
          description: excerpt,
          url: readerUrl,
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

        canonical: readerUrl
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
    const correlationId = request.id
    try {
      const { projectId } = request.params

      // Sitemaps are for search engines — only public projects belong in one.
      if (!(await canViewProject(projectId, undefined))) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }

      // Get all published chapters in reader order.
      const sitemapOrderClauses = await getChapterOrderClauses(projectId)
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
          eq(chapterPublications.isPublished, true),
          notDeleted()
        ))
        .orderBy(...sitemapOrderClauses)

      const baseUrl = env.WEB_ORIGIN
      const readerBase = await getReaderProjectBase(projectId)
      const slugMap = readerBase
        ? await getSlugsForEntities(projectId, chapters.map(c => c.id))
        : new Map<string, string>()

      // Build XML sitemap
      const urls = chapters.map(chapter => {
        const lastmod = (chapter.updatedAt || chapter.publishedAt)?.toISOString().split('T')[0]
        const loc = readerBase
          ? `${readerBase}/${slugMap.get(chapter.id) ?? chapter.id}`
          : `${baseUrl}/projects/${projectId}/chapters/${chapter.id}`
        return `
  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`
      }).join('')

      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${readerBase ?? `${baseUrl}/projects/${projectId}`}</loc>
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
    const correlationId = request.id
    try {
      const { projectId } = request.params
      const { reader: readerToken } = request.query
      // Clamp: this over-fetches 2x and renders full chapter bodies.
      const limit = Math.min(Math.max(1, Number(request.query.limit) || 20), 100)

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

      // Private projects only serve feeds to viewers with access (identified
      // by their RSS reader token — RSS clients can't do bearer auth).
      if (!(await canViewProject(projectId, readerUserId))) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
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
          eq(chapterPublications.isPublished, true),
          notDeleted()
        ))
        .orderBy(desc(chapterPublications.publishedAt))
        .limit(limit * 2) // over-fetch so filtering still has enough for `limit`

      const accessMap = await checkChaptersAccess(
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

      const readerBase = await getReaderProjectBase(projectId)
      const slugMap = readerBase
        ? await getSlugsForEntities(projectId, chapters.map(c => c.id))
        : new Map<string, string>()
      const projectLink = readerBase ?? `${baseUrl}/projects/${projectId}`

      // Build RSS feed items
      const items = chapters.map(chapter => {
        const excerpt = htmlToPlainText(chapter.content).replace(/\s+/g, ' ').trim().substring(0, 500)
        const pubDate = (chapter.publishedAt || new Date()).toUTCString()
        const link = readerBase
          ? `${readerBase}/${slugMap.get(chapter.id) ?? chapter.id}`
          : `${baseUrl}/projects/${projectId}/chapters/${chapter.id}`

        // guid stays keyed to the UUID URL: slugs move on rename, and a
        // changed guid would make feed readers re-surface old chapters.
        const guid = `${baseUrl}/projects/${projectId}/chapters/${chapter.id}`

        return `
    <item>
      <title>${escapeXml(chapter.title || 'Untitled')}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(guid)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(excerpt)}...</description>
      <author>${escapeXml(projectData.author || 'Unknown Author')}</author>
    </item>`
      }).join('')

      const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(projectData.title || 'Untitled Project')}</title>
    <link>${escapeXml(projectLink)}</link>
    <description>${escapeXml(projectData.description || 'No description')}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(`${baseUrl}/projects/${projectId}/feed.xml`)}" rel="self" type="application/rss+xml" />
    <image>
      <url>${escapeXml(projectData.coverImage || `${baseUrl}/default-cover.jpg`)}</url>
      <title>${escapeXml(projectData.title || 'Untitled Project')}</title>
      <link>${escapeXml(projectLink)}</link>
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

export default seoRoutes
