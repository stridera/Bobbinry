/**
 * Entity Type Definitions API
 *
 * First-class CRUD endpoints for the `entity_type_definitions` collection.
 * Type defs are the schemas that define custom entity types (e.g. "characters",
 * "spells") within a project. Under the hood they're rows in the generic
 * `entities` table — these endpoints wrap that with proper validation,
 * server-side type_id uniqueness, and schema_version bumping.
 */

import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../db/connection'
import { entities } from '../db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { requireAuth, requireProjectOwnership, requireScope } from '../middleware/auth'
import { getEffectiveBobbins, getCollectionIdsForProject, buildScopeCondition } from '../lib/effective-bobbins'

const COLLECTION = 'entity_type_definitions'
const BOBBIN_ID = 'entities'

const TYPE_ID_RE = /^[a-z][a-z0-9_]{0,63}$/
const FIELD_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/

const FIELD_TYPES = ['text', 'number', 'select', 'multi-select', 'boolean', 'date', 'json', 'rich-text', 'image', 'relation'] as const

const FieldDefinitionSchema = z.object({
  name: z.string().regex(FIELD_NAME_RE, 'Invalid field name'),
  type: z.enum(FIELD_TYPES),
  label: z.string().min(1).max(200),
  required: z.boolean().optional(),
  default: z.any().optional(),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  multiline: z.boolean().optional(),
  schema: z.any().optional(),
  targetEntityType: z.string().optional(),
  allowMultiple: z.boolean().optional(),
  versionable: z.boolean().optional(),
}).passthrough()

const VariantAxisSchema = z.object({
  id: z.string().regex(FIELD_NAME_RE, 'Invalid axis id'),
  label: z.string().min(1).max(200),
  kind: z.enum(['ordered', 'unordered']),
}).passthrough()

const LayoutSectionSchema = z.object({
  title: z.string(),
  fields: z.array(z.string()),
  display: z.enum(['inline', 'stacked', 'json-editor', 'rich-text']),
}).passthrough()

const EditorLayoutSchema = z.object({
  template: z.enum(['compact-card', 'hero-image', 'list-details', 'custom']),
  imagePosition: z.enum(['top-right', 'top-full-width', 'left-sidebar', 'none']),
  imageSize: z.enum(['small', 'medium', 'large']),
  headerFields: z.array(z.string()),
  sections: z.array(LayoutSectionSchema),
}).passthrough()

const ListLayoutSchema = z.object({
  display: z.enum(['grid', 'list']),
  cardSize: z.enum(['small', 'medium', 'large']).optional(),
  showFields: z.array(z.string()),
}).passthrough()

const EntityTypeBodySchema = z.object({
  type_id: z.string().regex(TYPE_ID_RE, 'type_id must match /^[a-z][a-z0-9_]{0,63}$/'),
  label: z.string().min(1).max(200),
  icon: z.string().max(10).default('📋'),
  base_fields: z.array(z.string()).optional(),
  custom_fields: z.array(FieldDefinitionSchema),
  editor_layout: EditorLayoutSchema,
  list_layout: ListLayoutSchema,
  subtitle_fields: z.array(z.string()).optional(),
  allow_duplicates: z.boolean().optional(),
  template_id: z.string().nullable().optional(),
  template_version: z.number().nullable().optional(),
  variant_axis: VariantAxisSchema.nullable().optional(),
})

const UpdateBodySchema = EntityTypeBodySchema.partial().extend({
  // type_id is immutable on update — ignore if supplied
  type_id: z.string().optional(),
})

const ProjectParamsSchema = z.object({
  projectId: z.string().uuid('Invalid project ID format'),
})

const TypeParamsSchema = z.object({
  projectId: z.string().uuid('Invalid project ID format'),
  typeId: z.string().regex(TYPE_ID_RE, 'Invalid type_id'),
})

