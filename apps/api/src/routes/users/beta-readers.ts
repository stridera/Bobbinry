/** Beta reader management. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { userProfiles, betaReaders, projects, projectPublishConfig, users, chapterPublications } from '../../db/schema'
import { eq, and, or, isNull, count, isNotNull, inArray } from 'drizzle-orm'
import { requireAuth, requireSelf } from '../../middleware/auth'
import { isUuid as isValidUUID } from '../../lib/slugs'

const betaReadersRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // BETA READER ROUTES
  // ============================================================================

  // Get beta readers for an author (own beta readers only)
  fastify.get<{
    Params: { userId: string }
    Querystring: { projectId?: string }
  }>('/users/:userId/beta-readers', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const { projectId } = request.query

      // Verify user is accessing their own beta readers
      if (!requireSelf(request, reply, userId)) return

      if (projectId && !isValidUUID(projectId)) {
        return reply.status(400).send({ error: 'Invalid project ID format' })
      }

      const whereConditions = projectId
        ? and(
            eq(betaReaders.authorId, userId),
            or(
              eq(betaReaders.projectId, projectId),
              isNull(betaReaders.projectId)
            )
          )
        : eq(betaReaders.authorId, userId)

      const readers = await db
        .select({
          betaReader: betaReaders,
          user: {
            id: users.id,
            name: users.name,
            username: userProfiles.username
          }
        })
        .from(betaReaders)
        .leftJoin(users, eq(betaReaders.readerId, users.id))
        .leftJoin(userProfiles, eq(betaReaders.readerId, userProfiles.userId))
        .where(whereConditions)

      return reply.status(200).send({ betaReaders: readers })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch beta readers' })
    }
  })

  // Add beta reader (own beta readers only)
  fastify.post<{
    Params: { userId: string }
    Body: {
      readerId: string
      projectId?: string
      accessLevel?: 'beta' | 'arc' | 'early_access'
      notes?: string
    }
  }>('/users/:userId/beta-readers', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const { readerId, projectId, accessLevel = 'beta', notes } = request.body

      // Verify user is adding their own beta reader
      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(readerId)) {
        return reply.status(400).send({ error: 'Invalid reader ID format' })
      }

      if (projectId && !isValidUUID(projectId)) {
        return reply.status(400).send({ error: 'Invalid project ID format' })
      }

      // Check if already added
      const existing = await db
        .select()
        .from(betaReaders)
        .where(and(
          eq(betaReaders.authorId, userId),
          eq(betaReaders.readerId, readerId),
          projectId ? eq(betaReaders.projectId, projectId) : isNull(betaReaders.projectId)
        ))
        .limit(1)

      if (existing.length > 0) {
        return reply.status(400).send({ error: 'Beta reader already added' })
      }

      const [betaReader] = await db
        .insert(betaReaders)
        .values({
          authorId: userId,
          readerId,
          projectId: projectId || null,
          accessLevel,
          notes,
          isActive: true
        })
        .returning()

      return reply.status(201).send({ betaReader })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to add beta reader' })
    }
  })

  // Update beta reader (own beta readers only)
  fastify.put<{
    Params: { userId: string; betaReaderId: string }
    Body: {
      accessLevel?: 'beta' | 'arc' | 'early_access'
      notes?: string
      isActive?: boolean
    }
  }>('/users/:userId/beta-readers/:betaReaderId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId, betaReaderId } = request.params
      const updateData = request.body

      // Verify user is updating their own beta reader
      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(betaReaderId)) {
        return reply.status(400).send({ error: 'Invalid beta reader ID format' })
      }

      // Allow-list updatable fields. Without this, spreading `request.body`
      // straight into `set(...)` lets an attacker pass arbitrary keys
      // (authorId, readerId, projectId) and rewrite their own beta-reader row
      // to point at another author's project — gaining beta-reader access to
      // that project's paid chapters via checkPublicChapterAccess.
      const safeUpdate: Partial<typeof betaReaders.$inferInsert> = { updatedAt: new Date() }
      if (updateData.accessLevel !== undefined) safeUpdate.accessLevel = updateData.accessLevel
      if (updateData.notes !== undefined) safeUpdate.notes = updateData.notes
      if (updateData.isActive !== undefined) safeUpdate.isActive = updateData.isActive

      const [updated] = await db
        .update(betaReaders)
        .set(safeUpdate)
        .where(and(
          eq(betaReaders.id, betaReaderId),
          eq(betaReaders.authorId, userId)
        ))
        .returning()

      if (!updated) {
        return reply.status(404).send({ error: 'Beta reader not found' })
      }

      return reply.status(200).send({ betaReader: updated })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update beta reader' })
    }
  })

  // Remove beta reader (own beta readers only)
  fastify.delete<{
    Params: { userId: string; betaReaderId: string }
  }>('/users/:userId/beta-readers/:betaReaderId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId, betaReaderId } = request.params

      // Verify user is removing their own beta reader
      if (!requireSelf(request, reply, userId)) return

      if (!isValidUUID(betaReaderId)) {
        return reply.status(400).send({ error: 'Invalid beta reader ID format' })
      }

      const deleted = await db
        .delete(betaReaders)
        .where(and(
          eq(betaReaders.id, betaReaderId),
          eq(betaReaders.authorId, userId)
        ))
        .returning({ id: betaReaders.id })
      // Like PUT and invite revocation: a row the caller does not own is a 404,
      // not a success that deleted nothing.
      if (deleted.length === 0) {
        return reply.status(404).send({ error: 'Beta reader not found' })
      }

      return reply.status(200).send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to remove beta reader' })
    }
  })

  // Projects the user can read as a beta reader (own list only).
  // Author-wide grants only surface projects with a claimed shortUrl so an
  // "all projects" grant doesn't leak titles of private WIPs that were never
  // set up for reading.
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/beta-reading', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      if (!requireSelf(request, reply, userId)) return

      const grants = await db
        .select({
          projectId: betaReaders.projectId,
          authorId: betaReaders.authorId,
          accessLevel: betaReaders.accessLevel
        })
        .from(betaReaders)
        .where(and(
          eq(betaReaders.readerId, userId),
          eq(betaReaders.isActive, true)
        ))

      if (grants.length === 0) {
        return reply.status(200).send({ betaReading: [] })
      }

      const specificProjectIds = grants.filter(g => g.projectId).map(g => g.projectId!)
      const authorWideAuthorIds = [...new Set(grants.filter(g => !g.projectId).map(g => g.authorId))]

      const projectRows: {
        id: string
        name: string
        description: string | null
        coverImage: string | null
        shortUrl: string | null
        ownerId: string
      }[] = []

      if (specificProjectIds.length > 0) {
        projectRows.push(...await db
          .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            coverImage: projects.coverImage,
            shortUrl: projects.shortUrl,
            ownerId: projects.ownerId
          })
          .from(projects)
          .where(and(
            inArray(projects.id, specificProjectIds),
            isNull(projects.deletedAt)
          )))
      }

      if (authorWideAuthorIds.length > 0) {
        projectRows.push(...await db
          .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            coverImage: projects.coverImage,
            shortUrl: projects.shortUrl,
            ownerId: projects.ownerId
          })
          .from(projects)
          .where(and(
            inArray(projects.ownerId, authorWideAuthorIds),
            isNotNull(projects.shortUrl),
            isNull(projects.deletedAt)
          )))
      }

      // Dedupe (a project can match both a specific and an author-wide grant)
      const projectMap = new Map<string, typeof projectRows[number]>()
      for (const p of projectRows) projectMap.set(p.id, p)
      const uniqueProjects = [...projectMap.values()]

      if (uniqueProjects.length === 0) {
        return reply.status(200).send({ betaReading: [] })
      }

      const projectIds = uniqueProjects.map(p => p.id)
      const ownerIds = [...new Set(uniqueProjects.map(p => p.ownerId))]

      const [configs, chapterCounts, authorProfiles] = await Promise.all([
        db.select({
          projectId: projectPublishConfig.projectId,
          publishingMode: projectPublishConfig.publishingMode,
          projectVisibility: projectPublishConfig.projectVisibility
        })
          .from(projectPublishConfig)
          .where(inArray(projectPublishConfig.projectId, projectIds)),
        db.select({
          projectId: chapterPublications.projectId,
          count: count()
        })
          .from(chapterPublications)
          .where(and(
            inArray(chapterPublications.projectId, projectIds),
            eq(chapterPublications.isPublished, true)
          ))
          .groupBy(chapterPublications.projectId),
        db.select({
          userId: userProfiles.userId,
          username: userProfiles.username,
          displayName: userProfiles.displayName
        })
          .from(userProfiles)
          .where(inArray(userProfiles.userId, ownerIds))
      ])

      const modeByProject = new Map(configs.map(c => [c.projectId, c.publishingMode]))
      const visibilityByProject = new Map(configs.map(c => [c.projectId, c.projectVisibility]))
      const countByProject = new Map(chapterCounts.map(c => [c.projectId, Number(c.count)]))
      const profileByAuthor = new Map(authorProfiles.map(p => [p.userId, p]))
      const specificGrantByProject = new Map(
        grants.filter(g => g.projectId).map(g => [g.projectId!, g])
      )
      const authorWideLevelByAuthor = new Map(
        grants.filter(g => !g.projectId).map(g => [g.authorId, g.accessLevel])
      )

      const betaReading = uniqueProjects.map(p => {
        const specific = specificGrantByProject.get(p.id)
        const profile = profileByAuthor.get(p.ownerId)
        return {
          project: {
            id: p.id,
            name: p.name,
            description: p.description,
            coverImage: p.coverImage,
            shortUrl: p.shortUrl
          },
          author: {
            id: p.ownerId,
            username: profile?.username ?? null,
            displayName: profile?.displayName ?? null
          },
          accessLevel: specific?.accessLevel ?? authorWideLevelByAuthor.get(p.ownerId) ?? 'beta',
          isLive: modeByProject.get(p.id) === 'live',
          visibility: visibilityByProject.get(p.id) ?? 'public',
          publishedChapterCount: countByProject.get(p.id) ?? 0,
          authorWide: !specific
        }
      })

      betaReading.sort((a, b) => a.project.name.localeCompare(b.project.name))

      return reply.status(200).send({ betaReading })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch beta reading list' })
    }
  })
}

export default betaReadersRoutes
