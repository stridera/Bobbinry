/**
 * Shared Entity Templates API
 *
 * Public browsing of published entity type templates.
 * Authenticated publish/unpublish for template authors.
 */

import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import { entities, userProfiles } from '../db/schema'
import { eq, and, sql, desc, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { requireAuth, optionalAuth } from '../middleware/auth'
import { userBadges } from '../db/schema'

const COLLECTION = 'shared_templates'
const BOBBIN_ID = 'entities'
const SCOPE = 'global'

const templatesPlugin: FastifyPluginAsync = async (fastify) => {

  // GET /templates — Browse/search published templates
  fastify.get<{
    Querystring: {
      q?: string
      tag?: string
      official?: string
      limit?: string
      offset?: string
    }
  }>('/templates', { preHandler: optionalAuth }, async (request, reply) => {
    try {
      const {
        q,
        tag,
        official,
        limit: limitStr = '50',
        offset: offsetStr = '0'
      } = request.query

      const limit = Math.min(Math.max(parseInt(limitStr) || 50, 1), 100)
      const offset = Math.max(parseInt(offsetStr) || 0, 0)

      let whereCondition = and(
        eq(entities.collectionName, COLLECTION),
        eq(entities.bobbinId, BOBBIN_ID),
        eq(entities.scope, SCOPE),
        // Exclude hidden (soft-deleted) templates
        or(
          sql`(${entities.entityData}->>'hidden')::boolean IS NOT TRUE`,
          sql`${entities.entityData}->>'hidden' IS NULL`
        )
      )!

      if (q) {
        const pattern = `%${q}%`
        whereCondition = and(
          whereCondition,
          or(
            sql`${entities.entityData}->>'label' ILIKE ${pattern}`,
            sql`${entities.entityData}->>'description' ILIKE ${pattern}`
          )
        )!
      }

      if (tag) {
        whereCondition = and(
          whereCondition,
          sql`${entities.entityData}->'tags' ? ${tag}`
        )!
      }

      if (official === 'true') {
        whereCondition = and(
          whereCondition,
          sql`(${entities.entityData}->>'official')::boolean = true`
        )!
      } else if (official === 'false') {
        whereCondition = and(
          whereCondition,
          or(
            sql`(${entities.entityData}->>'official')::boolean = false`,
            sql`${entities.entityData}->>'official' IS NULL`
          )
        )!
      }

      const [results, countResult] = await Promise.all([
        db
          .select()
          .from(entities)
          .where(whereCondition)
          .orderBy(
            sql`COALESCE((${entities.entityData}->>'official')::boolean, false) DESC`,
            sql`COALESCE((${entities.entityData}->>'installs')::int, 0) DESC`,
            desc(entities.createdAt)
          )
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)` })
          .from(entities)
          .where(whereCondition)
      ])

      const templates = results.map(row => ({
        id: row.id,
        ...(row.entityData as object),
      }))

      return {
        templates,
        total: Number(countResult[0]?.count || 0),
        hasMore: results.length >= limit,
      }
    } catch (error) {
      fastify.log.error(error, 'Failed to list templates')
      return reply.status(500).send({ error: 'Failed to list templates' })
    }
  })

  // GET /templates/:shareId — Get a single template
  fastify.get<{
    Params: { shareId: string }
  }>('/templates/:shareId', { preHandler: optionalAuth }, async (request, reply) => {
    try {
      const { shareId } = request.params

      const result = await db
        .select()
        .from(entities)
        .where(and(
          eq(entities.collectionName, COLLECTION),
          eq(entities.bobbinId, BOBBIN_ID),
          sql`${entities.entityData}->>'share_id' = ${shareId}`
        ))
        .limit(1)

      if (result.length === 0) {
        return reply.status(404).send({ error: 'Template not found' })
      }

      return {
        id: result[0]!.id,
        ...(result[0]!.entityData as object),
      }
    } catch (error) {
      fastify.log.error(error, 'Failed to get template')
      return reply.status(500).send({ error: 'Failed to get template' })
    }
  })

  // POST /templates — Publish an entity type as a shared template
  fastify.post<{
    Body: {
      label: string
      icon: string
      description: string
      tags: string[]
      custom_fields: any[]
      editor_layout: any
      list_layout: any
      subtitle_fields: string[]
      base_fields?: string[]
      versionable_base_fields?: string[]
    }
  }>('/templates', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const user = (request as any).user
      const body = request.body

      if (!body.label || !body.custom_fields) {
        return reply.status(400).send({ error: 'Label and custom_fields are required' })
      }

      // Get author display name
      const profile = await db
        .select({ username: userProfiles.username, displayName: userProfiles.displayName })
        .from(userProfiles)
        .where(eq(userProfiles.userId, user.id))
        .limit(1)

      const authorName = profile[0]?.displayName || profile[0]?.username || 'Unknown'

      const shareId = nanoid(8)

      const templateData = {
        share_id: shareId,
        version: 1,
        label: body.label,
        icon: body.icon || '📋',
        description: body.description || '',
        tags: body.tags || [],
        official: false,
        author_id: user.id,
        author_name: authorName,
        base_fields: body.base_fields || ['name', 'description', 'image_url', 'tags'],
        versionable_base_fields: body.versionable_base_fields || [],
        custom_fields: body.custom_fields,
        editor_layout: body.editor_layout,
        list_layout: body.list_layout,
        subtitle_fields: body.subtitle_fields || [],
        installs: 0,
        published_at: new Date().toISOString(),
      }

      const result = await db
        .insert(entities)
        .values({
          bobbinId: BOBBIN_ID,
          collectionName: COLLECTION,
          scope: SCOPE,
          userId: user.id,
          entityData: templateData,
        })
        .returning({ id: entities.id })

      return {
        id: result[0]!.id,
        ...templateData,
      }
    } catch (error) {
      fastify.log.error(error, 'Failed to publish template')
      return reply.status(500).send({ error: 'Failed to publish template' })
    }
  })

  // DELETE /templates/:shareId — Soft-hide a template (author or admin only)
  // Template data persists so existing installs/syncs continue working.
  fastify.delete<{
    Params: { shareId: string }
  }>('/templates/:shareId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const user = (request as any).user
      const { shareId } = request.params

      const result = await db
        .select()
        .from(entities)
        .where(and(
          eq(entities.collectionName, COLLECTION),
          eq(entities.bobbinId, BOBBIN_ID),
          sql`${entities.entityData}->>'share_id' = ${shareId}`
        ))
        .limit(1)

      if (result.length === 0) {
        return reply.status(404).send({ error: 'Template not found' })
      }

      const template = result[0]!
      const templateData = template.entityData as any

      if (templateData.official) {
        return reply.status(403).send({ error: 'Cannot hide official templates' })
      }

      // Check if user is the author or an admin (owner badge)
      const isAuthor = templateData.author_id === user.id
      let isAdmin = false
      if (!isAuthor) {
        const badges = await db
          .select({ badge: userBadges.badge })
          .from(userBadges)
          .where(eq(userBadges.userId, user.id))
        isAdmin = badges.some(b => b.badge === 'owner' || b.badge === 'moderator')
      }

      if (!isAuthor && !isAdmin) {
        return reply.status(403).send({ error: 'Not authorized to hide this template' })
      }

      // Soft-hide: set hidden flag, data remains for existing installs
      await db
        .update(entities)
        .set({
          entityData: sql`${entities.entityData} || '{"hidden": true}'::jsonb`,
        })
        .where(eq(entities.id, template.id))

      return { success: true, hidden: true }
    } catch (error) {
      fastify.log.error(error, 'Failed to hide template')
      return reply.status(500).send({ error: 'Failed to hide template' })
    }
  })
}

export default templatesPlugin
