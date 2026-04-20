import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db/connection'
import { entities, subscriptionTiers, users } from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'

const TYPE_COLLECTION = 'entity_type_definitions'

async function seedType(projectId: string, typeId: string, overrides: Record<string, any> = {}) {
  const now = new Date().toISOString()
  const [row] = await db.insert(entities).values({
    id: crypto.randomUUID(),
    projectId,
    scope: 'project',
    bobbinId: 'entities',
    collectionName: TYPE_COLLECTION,
    entityData: {
      type_id: typeId,
      label: typeId,
      icon: '📋',
      base_fields: ['name', 'description'],
      custom_fields: [],
      editor_layout: { template: 'compact-card', imagePosition: 'top-right', imageSize: 'medium', headerFields: ['name'], sections: [] },
      list_layout: { display: 'grid', showFields: ['name'] },
      created_at: now,
      updated_at: now,
      ...overrides,
    },
  }).returning()
  return row!
}

async function seedEntity(projectId: string, typeId: string, name: string) {
  const [row] = await db.insert(entities).values({
    id: crypto.randomUUID(),
    projectId,
    scope: 'project',
    bobbinId: 'entities',
    collectionName: typeId,
    entityData: { name },
  }).returning()
  return row!
}

async function seedTier(authorId: string, tierLevel: number, name = `Tier ${tierLevel}`) {
  const [row] = await db.insert(subscriptionTiers).values({
    authorId,
    name,
    tierLevel,
    earlyAccessDays: 0,
  }).returning()
  return row!
}

