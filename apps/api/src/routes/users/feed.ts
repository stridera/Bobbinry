/** Feed and reading progress. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { userProfiles, userFollowers, projectFollows, projects, projectPublishConfig, chapterViews, chapterPublications, entities } from '../../db/schema'
import { eq, and, or, desc, isNull, sql, isNotNull, inArray, notInArray, ne, type SQL } from 'drizzle-orm'
import { requireAuth, requireSelf } from '../../middleware/auth'
import { notDeleted } from '../../lib/entity-scope'
import { resolveProjectAccess, cheapestUnlockingTier } from '../../lib/project-access'
import { publishedTitlerCache } from '../../lib/chapter-numbering'

const feedRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // FEED & READING PROGRESS ROUTES
  // ============================================================================

  // Get user's feed - recent publications from followed authors
  fastify.get<{
    Params: { userId: string }
    Querystring: { limit?: string; offset?: string }
  }>('/users/:userId/feed', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      if (!requireSelf(request, reply, userId)) return

      const limit = Math.min(parseInt(request.query.limit || '20', 10), 100)
      const offset = parseInt(request.query.offset || '0', 10)

      // Followed authors and projects, with the viewer's mute list. A muted
      // project stays out of the feed even when it arrives via an author follow.
      const [following, followedProjects] = await Promise.all([
        db.select({ followingId: userFollowers.followingId })
          .from(userFollowers)
          .where(eq(userFollowers.followerId, userId)),
        db.select({ projectId: projectFollows.projectId, muted: projectFollows.muted })
          .from(projectFollows)
          .where(eq(projectFollows.followerId, userId)),
      ])

      const followingIds = following.map(f => f.followingId)
      const mutedProjectIds = followedProjects.filter(f => f.muted).map(f => f.projectId)
      const followedProjectIds = followedProjects.filter(f => !f.muted).map(f => f.projectId)

      if (followingIds.length === 0 && followedProjectIds.length === 0) {
        return reply.status(200).send({ feed: [], total: 0 })
      }

      // Candidate projects: followed directly or via their author; live, not
      // archived or trashed, not muted.
      const followConditions = []
      if (followingIds.length > 0) followConditions.push(inArray(projects.ownerId, followingIds))
      if (followedProjectIds.length > 0) followConditions.push(inArray(projects.id, followedProjectIds))

      const candidates = await db
        .select({
          id: projects.id,
          ownerId: projects.ownerId,
          projectVisibility: projectPublishConfig.projectVisibility,
          defaultVisibility: projectPublishConfig.defaultVisibility,
        })
        .from(projects)
        .innerJoin(projectPublishConfig, eq(projectPublishConfig.projectId, projects.id))
        .where(and(
          or(...followConditions),
          // Reader side: the viewer's own work never shows up in their feed.
          ne(projects.ownerId, userId),
          eq(projectPublishConfig.publishingMode, 'live'),
          eq(projects.isArchived, false),
          isNull(projects.deletedAt),
          mutedProjectIds.length > 0 ? notInArray(projects.id, mutedProjectIds) : undefined,
        ))

      // Batch access resolution: private projects the viewer cannot enter and
      // subscribers-only projects with no way to subscribe drop out here.
      const access = await resolveProjectAccess(userId, candidates)
      const privilegedIds: string[] = []
      const subscribedByDays = new Map<number, string[]>()   // viewer's tier early-access days -> projects
      const lockedByMaxDays = new Map<number, string[]>()    // subscribers-only, viewer not entitled
      const teaserByMaxDays = new Map<number, string[]>()    // public, author sells early access
      const plainIds: string[] = []                          // public, nothing to sell
      const grantedChapterIds = new Set<string>()
      const group = (m: Map<number, string[]>, days: number, id: string) => {
        const list = m.get(days) ?? []
        list.push(id)
        m.set(days, list)
      }
      for (const p of candidates) {
        const a = access.get(p.id)!
        if (a.status !== 'ok' && a.status !== 'subscribers_only') continue
        for (const c of a.grantedChapterIds) grantedChapterIds.add(c)
        // Chapter-scoped grants only: those chapters and nothing else.
        if (a.grantOnly) continue
        const maxDays = a.tiers.reduce((m, t) => Math.max(m, t.earlyAccessDays), 0)
        if (a.privileged) privilegedIds.push(p.id)
        else if (a.subscriberEarlyAccessDays !== null) group(subscribedByDays, a.subscriberEarlyAccessDays, p.id)
        else if (a.status === 'subscribers_only') group(lockedByMaxDays, maxDays, p.id)
        else if (a.acceptsSubscriptions && a.tiers.length > 0) group(teaserByMaxDays, maxDays, p.id)
        else plainIds.push(p.id)
      }

      // Per-viewer visibility, one SQL lane per audience. A scheduled chapter has
      // publishedAt = publicReleaseDate = its release date, and a subscriber reads
      // it from publishedAt - earlyAccessDays (`tierAccess` in lib/chapter-access;
      // the SQL below is the same arithmetic, and cheapestUnlockingTier re-applies
      // tierAccess itself per item):
      //  - owner / beta reader / project-wide grantee: once publishedAt has passed
      //  - subscriber: from publishedAt - their tier's days
      //  - everyone else, author sells subscriptions: a teaser from publishedAt -
      //    (the author's longest early-access window), i.e. once some tier opens
      //    it; before that it is hidden. Past the public release it is just readable.
      //  - everyone else, nothing to sell: readable once published and released.
      // `visibleFrom` is when the chapter became visible to this viewer; the feed
      // sorts on it, so an early-access chapter does not sit above work that has
      // been readable for days. For a chapter still in the future that is its
      // access date (publishedAt - days). One already past publishedAt sorts by
      // publishedAt: we cannot know when it was scheduled, and subtracting the
      // window from every old chapter would sink it below newer ones. The cost
      // is that an early-access chapter moves up to its release date when the
      // release arrives.
      const pubAt = chapterPublications.publishedAt
      const accessDate = (days: number) => sql`(${pubAt} - (${days}::int * INTERVAL '1 day'))`
      const visibleKey = (days: number) => sql`CASE WHEN ${pubAt} <= NOW() THEN ${pubAt} ELSE ${accessDate(days)} END`
      const lanes: Array<{ where: SQL | undefined; from: SQL; ids: string[] }> = []
      if (privilegedIds.length > 0) {
        lanes.push({ ids: privilegedIds, from: sql`${pubAt}`, where: sql`${pubAt} <= NOW()` })
      }
      for (const [days, ids] of subscribedByDays) {
        lanes.push({ ids, from: visibleKey(days), where: sql`${accessDate(days)} <= NOW()` })
      }
      for (const [days, ids] of [...lockedByMaxDays, ...teaserByMaxDays]) {
        lanes.push({ ids, from: visibleKey(days), where: sql`${accessDate(days)} <= NOW()` })
      }
      if (plainIds.length > 0) {
        lanes.push({
          ids: plainIds,
          from: sql`GREATEST(${pubAt}, COALESCE(${chapterPublications.publicReleaseDate}, ${pubAt}))`,
          where: sql`${pubAt} <= NOW() AND (${chapterPublications.publicReleaseDate} IS NULL OR ${chapterPublications.publicReleaseDate} <= NOW())`,
        })
      }

      const grantedList = [...grantedChapterIds]
      const chapterVisibility = lanes.map(l => and(inArray(chapterPublications.projectId, l.ids), l.where))
      if (grantedList.length > 0) chapterVisibility.push(and(inArray(chapterPublications.chapterId, grantedList), sql`${pubAt} <= NOW()`))
      if (chapterVisibility.length === 0) {
        return reply.status(200).send({ feed: [], total: 0 })
      }
      const visibleFrom = lanes.length > 0
        ? sql`CASE ${sql.join(lanes.map(l => sql`WHEN ${inArray(chapterPublications.projectId, l.ids)} THEN ${l.from}`), sql` `)} ELSE ${pubAt} END`
        : sql`${pubAt}`

      const lockedSet = new Set([...lockedByMaxDays.values()].flat())
      const teaserSet = new Set([...teaserByMaxDays.values()].flat())

      // Recent published chapters, with titles and author profiles joined in
      // (trashed chapters drop out via the entities join).
      const feedItems = await db
        .select({
          publicationId: chapterPublications.id,
          projectId: chapterPublications.projectId,
          chapterId: chapterPublications.chapterId,
          publishedAt: chapterPublications.publishedAt,
          publicReleaseDate: chapterPublications.publicReleaseDate,
          projectName: projects.name,
          projectCoverImage: projects.coverImage,
          projectShortUrl: projects.shortUrl,
          authorId: projects.ownerId,
          rawTitle: sql<string | null>`${entities.entityData}->>'title'`,
          authorDisplayName: userProfiles.displayName,
          authorUsername: userProfiles.username,
        })
        .from(chapterPublications)
        .innerJoin(projects, eq(projects.id, chapterPublications.projectId))
        .innerJoin(entities, and(eq(entities.id, chapterPublications.chapterId), notDeleted()))
        .leftJoin(userProfiles, eq(userProfiles.userId, projects.ownerId))
        .where(and(
          or(...chapterVisibility),
          eq(chapterPublications.isPublished, true),
          isNotNull(pubAt),
        ))
        .orderBy(desc(visibleFrom), desc(pubAt))
        .limit(limit)
        .offset(offset)

      // Automatic chapter numbering, as the public TOC shows it.
      const titlerFor = publishedTitlerCache()
      const now = new Date()

      const feedWithTitles = await Promise.all(
        feedItems.map(async ({ rawTitle, authorDisplayName, authorUsername, ...item }) => {
          const publicReleaseDate = item.publicReleaseDate
          let chapterTitle = rawTitle || 'Untitled'
          try {
            chapterTitle = (await titlerFor(item.projectId)).titleOf(item.chapterId, chapterTitle)
          } catch {}

          const granted = grantedChapterIds.has(item.chapterId)
          const publiclyReadable = item.publishedAt! <= now && (!publicReleaseDate || publicReleaseDate <= now)
          const locked = !granted && (lockedSet.has(item.projectId) || (teaserSet.has(item.projectId) && !publiclyReadable))
          // Cheapest active tier that opens this chapter right now.
          const tier = locked ? cheapestUnlockingTier(access.get(item.projectId)!.tiers, item.publishedAt!, now) : null

          return {
            ...item,
            chapterTitle,
            authorName: authorDisplayName || authorUsername || 'Unknown Author',
            authorUsername: authorUsername ?? null,
            locked,
            upsell: tier ? { tierId: tier.id, tierName: tier.name, priceMonthly: tier.priceMonthly } : null,
          }
        })
      )

      return reply.status(200).send({ feed: feedWithTitles })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch feed' })
    }
  })

  // Get reading progress - recent incomplete chapter views
  // Uses JOINs to resolve chapter titles and project info in a single query
  fastify.get<{
    Params: { userId: string }
    Querystring: { limit?: string }
  }>('/users/:userId/reading-progress', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      if (!requireSelf(request, reply, userId)) return

      const limit = Math.min(parseInt(request.query.limit || '20', 10), 50)

      // Use a single query with JOINs to get progress + chapter + project data
      // Use DISTINCT ON to deduplicate by chapterId (keeping most recent view)
      const progressItems = await db
        .select({
          viewId: chapterViews.id,
          chapterId: chapterViews.chapterId,
          lastPositionPercent: chapterViews.lastPositionPercent,
          readTimeSeconds: chapterViews.readTimeSeconds,
          startedAt: chapterViews.startedAt,
          chapterTitle: sql<string>`COALESCE(${entities.entityData}->>'title', 'Untitled')`,
          projectId: entities.projectId,
          projectName: sql<string>`COALESCE(${projects.name}, 'Unknown Project')`,
          projectShortUrl: projects.shortUrl,
          authorId: projects.ownerId
        })
        .from(chapterViews)
        .innerJoin(entities, and(eq(entities.id, chapterViews.chapterId), notDeleted()))
        .innerJoin(projects, eq(projects.id, entities.projectId))
        .where(and(
          eq(chapterViews.readerId, userId),
          isNull(chapterViews.completedAt),
          // Reader side: the viewer's own work is not "continue reading".
          ne(projects.ownerId, userId)
        ))
        .orderBy(desc(chapterViews.startedAt))

      // Deduplicate by chapterId in application, keeping most recent per chapter
      const seen = new Set<string>()
      const deduplicated = progressItems.filter(item => {
        if (seen.has(item.chapterId)) return false
        seen.add(item.chapterId)
        return true
      }).slice(0, limit)

      // Batch-resolve author usernames for all unique author IDs
      const authorIds = [...new Set(deduplicated.map(p => p.authorId).filter(Boolean))]
      const authorMap: Record<string, string> = {}

      if (authorIds.length > 0) {
        const authorProfiles = await db
          .select({
            userId: userProfiles.userId,
            username: userProfiles.username
          })
          .from(userProfiles)
          .where(sql`${userProfiles.userId} IN ${authorIds}`)

        for (const profile of authorProfiles) {
          if (profile.username) {
            authorMap[profile.userId] = profile.username
          }
        }
      }

      const titlerFor = publishedTitlerCache()
      const numberedTitles = await Promise.all(
        deduplicated.map(async item => item.projectId
          ? (await titlerFor(item.projectId)).titleOf(item.chapterId, item.chapterTitle)
          : item.chapterTitle)
      )

      const enriched = deduplicated.map((item, i) => ({
        viewId: item.viewId,
        chapterId: item.chapterId,
        lastPositionPercent: item.lastPositionPercent,
        readTimeSeconds: item.readTimeSeconds,
        startedAt: item.startedAt,
        chapterTitle: numberedTitles[i]!,
        projectId: item.projectId,
        projectName: item.projectName,
        projectShortUrl: item.projectShortUrl,
        authorUsername: item.authorId ? (authorMap[item.authorId] || null) : null
      }))

      return reply.status(200).send({ progress: enriched })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch reading progress' })
    }
  })
}

export default feedRoutes
