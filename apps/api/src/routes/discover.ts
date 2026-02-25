import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import {
  projects,
  projectPublishConfig,
  userProfiles,
  userFollowers,
  contentTags,
  chapterPublications
} from '../db/schema'
import { eq, and, or, ilike, sql, desc, asc, count, countDistinct } from 'drizzle-orm'

const discoverPlugin: FastifyPluginAsync = async (fastify) => {

  // GET /discover/projects — Browse/search published projects
  fastify.get<{
    Querystring: {
      q?: string
      genre?: string
      sort?: 'recent' | 'popular' | 'trending'
      limit?: string
      offset?: string
    }
  }>('/discover/projects', async (request, reply) => {
    try {
      const {
        q,
        genre,
        sort = 'recent',
        limit: limitStr = '20',
        offset: offsetStr = '0'
      } = request.query

      const limit = Math.min(Math.max(parseInt(limitStr) || 20, 1), 50)
      const offset = Math.max(parseInt(offsetStr) || 0, 0)

      // Build base conditions: only live-published, non-archived projects
      const baseConditions = and(
        eq(projectPublishConfig.publishingMode, 'live'),
        eq(projects.isArchived, false)
      )

      // Search condition
      const searchCondition = q
        ? or(
            ilike(projects.name, `%${q}%`),
            ilike(projects.description, `%${q}%`)
          )
        : undefined

      // Genre filter: get project IDs that have the matching genre tag
      let genreProjectIds: string[] | undefined
      if (genre) {
        const genreResults = await db
          .select({ projectId: contentTags.projectId })
          .from(contentTags)
          .where(and(
            eq(contentTags.tagCategory, 'genre'),
            ilike(contentTags.tagName, genre)
          ))
        genreProjectIds = genreResults.map(r => r.projectId)
        if (genreProjectIds.length === 0) {
          return reply.send({ projects: [], total: 0, hasMore: false })
        }
      }

      // Build the full WHERE clause
      const whereConditions = and(
        baseConditions,
        searchCondition,
        genreProjectIds
          ? sql`${projects.id} IN (${sql.join(genreProjectIds.map(id => sql`${id}`), sql`, `)})`
          : undefined
      )

      // Count total matching projects
      const [totalResult] = await db
        .select({ count: count() })
        .from(projects)
        .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
        .where(whereConditions)

      const total = totalResult?.count ?? 0

      // Build sort order and main query
      if (sort === 'popular') {
        const rows = await db
          .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            coverImage: projects.coverImage,
            shortUrl: projects.shortUrl,
            updatedAt: projects.updatedAt,
            ownerId: projects.ownerId,
            authorUsername: userProfiles.username,
            authorDisplayName: userProfiles.displayName,
            authorAvatarUrl: userProfiles.avatarUrl,
            totalViews: sql<number>`COALESCE(${sql.raw('views_sq.total_views')}, 0)`
          })
          .from(projects)
          .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
          .leftJoin(userProfiles, eq(userProfiles.userId, projects.ownerId))
          .leftJoin(
            db.select({
              projectId: chapterPublications.projectId,
              totalViews: sql<number>`COALESCE(SUM(${chapterPublications.uniqueViewCount}), 0)`.as('total_views')
            })
            .from(chapterPublications)
            .groupBy(chapterPublications.projectId)
            .as('views_sq'),
            sql`${sql.raw('views_sq.project_id')} = ${projects.id}`
          )
          .where(whereConditions)
          .orderBy(sql`COALESCE(${sql.raw('views_sq.total_views')}, 0) DESC`)
          .limit(limit)
          .offset(offset)

        const projectsWithDetails = await enrichProjects(rows)
        return reply.send({ projects: projectsWithDetails, total, hasMore: offset + limit < total })
      }

      if (sort === 'trending') {
        // Popular in last 30 days
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

        const rows = await db
          .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            coverImage: projects.coverImage,
            shortUrl: projects.shortUrl,
            updatedAt: projects.updatedAt,
            ownerId: projects.ownerId,
            authorUsername: userProfiles.username,
            authorDisplayName: userProfiles.displayName,
            authorAvatarUrl: userProfiles.avatarUrl,
            totalViews: sql<number>`COALESCE(${sql.raw('trending_sq.total_views')}, 0)`
          })
          .from(projects)
          .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
          .leftJoin(userProfiles, eq(userProfiles.userId, projects.ownerId))
          .leftJoin(
            db.select({
              projectId: chapterPublications.projectId,
              totalViews: sql<number>`COALESCE(SUM(${chapterPublications.uniqueViewCount}), 0)`.as('total_views')
            })
            .from(chapterPublications)
            .where(sql`${chapterPublications.publishedAt} >= ${thirtyDaysAgo}`)
            .groupBy(chapterPublications.projectId)
            .as('trending_sq'),
            sql`${sql.raw('trending_sq.project_id')} = ${projects.id}`
          )
          .where(whereConditions)
          .orderBy(sql`COALESCE(${sql.raw('trending_sq.total_views')}, 0) DESC`)
          .limit(limit)
          .offset(offset)

        const projectsWithDetails = await enrichProjects(rows)
        return reply.send({ projects: projectsWithDetails, total, hasMore: offset + limit < total })
      }

      // Default: recent (by updatedAt)
      const rows = await db
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          coverImage: projects.coverImage,
          shortUrl: projects.shortUrl,
          updatedAt: projects.updatedAt,
          ownerId: projects.ownerId,
          authorUsername: userProfiles.username,
          authorDisplayName: userProfiles.displayName,
          authorAvatarUrl: userProfiles.avatarUrl,
          totalViews: sql<number>`0`
        })
        .from(projects)
        .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
        .leftJoin(userProfiles, eq(userProfiles.userId, projects.ownerId))
        .where(whereConditions)
        .orderBy(desc(projects.updatedAt))
        .limit(limit)
        .offset(offset)

      const projectsWithDetails = await enrichProjects(rows)
      return reply.send({ projects: projectsWithDetails, total, hasMore: offset + limit < total })

    } catch (error) {
      fastify.log.error(error, 'Failed to discover projects')
      return reply.status(500).send({ error: 'Failed to fetch projects' })
    }
  })

  // GET /discover/authors — Browse/search authors with published work
  fastify.get<{
    Querystring: {
      q?: string
      sort?: 'popular' | 'recent' | 'alphabetical'
      limit?: string
      offset?: string
    }
  }>('/discover/authors', async (request, reply) => {
    try {
      const {
        q,
        sort = 'popular',
        limit: limitStr = '20',
        offset: offsetStr = '0'
      } = request.query

      const limit = Math.min(Math.max(parseInt(limitStr) || 20, 1), 50)
      const offset = Math.max(parseInt(offsetStr) || 0, 0)

      // Subquery: authors who have at least one live-published project
      const publishedAuthorsSq = db
        .selectDistinct({ ownerId: projects.ownerId })
        .from(projects)
        .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
        .where(and(
          eq(projectPublishConfig.publishingMode, 'live'),
          eq(projects.isArchived, false)
        ))
        .as('published_authors')

      // Search condition
      const searchCondition = q
        ? or(
            ilike(userProfiles.username, `%${q}%`),
            ilike(userProfiles.displayName, `%${q}%`),
            ilike(userProfiles.bio, `%${q}%`)
          )
        : undefined

      // Count total
      const [totalResult] = await db
        .select({ count: count() })
        .from(userProfiles)
        .innerJoin(
          publishedAuthorsSq,
          eq(sql.raw('published_authors.owner_id'), userProfiles.userId)
        )
        .where(searchCondition)

      const total = totalResult?.count ?? 0

      // Follower count subquery
      const followerCountSq = db
        .select({
          followingId: userFollowers.followingId,
          followerCount: count().as('follower_count')
        })
        .from(userFollowers)
        .groupBy(userFollowers.followingId)
        .as('follower_counts')

      // Published project count subquery
      const publishedCountSq = db
        .select({
          ownerId: projects.ownerId,
          projectCount: count().as('project_count')
        })
        .from(projects)
        .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
        .where(and(
          eq(projectPublishConfig.publishingMode, 'live'),
          eq(projects.isArchived, false)
        ))
        .groupBy(projects.ownerId)
        .as('published_counts')

      // Build order clause
      let orderBy: any
      if (sort === 'alphabetical') {
        orderBy = asc(userProfiles.displayName)
      } else if (sort === 'recent') {
        // Most recent publication
        orderBy = desc(userProfiles.updatedAt)
      } else {
        // popular — by follower count
        orderBy = sql`COALESCE(${sql.raw('follower_counts.follower_count')}, 0) DESC`
      }

      const rows = await db
        .select({
          userId: userProfiles.userId,
          username: userProfiles.username,
          displayName: userProfiles.displayName,
          bio: userProfiles.bio,
          avatarUrl: userProfiles.avatarUrl,
          followerCount: sql<number>`COALESCE(${sql.raw('follower_counts.follower_count')}, 0)`,
          publishedProjectCount: sql<number>`COALESCE(${sql.raw('published_counts.project_count')}, 0)`
        })
        .from(userProfiles)
        .innerJoin(
          publishedAuthorsSq,
          eq(sql.raw('published_authors.owner_id'), userProfiles.userId)
        )
        .leftJoin(
          followerCountSq,
          eq(sql.raw('follower_counts.following_id'), userProfiles.userId)
        )
        .leftJoin(
          publishedCountSq,
          eq(sql.raw('published_counts.owner_id'), userProfiles.userId)
        )
        .where(searchCondition)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset)

      const authors = rows.map(row => ({
        userId: row.userId,
        username: row.username,
        displayName: row.displayName || row.username || 'Anonymous',
        bio: row.bio,
        avatarUrl: row.avatarUrl,
        followerCount: Number(row.followerCount),
        publishedProjectCount: Number(row.publishedProjectCount)
      }))

      return reply.send({ authors, total, hasMore: offset + limit < total })

    } catch (error) {
      fastify.log.error(error, 'Failed to discover authors')
      return reply.status(500).send({ error: 'Failed to fetch authors' })
    }
  })

  // GET /discover/tags — Popular tags for filter UI
  fastify.get<{
    Querystring: {
      category?: string
      limit?: string
    }
  }>('/discover/tags', async (request, reply) => {
    try {
      const {
        category,
        limit: limitStr = '30'
      } = request.query

      const limit = Math.min(Math.max(parseInt(limitStr) || 30, 1), 100)

      // Only count tags from live-published projects
      const conditions = and(
        eq(projectPublishConfig.publishingMode, 'live'),
        eq(projects.isArchived, false),
        category ? eq(contentTags.tagCategory, category) : undefined
      )

      const rows = await db
        .select({
          name: contentTags.tagName,
          category: contentTags.tagCategory,
          projectCount: countDistinct(contentTags.projectId)
        })
        .from(contentTags)
        .innerJoin(projects, eq(projects.id, contentTags.projectId))
        .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
        .where(conditions)
        .groupBy(contentTags.tagName, contentTags.tagCategory)
        .orderBy(desc(countDistinct(contentTags.projectId)))
        .limit(limit)

      const tags = rows.map(row => ({
        name: row.name,
        category: row.category,
        projectCount: Number(row.projectCount)
      }))

      return reply.send({ tags })

    } catch (error) {
      fastify.log.error(error, 'Failed to fetch tags')
      return reply.status(500).send({ error: 'Failed to fetch tags' })
    }
  })
}