describe('Entity Publish API', () => {
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

  describe('PATCH /entities/:entityId/publish', () => {
    let user: any
    let project: any
    let token: string
    let entity: any

    beforeEach(async () => {
      user = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
      project = await createTestProject(user.id)
      token = await createTestToken(user.id)
      await seedType(project.id, 'characters')
      entity = await seedEntity(project.id, 'characters', 'Velka')
    })

    it('flips isPublished and stamps publishedAt on first publish', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/entities/${entity.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { projectId: project.id, collection: 'characters', isPublished: true },
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.isPublished).toBe(true)
      expect(body.publishedAt).not.toBeNull()
    })

    it('does not overwrite publishedAt when republishing', async () => {
      const before = new Date(Date.now() - 60_000)
      await db.update(entities).set({ isPublished: false, publishedAt: before }).where(eq(entities.id, entity.id))

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/entities/${entity.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { projectId: project.id, collection: 'characters', isPublished: true },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(new Date(body.publishedAt).getTime()).toBe(before.getTime())
    })

    it('rejects minimumTierLevel that has no matching subscription tier', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/entities/${entity.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { projectId: project.id, collection: 'characters', minimumTierLevel: 5 },
      })
      expect(res.statusCode).toBe(400)
    })

    it('accepts minimumTierLevel that matches an existing tier', async () => {
      await seedTier(user.id, 2)
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/entities/${entity.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { projectId: project.id, collection: 'characters', minimumTierLevel: 2 },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).minimumTierLevel).toBe(2)
    })

    it('accepts minimumTierLevel: 0 without any tiers', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/entities/${entity.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { projectId: project.id, collection: 'characters', minimumTierLevel: 0 },
      })
      expect(res.statusCode).toBe(200)
    })

    it('403s non-owners', async () => {
      const otherUser = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, otherUser.id))
      const otherToken = await createTestToken(otherUser.id)
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/entities/${entity.id}/publish`,
        headers: { authorization: `Bearer ${otherToken}` },
        payload: { projectId: project.id, collection: 'characters', isPublished: true },
      })
      expect(res.statusCode).toBe(403)
    })

    it('requires at least one field in the body', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/entities/${entity.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { projectId: project.id, collection: 'characters' },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  describe('PATCH variant publishing', () => {
    let user: any
    let project: any
    let token: string
    let entity: any

    beforeEach(async () => {
      user = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
      project = await createTestProject(user.id)
      token = await createTestToken(user.id)
      await seedType(project.id, 'characters')
      // Seed an entity with two variants so we can exercise publish-by-variant
      const [row] = await db.insert(entities).values({
        id: crypto.randomUUID(),
        projectId: project.id,
        scope: 'project',
        bobbinId: 'entities',
        collectionName: 'characters',
        entityData: {
          name: 'Velka',
          _variants: {
            order: ['book1', 'book2'],
            items: {
              book1: { label: 'Book 1', overrides: { description: 'young' } },
              book2: { label: 'Book 2', overrides: { description: 'older' } },
            },
          },
        },
      }).returning()
      entity = row!
    })

    it('persists publishBase and publishedVariantIds', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/entities/${entity.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          projectId: project.id,
          collection: 'characters',
          isPublished: true,
          publishBase: false,
          publishedVariantIds: ['book1'],
        },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.publishBase).toBe(false)
      expect(body.publishedVariantIds).toEqual(['book1'])
    })

    it('rejects unknown variant ids', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/entities/${entity.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          projectId: project.id,
          collection: 'characters',
          publishedVariantIds: ['made-up'],
        },
      })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).unknown).toContain('made-up')
    })

    it('rejects publishing with neither base nor variants', async () => {
      // First publish the entity with base, then try to flip off base with no variants
      const prime = await app.inject({
        method: 'PATCH',
        url: `/api/entities/${entity.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          projectId: project.id,
          collection: 'characters',
          isPublished: true,
        },
      })
      expect(prime.statusCode).toBe(200)

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/entities/${entity.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          projectId: project.id,
          collection: 'characters',
          publishBase: false,
          publishedVariantIds: [],
        },
      })
      expect(res.statusCode).toBe(400)
    })

    it('allows publishing with only variants (base off)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/entities/${entity.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          projectId: project.id,
          collection: 'characters',
          isPublished: true,
          publishBase: false,
          publishedVariantIds: ['book1', 'book2'],
        },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.publishBase).toBe(false)
      expect(body.publishedVariantIds).toEqual(['book1', 'book2'])
    })
  })

  describe('PATCH /projects/:projectId/entity-types/:typeId/publish', () => {
    let user: any
    let project: any
    let token: string

    beforeEach(async () => {
      user = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
      project = await createTestProject(user.id)
      token = await createTestToken(user.id)
      await seedType(project.id, 'characters')
    })

    it('sets isPublished on the type-definition row', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${project.id}/entity-types/characters/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { isPublished: true, publishOrder: 3 },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.isPublished).toBe(true)
      expect(body.publishOrder).toBe(3)
    })

    it('404s unknown typeId', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${project.id}/entity-types/spells/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { isPublished: true },
      })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('POST /projects/:projectId/entities/reorder', () => {
    let user: any
    let project: any
    let token: string
    let a: any, b: any, c: any

    beforeEach(async () => {
      user = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
      project = await createTestProject(user.id)
      token = await createTestToken(user.id)
      await seedType(project.id, 'characters')
      a = await seedEntity(project.id, 'characters', 'Alice')
      b = await seedEntity(project.id, 'characters', 'Bob')
      c = await seedEntity(project.id, 'characters', 'Carol')
    })

    it('rewrites publish_order to match the array index', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/entities/reorder`,
        headers: { authorization: `Bearer ${token}` },
        payload: { collection: 'characters', orderedIds: [c.id, a.id, b.id] },
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).reordered).toBe(3)

      const rows = await db
        .select({ id: entities.id, publishOrder: entities.publishOrder })
        .from(entities)
        .where(eq(entities.projectId, project.id))
      const orders = Object.fromEntries(rows.map(r => [r.id, r.publishOrder]))
      expect(orders[c.id]).toBe(0)
      expect(orders[a.id]).toBe(1)
      expect(orders[b.id]).toBe(2)
    })

    it('400s when an id does not belong to this project/collection', async () => {
      const bogus = crypto.randomUUID()
      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/entities/reorder`,
        headers: { authorization: `Bearer ${token}` },
        payload: { collection: 'characters', orderedIds: [a.id, bogus] },
      })
      expect(res.statusCode).toBe(400)
      const body = JSON.parse(res.payload)
      expect(body.missing).toContain(bogus)
    })
  })

  describe('POST /projects/:projectId/entity-types/reorder', () => {
    let user: any
    let project: any
    let token: string

    beforeEach(async () => {
      user = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
      project = await createTestProject(user.id)
      token = await createTestToken(user.id)
      await seedType(project.id, 'characters')
      await seedType(project.id, 'races')
      await seedType(project.id, 'spells')
    })

    it('rewrites publish_order on type-def rows to match array index', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/entity-types/reorder`,
        headers: { authorization: `Bearer ${token}` },
        payload: { orderedTypeIds: ['spells', 'characters', 'races'] },
      })
      expect(res.statusCode).toBe(200)

      const rows = await db
        .select({ data: entities.entityData, publishOrder: entities.publishOrder })
        .from(entities)
        .where(and(
          eq(entities.projectId, project.id),
          eq(entities.collectionName, TYPE_COLLECTION),
        ))

      const byId: Record<string, number> = {}
      for (const r of rows) {
        const t = (r.data as Record<string, unknown>)?.type_id
        if (typeof t === 'string') byId[t] = r.publishOrder
      }
      expect(byId['spells']).toBe(0)
      expect(byId['characters']).toBe(1)
      expect(byId['races']).toBe(2)
    })

    it('400s with unknown typeIds', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/entity-types/reorder`,
        headers: { authorization: `Bearer ${token}` },
        payload: { orderedTypeIds: ['characters', 'nonexistent'] },
      })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).missing).toContain('nonexistent')
    })
  })
})