function formatTypeResponse(row: typeof entities.$inferSelect) {
  return {
    id: row.id,
    ...(row.entityData as object),
    _meta: {
      bobbinId: row.bobbinId,
      collection: row.collectionName,
      scope: row.scope,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  }
}

type FieldChangeSignature = { name: string; type: string; versionable?: boolean | undefined }

function detectFieldChanges(
  original: FieldChangeSignature[],
  updated: FieldChangeSignature[]
): boolean {
  const originalNames = new Set(original.map(f => f.name))
  const updatedNames = new Set(updated.map(f => f.name))
  for (const f of updated) {
    const o = original.find(x => x.name === f.name)
    if (o && o.type !== f.type) return true
    // Flipping the versionable flag is a schema change — entities saved under
    // the old definition may have data in places the new definition won't read.
    if (o && Boolean(o.versionable) !== Boolean(f.versionable)) return true
  }
  for (const f of updated) if (!originalNames.has(f.name)) return true
  for (const f of original) if (!updatedNames.has(f.name)) return true
  return false
}

function sendZodError(reply: any, error: z.ZodError) {
  return reply.status(400).send({
    error: 'Validation failed',
    issues: error.issues.map(issue => ({
      field: issue.path.join('.'),
      message: issue.message,
    })),
  })
}

const entityTypesPlugin: FastifyPluginAsync = async (fastify) => {

  // GET /projects/:projectId/entity-types — List all type defs for a project
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/entity-types', {
    preHandler: [requireAuth, requireScope('entities:read')],
  }, async (request, reply) => {
    try {
      const { projectId } = ProjectParamsSchema.parse(request.params)

      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)

      const rows = await db
        .select()
        .from(entities)
        .where(and(
          scopeFilter,
          eq(entities.collectionName, COLLECTION)
        ))
        .orderBy(sql`${entities.entityData}->>'label' ASC`)

      return {
        entityTypes: rows.map(formatTypeResponse),
        total: rows.length,
      }
    } catch (error) {
      if (error instanceof z.ZodError) return sendZodError(reply, error)
      fastify.log.error(error, 'Failed to list entity types')
      return reply.status(500).send({ error: 'Failed to list entity types' })
    }
  })

  // GET /projects/:projectId/entity-types/:typeId — Get a single type def
  fastify.get<{
    Params: { projectId: string; typeId: string }
  }>('/projects/:projectId/entity-types/:typeId', {
    preHandler: [requireAuth, requireScope('entities:read')],
  }, async (request, reply) => {
    try {
      const { projectId, typeId } = TypeParamsSchema.parse(request.params)

      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)

      const rows = await db
        .select()
        .from(entities)
        .where(and(
          scopeFilter,
          eq(entities.collectionName, COLLECTION),
          sql`${entities.entityData}->>'type_id' = ${typeId}`
        ))
        .limit(1)

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Entity type not found' })
      }

      return formatTypeResponse(rows[0]!)
    } catch (error) {
      if (error instanceof z.ZodError) return sendZodError(reply, error)
      fastify.log.error(error, 'Failed to get entity type')
      return reply.status(500).send({ error: 'Failed to get entity type' })
    }
  })

  // POST /projects/:projectId/entity-types — Create a type def
  fastify.post<{
    Params: { projectId: string }
    Body: z.infer<typeof EntityTypeBodySchema>
  }>('/projects/:projectId/entity-types', {
    preHandler: [requireAuth, requireScope('entities:write')],
  }, async (request, reply) => {
    try {
      const { projectId } = ProjectParamsSchema.parse(request.params)
      const body = EntityTypeBodySchema.parse(request.body)

      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)

      // Check the entities bobbin is installed for this project
      const effective = await getEffectiveBobbins(projectId, userId)
      const entitiesBobbin = effective.find(b => b.bobbinId === BOBBIN_ID)
      if (!entitiesBobbin) {
        return reply.status(400).send({ error: 'Entities bobbin is not installed for this project' })
      }

      // Server-side type_id uniqueness within project scope
      const existing = await db
        .select({ id: entities.id })
        .from(entities)
        .where(and(
          scopeFilter,
          eq(entities.collectionName, COLLECTION),
          sql`${entities.entityData}->>'type_id' = ${body.type_id}`
        ))
        .limit(1)

      if (existing.length > 0) {
        return reply.status(409).send({
          error: `An entity type with type_id "${body.type_id}" already exists in this project`,
        })
      }

      const now = new Date().toISOString()
      const entityData = {
        type_id: body.type_id,
        label: body.label,
        icon: body.icon ?? '📋',
        template_id: body.template_id ?? null,
        template_version: body.template_version ?? null,
        base_fields: body.base_fields ?? ['name', 'description', 'tags', 'image_url'],
        custom_fields: body.custom_fields,
        editor_layout: body.editor_layout,
        list_layout: body.list_layout,
        subtitle_fields: body.subtitle_fields ?? [],
        allow_duplicates: body.allow_duplicates ?? true,
        variant_axis: body.variant_axis ?? null,
        schema_version: 1,
        _field_history: [],
        created_at: now,
        updated_at: now,
      }

      const insertValues: Record<string, any> = {
        id: crypto.randomUUID(),
        bobbinId: BOBBIN_ID,
        collectionName: COLLECTION,
        entityData,
        scope: entitiesBobbin.scope,
      }

      if (entitiesBobbin.scope === 'project') {
        insertValues.projectId = projectId
      } else if (entitiesBobbin.scope === 'collection') {
        insertValues.collectionId = entitiesBobbin.scopeOwnerId
      } else {
        insertValues.userId = userId
      }

      const result = await db
        .insert(entities)
        .values(insertValues as any)
        .returning()

      return reply.status(201).send(formatTypeResponse(result[0]!))
    } catch (error) {
      if (error instanceof z.ZodError) return sendZodError(reply, error)
      fastify.log.error(error, 'Failed to create entity type')
      return reply.status(500).send({ error: 'Failed to create entity type' })
    }
  })

  // PUT /projects/:projectId/entity-types/:typeId — Update a type def
  fastify.put<{
    Params: { projectId: string; typeId: string }
    Body: Partial<z.infer<typeof EntityTypeBodySchema>>
  }>('/projects/:projectId/entity-types/:typeId', {
    preHandler: [requireAuth, requireScope('entities:write')],
  }, async (request, reply) => {
    try {
      const { projectId, typeId } = TypeParamsSchema.parse(request.params)
      const body = UpdateBodySchema.parse(request.body)

      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)

      const current = await db
        .select()
        .from(entities)
        .where(and(
          scopeFilter,
          eq(entities.collectionName, COLLECTION),
          sql`${entities.entityData}->>'type_id' = ${typeId}`
        ))
        .limit(1)

      if (current.length === 0) {
        return reply.status(404).send({ error: 'Entity type not found' })
      }

      const row = current[0]!
      const existingData = row.entityData as Record<string, any>

      // type_id is immutable
      const merged: Record<string, any> = {
        ...existingData,
        ...body,
        type_id: existingData.type_id,
        updated_at: new Date().toISOString(),
      }

      // Schema version bump on custom_fields change
      if (body.custom_fields) {
        const originalFields = (existingData.custom_fields || []) as Array<{ name: string; type: string }>
        const changed = detectFieldChanges(originalFields, body.custom_fields)
        const currentVersion: number = existingData.schema_version || 1
        if (changed) {
          const history = (existingData._field_history || []) as any[]
          merged._field_history = [
            ...history,
            {
              version: currentVersion,
              fields: originalFields,
              changedAt: new Date().toISOString(),
            },
          ]
          merged.schema_version = currentVersion + 1
        } else {
          merged.schema_version = currentVersion
        }
      }

      const newVersion = row.version + 1
      const result = await db
        .update(entities)
        .set({
          entityData: merged,
          version: newVersion,
          updatedAt: new Date(),
        })
        .where(and(
          eq(entities.id, row.id),
          eq(entities.version, row.version)
        ))
        .returning()

      if (result.length === 0) {
        return reply.status(409).send({ error: 'Conflict: entity type was modified concurrently' })
      }

      return formatTypeResponse(result[0]!)
    } catch (error) {
      if (error instanceof z.ZodError) return sendZodError(reply, error)
      fastify.log.error(error, 'Failed to update entity type')
      return reply.status(500).send({ error: 'Failed to update entity type' })
    }
  })

  // DELETE /projects/:projectId/entity-types/:typeId — Delete a type def
  // Note: this does NOT cascade — existing entities of this type remain but will
  // show as "unknown type" in the UI. Caller should decide whether to migrate
  // or delete them separately.
  fastify.delete<{
    Params: { projectId: string; typeId: string }
  }>('/projects/:projectId/entity-types/:typeId', {
    preHandler: [requireAuth, requireScope('entities:write')],
  }, async (request, reply) => {
    try {
      const { projectId, typeId } = TypeParamsSchema.parse(request.params)

      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      const userId = request.user!.id
      const collectionIds = await getCollectionIdsForProject(projectId)
      const scopeFilter = buildScopeCondition(projectId, collectionIds, userId)

      const rows = await db
        .select()
        .from(entities)
        .where(and(
          scopeFilter,
          eq(entities.collectionName, COLLECTION),
          sql`${entities.entityData}->>'type_id' = ${typeId}`
        ))
        .limit(1)

      if (rows.length === 0) {
        return reply.status(404).send({ error: 'Entity type not found' })
      }

      await db.delete(entities).where(eq(entities.id, rows[0]!.id))

      return { success: true, deleted: typeId }
    } catch (error) {
      if (error instanceof z.ZodError) return sendZodError(reply, error)
      fastify.log.error(error, 'Failed to delete entity type')
      return reply.status(500).send({ error: 'Failed to delete entity type' })
    }
  })
}

export default entityTypesPlugin
