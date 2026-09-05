/** Slug-based lookup: author + project + chapter resolution. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { chapterPublications, projects, projectCollections, projectCollectionMemberships, projectPublishConfig, userProfiles, users } from '../../db/schema'
import { eq, and, desc, asc, sql, isNull, count, inArray } from 'drizzle-orm'
import { optionalAuth } from '../../middleware/auth'
import { resolveAuthor, resolveViewAs, canViewProject } from './shared'

const lookupRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================
  // SLUG-BASED LOOKUP
  // ============================================

  /**
   * Resolve a project slug to project details (public)
   */
  fastify.get<{
    Params: { slug: string }
  }>('/public/projects/by-slug/:slug', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = request.id
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

        if (!(await canViewProject(configMatch.id, request.user?.id))) {
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

      if (!(await canViewProject(project.id, request.user?.id))) {
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
  }>('/public/projects/by-slugs', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = request.id
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

      if (projectRows.length === 0) {
        return reply.send({ projects: [], correlationId })
      }

      // Drop private projects the requester can't view (visibility is checked
      // per row; only 'private' rows incur the access lookup).
      const configRows = await db
        .select({
          projectId: projectPublishConfig.projectId,
          projectVisibility: projectPublishConfig.projectVisibility
        })
        .from(projectPublishConfig)
        .where(inArray(projectPublishConfig.projectId, projectRows.map(r => r.projectId)))
      const visibilityByProject = new Map(configRows.map(c => [c.projectId, c.projectVisibility]))

      const visibleRows: typeof projectRows = []
      for (const row of projectRows) {
        if ((visibilityByProject.get(row.projectId) ?? 'public') !== 'private') {
          visibleRows.push(row)
        } else if (await canViewProject(row.projectId, request.user?.id)) {
          visibleRows.push(row)
        }
      }

      const results = visibleRows
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
    Querystring: { viewAs?: string }
  }>('/public/projects/by-author-and-slug/:username/:projectSlug', {
    preHandler: optionalAuth
  }, async (request, reply) => {
    const correlationId = request.id
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

      const viewer = await resolveViewAs(project.id, request.user?.id, request.query.viewAs)
      if (!(await canViewProject(project.id, viewer.userId, viewer.simulate))) {
        return reply.status(404).send({ error: 'Project not found', correlationId })
      }

      // Get project visibility setting
      const [projPublishConfig] = await db
        .select({
          defaultVisibility: projectPublishConfig.defaultVisibility,
          projectVisibility: projectPublishConfig.projectVisibility
        })
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
        shortUrl: string | null
        publishedProjectCount: number
      } | null = null

      const [collMatch] = await db
        .select({
          id: projectCollections.id,
          name: projectCollections.name,
          description: projectCollections.description,
          coverImage: projectCollections.coverImage,
          colorTheme: projectCollections.colorTheme,
          shortUrl: projectCollections.shortUrl,
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
            eq(projectPublishConfig.projectVisibility, 'public'),
            sql`EXISTS (SELECT 1 FROM ${chapterPublications} WHERE ${chapterPublications.projectId} = ${projects.id} AND ${chapterPublications.isPublished} = true)`
          ))

        const pubCount = Number(publishedCount?.count ?? 0)
        if (pubCount >= 2) {
          collectionInfo = { ...collMatch, publishedProjectCount: pubCount }
        }
      }

      return reply.send({
        project: {
          ...project,
          defaultVisibility: projPublishConfig?.defaultVisibility || 'public',
          projectVisibility: projPublishConfig?.projectVisibility || 'public'
        },
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
    const correlationId = request.id
    try {
      const { username } = request.params

      const author = await resolveAuthor(username)
      if (!author) {
        return reply.status(404).send({ error: 'Author not found', correlationId })
      }

      // Get published projects: live, publicly visible, with a shortUrl and at
      // least one published chapter (empty/unlisted/private projects stay off
      // the public author page).
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
          eq(projectPublishConfig.projectVisibility, 'public'),
          sql`${projects.shortUrl} IS NOT NULL`,
          isNull(projects.deletedAt),
          sql`EXISTS (SELECT 1 FROM ${chapterPublications} WHERE ${chapterPublications.projectId} = ${projects.id} AND ${chapterPublications.isPublished} = true)`
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
        shortUrl: string | null
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
            shortUrl: projectCollections.shortUrl,
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
              shortUrl: first.shortUrl,
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
}

export default lookupRoutes
