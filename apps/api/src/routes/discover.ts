import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import {
  projects,
  projectCollections,
  projectCollectionMemberships,
  projectPublishConfig,
  userProfiles,
  userFollowers,
  contentTags,
  chapterPublications,
  chapterViews,
  reactions,
  siteMemberships,
  userBadges,
} from '../db/schema'
import { eq, and, or, ilike, sql, desc, asc, count, countDistinct, isNull, inArray, gte } from 'drizzle-orm'

/**
 * Explore ranking multiplier for active site supporters — the "Boosted explore
 * ranking" perk on the membership page.
 *
 * Deliberately a multiplier rather than the flat bonus this used to be: a
 * constant is decisive below its own magnitude and invisible above it, so the
 * same number behaved completely differently for a project with 20 views and
 * one with 20,000. A multiplier keeps the perk proportional at every scale, and
 * means a supporter still can't outrank work doing several times the numbers.
 */
const SUPPORTER_BOOST = 1.2

type ScoredSort = 'popular' | 'trending' | 'most_liked'

/**
 * Per-project engagement score, aliased as score_sq(project_id, score).
 *
 * `trending` counts rows in chapter_views rather than summing the stored
 * counters, because that table is the only place a view carries a timestamp —
 * the counters are all-time totals. The previous implementation filtered on
 * chapter_publications.published_at instead, which selected recently-*published*
 * chapters and then summed their all-time views: a chapter published last year
 * and being read heavily today scored zero.
 */
function buildScoreSubquery(sort: ScoredSort) {
  if (sort === 'trending') {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    return db
      .select({
        projectId: chapterPublications.projectId,
        score: sql<number>`COUNT(*)`.as('score')
      })
      .from(chapterViews)
      .innerJoin(chapterPublications, eq(chapterPublications.chapterId, chapterViews.chapterId))
      .where(gte(chapterViews.startedAt, thirtyDaysAgo))
      .groupBy(chapterPublications.projectId)
      .as('score_sq')
  }

  if (sort === 'most_liked') {
    return db
      .select({
        projectId: chapterPublications.projectId,
        score: sql<number>`COUNT(*)`.as('score')
      })
      .from(reactions)
      .innerJoin(chapterPublications, eq(chapterPublications.chapterId, reactions.chapterId))
      .groupBy(chapterPublications.projectId)
      .as('score_sq')
  }

  // popular: all-time views
  return db
    .select({
      projectId: chapterPublications.projectId,
      score: sql<number>`COALESCE(SUM(${chapterPublications.viewCount}), 0)`.as('score')
    })
    .from(chapterPublications)
    .groupBy(chapterPublications.projectId)
    .as('score_sq')
}

