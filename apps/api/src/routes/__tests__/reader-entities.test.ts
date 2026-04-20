import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { bobbinsInstalled, entities, subscriptionTiers, subscriptions, users } from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'

const TYPE_COLLECTION = 'entity_type_definitions'

async function installEntitiesBobbin(projectId: string) {
  await db.insert(bobbinsInstalled).values({
    projectId,
    bobbinId: 'entities',
    scope: 'project',
    enabled: true,
    version: '1.0.0',
    manifestJson: { id: 'entities', name: 'entities', version: '1.0.0' },
  })
}

async function seedType(projectId: string, typeId: string, overrides: {
  isPublished?: boolean
  publishOrder?: number
  minimumTierLevel?: number
  label?: string
  icon?: string
} = {}) {
  const [row] = await db.insert(entities).values({
    id: crypto.randomUUID(),
    projectId,
    scope: 'project',
    bobbinId: 'entities',
    collectionName: TYPE_COLLECTION,
    entityData: {
      type_id: typeId,
      label: overrides.label ?? typeId,
      icon: overrides.icon ?? '📋',
      custom_fields: [],
      list_layout: { display: 'grid', showFields: ['name'] },
      editor_layout: { template: 'compact-card', imagePosition: 'top-right', imageSize: 'medium', headerFields: ['name'], sections: [] },
    },
    isPublished: overrides.isPublished ?? false,
    publishOrder: overrides.publishOrder ?? 0,
    minimumTierLevel: overrides.minimumTierLevel ?? 0,
  }).returning()
  return row!
}

async function seedEntity(projectId: string, typeId: string, name: string, overrides: {
  isPublished?: boolean
  publishOrder?: number
  minimumTierLevel?: number
} = {}) {
  const [row] = await db.insert(entities).values({
    id: crypto.randomUUID(),
    projectId,
    scope: 'project',
    bobbinId: 'entities',
    collectionName: typeId,
    entityData: { name },
    isPublished: overrides.isPublished ?? false,
    publishOrder: overrides.publishOrder ?? 0,
    minimumTierLevel: overrides.minimumTierLevel ?? 0,
  }).returning()
  return row!
}

async function seedActiveSubscription(subscriberId: string, authorId: string, tierLevel: number) {
  const [tier] = await db.insert(subscriptionTiers).values({
    authorId,
    name: `Tier ${tierLevel}`,
    tierLevel,
    earlyAccessDays: 0,
  }).returning()
  await db.insert(subscriptions).values({
    subscriberId,
    authorId,
    tierId: tier!.id,
    status: 'active',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  })
  return tier!
}

