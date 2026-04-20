import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals'
import { eq, and, sql } from 'drizzle-orm'
import { db } from '../../db/connection'
import { entities, users } from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'

const COLLECTION = 'entity_type_definitions'
const BOBBIN_ID = 'entities'

/** Seed an entity_type_definitions row directly, bypassing the bobbin-install check. */
async function seedType(projectId: string, data: Record<string, any>) {
  const now = new Date().toISOString()
  const defaults = {
    type_id: 'characters',
    label: 'Characters',
    icon: '👤',
    template_id: null,
    template_version: null,
    base_fields: ['name', 'description', 'tags', 'image_url'],
    versionable_base_fields: [],
    custom_fields: [],
    editor_layout: {
      template: 'compact-card',
      imagePosition: 'top-right',
      imageSize: 'medium',
      headerFields: ['name'],
      sections: [],
    },
    list_layout: { display: 'grid', showFields: ['name'] },
    subtitle_fields: [],
    allow_duplicates: true,
    variant_axis: null,
    schema_version: 1,
    _field_history: [],
    created_at: now,
    updated_at: now,
  }
  const entityData = { ...defaults, ...data }
  const [row] = await db.insert(entities).values({
    id: crypto.randomUUID(),
    projectId,
    scope: 'project',
    bobbinId: BOBBIN_ID,
    collectionName: COLLECTION,
    entityData,
  }).returning()
  return { row: row!, entityData }
}

async function fetchType(projectId: string, typeId: string) {
  const rows = await db
    .select()
    .from(entities)
    .where(and(
      eq(entities.projectId, projectId),
      eq(entities.collectionName, COLLECTION),
      sql`${entities.entityData}->>'type_id' = ${typeId}`,
    ))
    .limit(1)
  return rows[0]
}

describe('Entity Types API — detach from template', () => {
  let app: any

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    await cleanupAllTestData()
  })

  describe('POST /api/projects/:projectId/entity-types/:typeId/detach', () => {
    let user: any
    let project: any
    let token: string

    beforeEach(async () => {
      user = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
      project = await createTestProject(user.id)
      token = await createTestToken(user.id)
    })

    it('clears template_id and template_version and returns was_linked: true', async () => {
      await seedType(project.id, {
        template_id: 'official-characters',
        template_version: 3,
      })

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/entity-types/characters/detach`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.payload)
      expect(body.detached).toBe(true)
      expect(body.was_linked).toBe(true)
      expect(body.previous_template_id).toBe('official-characters')
      expect(body.type.template_id).toBeNull()
      expect(body.type.template_version).toBeNull()

      const persisted = await fetchType(project.id, 'characters')
      const data = persisted!.entityData as Record<string, any>
      expect(data.template_id).toBeNull()
      expect(data.template_version).toBeNull()
    })

    it('preserves custom_fields, editor_layout, _field_history, schema_version', async () => {
      const customFields = [
        { name: 'power_level', type: 'number', label: 'Power', required: true },
        { name: 'origin', type: 'text', label: 'Origin' },
      ]
      const editorLayout = {
        template: 'hero-image',
        imagePosition: 'top-full-width',
        imageSize: 'large',
        headerFields: ['name', 'origin'],
        sections: [{ title: 'Stats', fields: ['power_level'], display: 'stacked' }],
      }
      const fieldHistory = [{
        version: 1,
        fields: [{ name: 'power_level', type: 'text', label: 'Power' }],
        versionable_base_fields: [],
        changedAt: '2025-01-01T00:00:00.000Z',
      }]
      await seedType(project.id, {
        template_id: 'official-characters',
        template_version: 2,
        custom_fields: customFields,
        editor_layout: editorLayout,
        _field_history: fieldHistory,
        schema_version: 4,
        versionable_base_fields: ['description'],
      })

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/entity-types/characters/detach`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(200)
      const persisted = await fetchType(project.id, 'characters')
      const data = persisted!.entityData as Record<string, any>
      expect(data.custom_fields).toEqual(customFields)
      expect(data.editor_layout).toEqual(editorLayout)
      expect(data._field_history).toEqual(fieldHistory)
      expect(data.schema_version).toBe(4)
      expect(data.versionable_base_fields).toEqual(['description'])
    })

    it('does not bump schema_version', async () => {
      await seedType(project.id, {
        template_id: 'official-characters',
        template_version: 1,
        schema_version: 7,
      })

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/entity-types/characters/detach`,
        headers: { authorization: `Bearer ${token}` },
      })

      const persisted = await fetchType(project.id, 'characters')
      const data = persisted!.entityData as Record<string, any>
      expect(data.schema_version).toBe(7)
    })

    it('is idempotent — second call returns was_linked: false', async () => {
      await seedType(project.id, {
        template_id: 'official-characters',
        template_version: 1,
      })

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/entity-types/characters/detach`,
        headers: { authorization: `Bearer ${token}` },
      })

      const second = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/entity-types/characters/detach`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(second.statusCode).toBe(200)
      const body = JSON.parse(second.payload)
      expect(body.detached).toBe(true)
      expect(body.was_linked).toBe(false)
      expect(body.previous_template_id).toBeNull()
      expect(body.type.template_id).toBeNull()
    })

    it('returns 404 when the type does not exist', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/entity-types/nonexistent/detach`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(404)
    })

    it('returns 401 without an auth token', async () => {
      await seedType(project.id, { template_id: 'official-characters', template_version: 1 })

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/entity-types/characters/detach`,
      })

      expect(response.statusCode).toBe(401)
    })

    it('returns 403 for a project the user does not own', async () => {
      const other = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, other.id))
      const otherProject = await createTestProject(other.id)
      await seedType(otherProject.id, {
        template_id: 'official-characters',
        template_version: 1,
      })

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${otherProject.id}/entity-types/characters/detach`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(response.statusCode).toBe(403)
    })

    it('acceptance: detach survives a subsequent sync-style PUT that omits template fields', async () => {
      // Create a template-linked type with a user customization
      await seedType(project.id, {
        template_id: 'official-characters',
        template_version: 2,
        custom_fields: [
          { name: 'power_level', type: 'number', label: 'Power' },
          { name: 'hometown', type: 'text', label: 'Hometown' },  // user-added
        ],
      })

      // Detach
      const detach = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/entity-types/characters/detach`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(detach.statusCode).toBe(200)

      // Simulate the sync job NOT running against detached types by asserting
      // that template_id / template_version remain null after a no-op PUT
      // (the UI's sync path would skip null template_id; we verify persistence)
      const noop = await app.inject({
        method: 'PUT',
        url: `/api/projects/${project.id}/entity-types/characters`,
        headers: { authorization: `Bearer ${token}` },
        payload: { label: 'Characters' },
      })
      expect(noop.statusCode).toBe(200)

      const persisted = await fetchType(project.id, 'characters')
      const data = persisted!.entityData as Record<string, any>
      expect(data.template_id).toBeNull()
      expect(data.template_version).toBeNull()
      expect(data.custom_fields).toHaveLength(2)
      expect(data.custom_fields[1].name).toBe('hometown')
    })
  })
})