const discoverPlugin: FastifyPluginAsync = async (fastify) => {

  // GET /discover/projects — Browse/search published projects
  fastify.get<{
    Querystring: {
      q?: string
      genre?: string
      sort?: 'recent' | 'popular' | 'trending' | 'most_liked'
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

      // Build base conditions: only live-published, publicly visible, non-archived,
      // non-deleted projects with at least one published chapter (empty projects
      // don't belong on explore).
      const baseConditions = and(
        eq(projectPublishConfig.publishingMode, 'live'),
        eq(projectPublishConfig.projectVisibility, 'public'),
        eq(projects.isArchived, false),
        isNull(projects.deletedAt),
        sql`EXISTS (SELECT 1 FROM ${chapterPublications} WHERE ${chapterPublications.projectId} = ${projects.id} AND ${chapterPublications.isPublished} = true)`
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

      // Scored sorts all share one query shape — only the engagement subquery
      // differs — so they run through a single path. `recent` needs no score.
      if (sort === 'popular' || sort === 'trending' || sort === 'most_liked') {
        const scoreSq = buildScoreSubquery(sort)

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
            defaultVisibility: projectPublishConfig.defaultVisibility
          })
          .from(projects)
          .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
          .leftJoin(userProfiles, eq(userProfiles.userId, projects.ownerId))
          .leftJoin(scoreSq, sql`${sql.raw('score_sq.project_id')} = ${projects.id}`)
          .leftJoin(siteMemberships, eq(siteMemberships.userId, projects.ownerId))
          .where(whereConditions)
          // updatedAt breaks ties so results are stable rather than arbitrary —
          // most projects score 0 on a young site, and an unstable ORDER BY
          // makes pagination drop and repeat rows.
          // The casts are required: without them Postgres infers the CASE result
          // type from `ELSE 1` and rejects a fractional boost as an integer.
          .orderBy(sql`
            COALESCE(${sql.raw('score_sq.score')}, 0)::numeric
              * CASE WHEN ${siteMemberships.tier} = 'supporter' AND ${siteMemberships.status} = 'active'
                     THEN ${SUPPORTER_BOOST}::numeric ELSE 1::numeric END DESC,
            ${projects.updatedAt} DESC
          `)
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
          defaultVisibility: projectPublishConfig.defaultVisibility
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

      // Subquery: authors who have at least one live, publicly visible project
      // with a published chapter
      const publishedAuthorsSq = db
        .selectDistinct({ ownerId: projects.ownerId })
        .from(projects)
        .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
        .where(and(
          eq(projectPublishConfig.publishingMode, 'live'),
          eq(projectPublishConfig.projectVisibility, 'public'),
          eq(projects.isArchived, false),
          isNull(projects.deletedAt),
          sql`EXISTS (SELECT 1 FROM ${chapterPublications} WHERE ${chapterPublications.projectId} = ${projects.id} AND ${chapterPublications.isPublished} = true)`
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
          eq(projectPublishConfig.projectVisibility, 'public'),
          eq(projects.isArchived, false),
          isNull(projects.deletedAt),
          sql`EXISTS (SELECT 1 FROM ${chapterPublications} WHERE ${chapterPublications.projectId} = ${projects.id} AND ${chapterPublications.isPublished} = true)`
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

      // Batch-load badges for all authors
      const authorIds = rows.map(r => r.userId)
      const authorBadgesRows = authorIds.length > 0
        ? await db
            .select({ userId: userBadges.userId, badge: userBadges.badge })
            .from(userBadges)
            .where(
              and(
                sql`${userBadges.userId} IN (${sql.join(authorIds.map(id => sql`${id}`), sql`, `)})`,
                eq(userBadges.isActive, true),
                sql`(${userBadges.expiresAt} IS NULL OR ${userBadges.expiresAt} > NOW())`
              )
            )
        : []

      const authorBadgesMap = new Map<string, string[]>()
      for (const b of authorBadgesRows) {
        const existing = authorBadgesMap.get(b.userId) || []
        existing.push(b.badge)
        authorBadgesMap.set(b.userId, existing)
      }

      const authors = rows.map(row => ({
        userId: row.userId,
        username: row.username,
        displayName: row.displayName || row.username || 'Anonymous',
        bio: row.bio,
        avatarUrl: row.avatarUrl,
        followerCount: Number(row.followerCount),
        publishedProjectCount: Number(row.publishedProjectCount),
        badges: authorBadgesMap.get(row.userId) || [],
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

      // Only count tags from live, publicly visible projects with published chapters
      const conditions = and(
        eq(projectPublishConfig.publishingMode, 'live'),
        eq(projectPublishConfig.projectVisibility, 'public'),
        eq(projects.isArchived, false),
        isNull(projects.deletedAt),
        sql`EXISTS (SELECT 1 FROM ${chapterPublications} WHERE ${chapterPublications.projectId} = ${projects.id} AND ${chapterPublications.isPublished} = true)`,
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
  defaultVisibility: string | null
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
      // view_count is the counter reader.ts actually increments; unique_view_count
      // is never written anywhere, so reading it reported 0 views for every
      // project on every tab.
      totalViews: sql<number>`COALESCE(SUM(${chapterPublications.viewCount}), 0)`
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

  // Batch-load badges for all project owners
  const ownerIds = [...new Set(rows.map(r => r.ownerId))]
  const allBadges = ownerIds.length > 0
    ? await db
        .select({
          userId: userBadges.userId,
          badge: userBadges.badge,
        })
        .from(userBadges)
        .where(
          and(
            sql`${userBadges.userId} IN (${sql.join(ownerIds.map(id => sql`${id}`), sql`, `)})`,
            eq(userBadges.isActive, true),
            sql`(${userBadges.expiresAt} IS NULL OR ${userBadges.expiresAt} > NOW())`
          )
        )
    : []

  const badgesByUser = new Map<string, string[]>()
  for (const b of allBadges) {
    const existing = badgesByUser.get(b.userId) || []
    existing.push(b.badge)
    badgesByUser.set(b.userId, existing)
  }

  // Batch-load collection memberships for all projects
  const allMemberships = await db
    .select({
      projectId: projectCollectionMemberships.projectId,
      collectionId: projectCollectionMemberships.collectionId,
      collectionName: projectCollections.name,
    })
    .from(projectCollectionMemberships)
    .innerJoin(projectCollections, eq(projectCollections.id, projectCollectionMemberships.collectionId))
    .where(and(
      inArray(projectCollectionMemberships.projectId, projectIds),
      isNull(projectCollections.deletedAt),
    ))

  // Count published projects per collection to filter to 2+
  const collectionIds = [...new Set(allMemberships.map(m => m.collectionId))]
  const collPubCounts = new Map<string, number>()
  if (collectionIds.length > 0) {
    const counts = await db
      .select({
        collectionId: projectCollectionMemberships.collectionId,
        count: count(),
      })
      .from(projectCollectionMemberships)
      .innerJoin(projects, eq(projects.id, projectCollectionMemberships.projectId))
      .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
      .where(and(
        inArray(projectCollectionMemberships.collectionId, collectionIds),
        isNull(projects.deletedAt),
        eq(projectPublishConfig.publishingMode, 'live'),
        eq(projectPublishConfig.projectVisibility, 'public'),
        sql`EXISTS (SELECT 1 FROM ${chapterPublications} WHERE ${chapterPublications.projectId} = ${projects.id} AND ${chapterPublications.isPublished} = true)`
      ))
      .groupBy(projectCollectionMemberships.collectionId)

    for (const c of counts) {
      collPubCounts.set(c.collectionId, Number(c.count))
    }
  }

  // Build map: projectId -> collection info (only for collections with 2+ published projects)
  const collectionByProject = new Map<string, { id: string; name: string }>()
  for (const m of allMemberships) {
    const pubCount = collPubCounts.get(m.collectionId) || 0
    if (pubCount >= 2) {
      collectionByProject.set(m.projectId, { id: m.collectionId, name: m.collectionName })
    }
  }

  return rows.map(row => {
    const tags = tagsByProject.get(row.id) || []
    const stats = statsByProject.get(row.id) || { chapterCount: 0, totalViews: 0 }
    const coll = collectionByProject.get(row.id)

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
      totalViews: stats.totalViews,
      authorBadges: badgesByUser.get(row.ownerId) || [],
      subscriberOnly: row.defaultVisibility === 'subscribers_only',
      collectionId: coll?.id ?? null,
      collectionName: coll?.name ?? null,
    }
  })
}

export default discoverPlugin
