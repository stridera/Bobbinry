/**
 * Author-side management of entity reader-URL slugs.
 * Read + manual override for the slug the public reader routes on
 * (see lib/slugs.ts for the wiki-style slug model).
 */

import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import { entities, entitySlugs } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { requireAuth, requireProjectOwnership } from '../middleware/auth'
import {
  claimSlugManually,
  getSlugAliases,
  resolveSlug,
  unpinSlug,
  UUID_RE,
} from '../lib/slugs'

const entitySlugsPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * Current slug + aliases for an entity (chapters included).
   */
  fastify.get<{
    Params: { projectId: string; entityId: string }
  }>('/projects/:projectId/entities/:entityId/slug', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { projectId, entityId } = request.params
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return
      if (!UUID_RE.test(entityId)) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      const [current] = await db
        .select({ slug: entitySlugs.slug, isPinned: entitySlugs.isPinned })
        .from(entitySlugs)
        .where(and(
          eq(entitySlugs.projectId, projectId),
          eq(entitySlugs.entityId, entityId),
          eq(entitySlugs.isCurrent, true)
        ))
        .limit(1)

      const aliases = await getSlugAliases(projectId, entityId)
      return reply.send({
        slug: current?.slug ?? null,
        isPinned: current?.isPinned ?? false,
        aliases
      })
    } catch (error) {
      fastify.log.error(error, 'Failed to load entity slug')
      return reply.status(500).send({ error: 'Failed to load slug' })
    }
  })

  /**
   * Manually set an entity's slug. Pinned by default so later renames
   * don't move it; pass pinned: false to keep it following the title.
   */
  fastify.put<{
    Params: { projectId: string; entityId: string }
    Body: { slug?: string; pinned?: boolean }
  }>('/projects/:projectId/entities/:entityId/slug', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { projectId, entityId } = request.params
      const { slug, pinned } = request.body || {}
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return
      if (!UUID_RE.test(entityId)) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      const [entityRow] = await db
        .select({ id: entities.id })
        .from(entities)
        .where(eq(entities.id, entityId))
        .limit(1)
      if (!entityRow) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      if (typeof slug !== 'string' || slug.trim() === '') {
        return reply.status(400).send({ error: 'slug is required' })
      }

      // Just toggling the pin on the already-current slug
      const resolved = await resolveSlug(projectId, slug.trim().toLowerCase())
      if (resolved?.entityId === entityId && resolved.requestedIsCurrent && pinned === false) {
        await unpinSlug(projectId, entityId)
        const aliases = await getSlugAliases(projectId, entityId)
        return reply.send({ slug: resolved.currentSlug, isPinned: false, aliases })
      }

      const result = await claimSlugManually(projectId, entityId, slug, pinned ?? true)
      if ('error' in result) {
        const status = result.error === 'taken' ? 409 : 400
        const message =
          result.error === 'taken' ? 'That slug is already in use by another chapter or entity'
          : result.error === 'reserved' ? 'That slug is reserved'
          : 'Slugs may only contain lowercase letters, numbers, and dashes'
        return reply.status(status).send({ error: message, code: result.error })
      }

      const aliases = await getSlugAliases(projectId, entityId)
      return reply.send({ slug: result.slug, isPinned: pinned ?? true, aliases })
    } catch (error) {
      fastify.log.error(error, 'Failed to set entity slug')
      return reply.status(500).send({ error: 'Failed to set slug' })
    }
  })
}

export default entitySlugsPlugin