// Helper: enrich project rows with tags, chapter count, and total views
async function enrichProjects(rows: Array<{
  id: string
  name: string
  description: string | null
  coverImage: string | null
  shortUrl: string | null
  updatedAt: Date
  ownerId: string
  authorUsername: string | null
  authorDisplayName: string | null
  authorAvatarUrl: string | null
  totalViews: number
}>) {
  if (rows.length === 0) return []

  const projectIds = rows.map(r => r.id)

  // Batch-load tags for all projects
  const allTags = await db
    .select({
      projectId: contentTags.projectId,
      tagName: contentTags.tagName,
      tagCategory: contentTags.tagCategory
    })
    .from(contentTags)
    .where(sql`${contentTags.projectId} IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)})`)

  const tagsByProject = new Map<string, Array<{ name: string; category: string }>>()
  for (const tag of allTags) {
    const existing = tagsByProject.get(tag.projectId) || []
    existing.push({ name: tag.tagName, category: tag.tagCategory })
    tagsByProject.set(tag.projectId, existing)
  }

  // Batch-load chapter counts and total views
  const chapterStats = await db
    .select({
      projectId: chapterPublications.projectId,
      chapterCount: count(),
      totalViews: sql<number>`COALESCE(SUM(${chapterPublications.uniqueViewCount}), 0)`
    })
    .from(chapterPublications)
    .where(sql`${chapterPublications.projectId} IN (${sql.join(projectIds.map(id => sql`${id}`), sql`, `)})`)
    .groupBy(chapterPublications.projectId)

  const statsByProject = new Map<string, { chapterCount: number; totalViews: number }>()
  for (const stat of chapterStats) {
    statsByProject.set(stat.projectId, {
      chapterCount: Number(stat.chapterCount),
      totalViews: Number(stat.totalViews)
    })
  }

  return rows.map(row => {
    const tags = tagsByProject.get(row.id) || []
    const stats = statsByProject.get(row.id) || { chapterCount: 0, totalViews: 0 }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      coverImage: row.coverImage,
      shortUrl: row.shortUrl,
      updatedAt: row.updatedAt,
      authorId: row.ownerId,
      authorUsername: row.authorUsername,
      authorDisplayName: row.authorDisplayName || row.authorUsername || 'Anonymous',
      authorAvatarUrl: row.authorAvatarUrl,
      tags: tags.map(t => t.name),
      tagDetails: tags,
      chapterCount: stats.chapterCount,
      totalViews: stats.totalViews
    }
  })
}

export default discoverPlugin