describe('Public Reader — Entities', () => {
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

  describe('GET /public/projects/:projectId/entities', () => {
    it('returns installed:false when the entities bobbin is not installed', async () => {
      const author = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, author.id))
      const project = await createTestProject(author.id)

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/entities`,
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.installed).toBe(false)
      expect(body.types).toEqual([])
    })

    it('returns published types + entities in publishOrder for an anonymous reader', async () => {
      const author = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, author.id))
      const project = await createTestProject(author.id)
      await installEntitiesBobbin(project.id)

      await seedType(project.id, 'races', { isPublished: true, publishOrder: 1, label: 'Races' })
      await seedType(project.id, 'characters', { isPublished: true, publishOrder: 0, label: 'Characters' })
      // Draft type — must not appear
      await seedType(project.id, 'spells', { isPublished: false, label: 'Spells' })

      const velka = await seedEntity(project.id, 'characters', 'Velka', { isPublished: true, publishOrder: 0 })
      const thorn = await seedEntity(project.id, 'characters', 'Thorn', { isPublished: true, publishOrder: 1 })
      // Draft entity — must not appear
      await seedEntity(project.id, 'characters', 'Draft Hero', { isPublished: false })
      const elves = await seedEntity(project.id, 'races', 'Elves', { isPublished: true })

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/entities`,
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.installed).toBe(true)
      expect(body.types.map((t: any) => t.typeId)).toEqual(['characters', 'races'])

      const chars = body.types[0]
      expect(chars.label).toBe('Characters')
      expect(chars.entities.map((e: any) => e.id)).toEqual([velka.id, thorn.id])

      const races = body.types[1]
      expect(races.entities.map((e: any) => e.id)).toEqual([elves.id])
    })

    it('hides tier-gated types and entities from anonymous readers but counts them in lockedPreviews', async () => {
      const author = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, author.id))
      const project = await createTestProject(author.id)
      await installEntitiesBobbin(project.id)

      await seedType(project.id, 'characters', { isPublished: true })
      // Section entirely gated at tier 1
      await seedType(project.id, 'spells', { isPublished: true, minimumTierLevel: 1 })

      await seedEntity(project.id, 'characters', 'Velka', { isPublished: true })
      await seedEntity(project.id, 'characters', 'Premium Character', { isPublished: true, minimumTierLevel: 1 })
      // In gated section — won't count separately since section is hidden
      await seedEntity(project.id, 'spells', 'Fireball', { isPublished: true })

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/entities`,
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)

      // Only characters is visible, spells is gated
      expect(body.types).toHaveLength(1)
      expect(body.types[0].typeId).toBe('characters')
      // The gated character within a visible section is hidden
      expect(body.types[0].entities.map((e: any) => e.name)).toEqual(['Velka'])

      expect(body.lockedPreviews.types).toBe(1)
      expect(body.lockedPreviews.entities).toBe(1)
    })

    it('lets active subscribers at the required tier see gated content', async () => {
      const author = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, author.id))
      const subscriber = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, subscriber.id))
      const project = await createTestProject(author.id)
      await installEntitiesBobbin(project.id)

      await seedActiveSubscription(subscriber.id, author.id, 1)

      await seedType(project.id, 'characters', { isPublished: true })
      await seedEntity(project.id, 'characters', 'Velka', { isPublished: true })
      await seedEntity(project.id, 'characters', 'Premium', { isPublished: true, minimumTierLevel: 1 })

      const token = await createTestToken(subscriber.id)
      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/entities`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      const names = body.types[0].entities.map((e: any) => e.name).sort()
      expect(names).toEqual(['Premium', 'Velka'])
      expect(body.lockedPreviews.entities).toBe(0)
    })

    it('grants the owner visibility regardless of publish/tier state', async () => {
      const author = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, author.id))
      const project = await createTestProject(author.id)
      await installEntitiesBobbin(project.id)

      await seedType(project.id, 'characters', { isPublished: true })
      await seedEntity(project.id, 'characters', 'Public', { isPublished: true })
      await seedEntity(project.id, 'characters', 'Tier5', { isPublished: true, minimumTierLevel: 5 })

      const token = await createTestToken(author.id)
      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/entities`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.types[0].entities).toHaveLength(2)
      expect(body.callerTierLevel).toBe(-1) // owner sentinel
    })
  })

  describe('GET /public/projects/:projectId/entities/published-names', () => {
    it('returns the EntityEntry-shaped list, tier-filtered', async () => {
      const author = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, author.id))
      const project = await createTestProject(author.id)
      await installEntitiesBobbin(project.id)

      await seedType(project.id, 'characters', { isPublished: true, label: 'Characters', icon: '👤' })
      await seedEntity(project.id, 'characters', 'Velka', { isPublished: true })
      await seedEntity(project.id, 'characters', 'Gated', { isPublished: true, minimumTierLevel: 1 })
      await seedEntity(project.id, 'characters', 'Draft', { isPublished: false })

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/entities/published-names`,
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.installed).toBe(true)
      expect(body.entities).toHaveLength(1)
      expect(body.entities[0]).toMatchObject({
        name: 'Velka',
        typeId: 'characters',
        typeLabel: 'Characters',
        typeIcon: '👤',
      })
    })

    it('returns installed:false when bobbin not installed', async () => {
      const author = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, author.id))
      const project = await createTestProject(author.id)

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/entities/published-names`,
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ installed: false, entities: [] })
    })
  })
})
