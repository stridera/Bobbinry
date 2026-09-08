import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { eq, and, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '../../db/connection'
import { entities, users, userBadges, userProfiles } from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'

/**
 * Shared entity-type templates: public browsing (official + user-published),
 * fetch by shareId, publish validation, and author/admin-only soft-hide.
 */

const COLLECTION = 'shared_templates'
const BOBBIN_ID = 'entities'
const SCOPE = 'global'

describe('Templates API', () => {
  let app: any
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  afterEach(async () => { await cleanupAllTestData() })

  async function verifiedUser() {
    const user = await createTestUser()
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
    return { user, token: await createTestToken(user.id) }
  }

  /** Seed a shared_templates row directly, bypassing the publish handler. */
  async function seedTemplate(overrides: Record<string, any> = {}, userId: string | null = null) {
    const shareId = overrides.share_id ?? `tmpl-${nanoid(8)}`
    const entityData = {
      share_id: shareId,
      version: 1,
      label: 'Test Template',
      icon: '📋',
      description: '',
      tags: [],
      official: false,
      author_id: userId,
      author_name: 'Author',
      base_fields: ['name', 'description', 'image_url', 'tags'],
      versionable_base_fields: [],
      variant_axis: null,
      variant_inheritance: {},
      custom_fields: [{ name: 'power', type: 'number' }],
      editor_layout: null,
      list_layout: null,
      subtitle_fields: [],
      installs: 0,
      published_at: new Date().toISOString(),
      ...overrides,
      share_id: shareId,
    }
    const [row] = await db.insert(entities).values({
      bobbinId: BOBBIN_ID,
      collectionName: COLLECTION,
      scope: SCOPE,
      userId,
      entityData,
    }).returning()
    return { row: row!, entityData, shareId }
  }

  function listTemplates(query = '') {
    return app.inject({ method: 'GET', url: `/api/templates${query}` })
  }

  function getTemplate(shareId: string, token?: string) {
    return app.inject({
      method: 'GET',
      url: `/api/templates/${shareId}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  }

  function publishTemplate(token: string, body: Record<string, unknown>) {
    return app.inject({
      method: 'POST', url: '/api/templates',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    })
  }

  function hideTemplate(token: string, shareId: string) {
    return app.inject({
      method: 'DELETE', url: `/api/templates/${shareId}`,
      headers: { authorization: `Bearer ${token}` },
    })
  }

  // --- 1. Listing ---

  describe('GET /api/templates', () => {
    it('lists an official template for an anonymous caller', async () => {
      await seedTemplate({ official: true, author_id: null, author_name: 'Bobbinry', label: 'Characters' })

      const res = await listTemplates()
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.templates).toHaveLength(1)
      expect(body.templates[0].label).toBe('Characters')
      expect(body.templates[0].official).toBe(true)
      expect(body.total).toBe(1)
    })

    it('does not list a hidden template', async () => {
      await seedTemplate({ hidden: true, label: 'Hidden One' })

      const res = await listTemplates()
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.templates).toHaveLength(0)
      expect(body.total).toBe(0)
    })

    it('lists a non-hidden user-published template to anonymous callers too (no privacy flag exists)', async () => {
      const { user } = await verifiedUser()
      await seedTemplate({ label: 'Someone Elses Template' }, user.id)

      const res = await listTemplates()
      const body = JSON.parse(res.payload)
      expect(body.templates.map((t: any) => t.label)).toContain('Someone Elses Template')
    })

    it('does not list a row from a different collection/scope (e.g. an entity_type_definitions row)', async () => {
      await db.insert(entities).values({
        bobbinId: BOBBIN_ID,
        collectionName: 'entity_type_definitions',
        scope: 'project',
        entityData: { type_id: 'characters', label: 'Not A Template' },
      })

      const res = await listTemplates()
      const body = JSON.parse(res.payload)
      expect(body.templates).toHaveLength(0)
    })

    it('filters by tag', async () => {
      await seedTemplate({ label: 'Tagged', tags: ['rpg'] })
      await seedTemplate({ label: 'Untagged', tags: ['worldbuilding'] })

      const res = await listTemplates('?tag=rpg')
      const body = JSON.parse(res.payload)
      expect(body.templates).toHaveLength(1)
      expect(body.templates[0].label).toBe('Tagged')
    })

    it('filters by q against label and description', async () => {
      await seedTemplate({ label: 'Dragons', description: 'fire breathing' })
      await seedTemplate({ label: 'Swords', description: 'sharp metal' })

      const res = await listTemplates('?q=dragon')
      const body = JSON.parse(res.payload)
      expect(body.templates).toHaveLength(1)
      expect(body.templates[0].label).toBe('Dragons')
    })

    it('filters official=true and official=false', async () => {
      await seedTemplate({ official: true, author_id: null, author_name: 'Bobbinry', label: 'Official' })
      await seedTemplate({ official: false, label: 'Community' })

      const officialRes = JSON.parse((await listTemplates('?official=true')).payload)
      expect(officialRes.templates.map((t: any) => t.label)).toEqual(['Official'])

      const communityRes = JSON.parse((await listTemplates('?official=false')).payload)
      expect(communityRes.templates.map((t: any) => t.label)).toEqual(['Community'])
    })
  })

  // --- 2. Fetch by shareId ---

  describe('GET /api/templates/:shareId', () => {
    it('returns the template shape (id spread with entityData fields)', async () => {
      const { shareId, entityData, row } = await seedTemplate({ label: 'Fetchable' })

      const res = await getTemplate(shareId)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.id).toBe(row.id)
      expect(body.label).toBe('Fetchable')
      expect(body.share_id).toBe(entityData.share_id)
      expect(body.custom_fields).toEqual(entityData.custom_fields)
    })

    it('returns 404 with "Template not found" for an unknown shareId', async () => {
      const res = await getTemplate('does-not-exist')
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Template not found' })
    })

    // Hiding retracts a template from the gallery, not from the people who
    // already installed it — the hide handler's own comment says the data
    // stays resolvable, so a direct shareId fetch must keep working.
    it('still resolves a hidden template by direct shareId, so existing installs keep working', async () => {
      const { shareId } = await seedTemplate({ hidden: true, label: 'Hidden But Fetchable' })

      const res = await getTemplate(shareId)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.label).toBe('Hidden But Fetchable')
      expect(body.hidden).toBe(true)
    })

    it('passes through the stored version/official fields for an official template unchanged', async () => {
      const { shareId } = await seedTemplate({
        official: true, author_id: null, author_name: 'Bobbinry', version: 7, label: 'Characters',
      })

      const res = await getTemplate(shareId)
      const body = JSON.parse(res.payload)
      expect(body.version).toBe(7)
      expect(body.official).toBe(true)
    })
  })

  // --- 3. Publish/create ---

  describe('POST /api/templates', () => {
    it('rejects a missing label with 400 and the exact message', async () => {
      const { token } = await verifiedUser()
      const res = await publishTemplate(token, { custom_fields: [{ name: 'x' }] })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Label and custom_fields are required' })
    })

    it('rejects an empty-string label (falsy) with 400', async () => {
      const { token } = await verifiedUser()
      const res = await publishTemplate(token, { label: '', custom_fields: [{ name: 'x' }] })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('Label and custom_fields are required')
    })

    it('rejects a missing custom_fields with 400 and the exact message', async () => {
      const { token } = await verifiedUser()
      const res = await publishTemplate(token, { label: 'My Type' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Label and custom_fields are required' })
    })

    it('rejects a falsy custom_fields (0) with 400', async () => {
      const { token } = await verifiedUser()
      const res = await publishTemplate(token, { label: 'My Type', custom_fields: 0 })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('Label and custom_fields are required')
    })

    it('accepts an empty array custom_fields ([] is truthy) as the happy path', async () => {
      const { token } = await verifiedUser()
      const res = await publishTemplate(token, { label: 'Empty Fields', custom_fields: [] })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.custom_fields).toEqual([])
    })

    it('publishes with defaults for icon/description/tags/base_fields/etc and returns the shareId', async () => {
      const { user, token } = await verifiedUser()
      await db.insert(userProfiles).values({ userId: user.id, displayName: 'Elena Author' })

      const res = await publishTemplate(token, {
        label: 'Custom Beasts',
        custom_fields: [{ name: 'claws', type: 'number' }],
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)

      expect(body.share_id).toEqual(expect.any(String))
      expect(body.share_id).toHaveLength(8)
      expect(body.version).toBe(1)
      expect(body.label).toBe('Custom Beasts')
      expect(body.icon).toBe('📋')
      expect(body.description).toBe('')
      expect(body.tags).toEqual([])
      expect(body.official).toBe(false)
      expect(body.author_id).toBe(user.id)
      expect(body.author_name).toBe('Elena Author')
      expect(body.base_fields).toEqual(['name', 'description', 'image_url', 'tags'])
      expect(body.versionable_base_fields).toEqual([])
      expect(body.variant_axis).toBeNull()
      expect(body.variant_inheritance).toEqual({})
      expect(body.subtitle_fields).toEqual([])
      expect(body.installs).toBe(0)
      expect(body.published_at).toEqual(expect.any(String))

      // Row actually persisted with the same data.
      const persisted = await getTemplate(body.share_id)
      expect(JSON.parse(persisted.payload).id).toBe(body.id)
    })

    it('falls back to username, then "Unknown", for author_name when no profile / no displayName', async () => {
      const { user, token } = await verifiedUser()
      const res = await publishTemplate(token, { label: 'No Profile', custom_fields: [{ name: 'x' }] })
      const body = JSON.parse(res.payload)
      expect(body.author_name).toBe('Unknown')

      await db.insert(userProfiles).values({ userId: user.id, username: 'elena_writes' })
      const res2 = await publishTemplate(token, { label: 'With Username', custom_fields: [{ name: 'x' }] })
      const body2 = JSON.parse(res2.payload)
      expect(body2.author_name).toBe('elena_writes')
    })

    it('rejects an unauthenticated publish attempt', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/templates',
        payload: { label: 'No Auth', custom_fields: [{ name: 'x' }] },
      })
      expect(res.statusCode).toBe(401)
    })
  })

  // --- 4 & 5. Hide (soft-delete) ownership + jsonb merge ---

  describe('DELETE /api/templates/:shareId (soft-hide)', () => {
    it("lets the author hide their own template; row persists with hidden:true, not deleted", async () => {
      const { user, token } = await verifiedUser()
      const { shareId, row } = await seedTemplate({ label: 'Mine' }, user.id)

      const res = await hideTemplate(token, shareId)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ success: true, hidden: true })

      const persisted = await db.select().from(entities).where(eq(entities.id, row.id)).limit(1)
      expect(persisted).toHaveLength(1)
      expect(persisted[0]!.deletedAt).toBeNull()
      expect((persisted[0]!.entityData as any).hidden).toBe(true)
      // Original fields survive the merge.
      expect((persisted[0]!.entityData as any).label).toBe('Mine')

      // No longer surfaced by the public listing.
      const listRes = JSON.parse((await listTemplates()).payload)
      expect(listRes.templates).toHaveLength(0)
    })

    it("refuses another (non-admin) user's attempt with 403 and the exact message", async () => {
      const { user: author } = await verifiedUser()
      const { token: attackerToken } = await verifiedUser()
      const { shareId, row } = await seedTemplate({ label: 'Not Yours' }, author.id)

      const res = await hideTemplate(attackerToken, shareId)
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Not authorized to hide this template' })

      const persisted = await db.select().from(entities).where(eq(entities.id, row.id)).limit(1)
      expect((persisted[0]!.entityData as any).hidden).toBeUndefined()
    })

    it('lets a user with the owner badge hide someone else\'s non-official template', async () => {
      const { user: author } = await verifiedUser()
      const { user: admin, token: adminToken } = await verifiedUser()
      await db.insert(userBadges).values({ userId: admin.id, badge: 'owner' })
      const { shareId } = await seedTemplate({ label: 'Moderatable' }, author.id)

      const res = await hideTemplate(adminToken, shareId)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ success: true, hidden: true })
    })

    it('lets a user with the moderator badge hide someone else\'s non-official template', async () => {
      const { user: author } = await verifiedUser()
      const { user: mod, token: modToken } = await verifiedUser()
      await db.insert(userBadges).values({ userId: mod.id, badge: 'moderator' })
      const { shareId } = await seedTemplate({ label: 'Moderatable Too' }, author.id)

      const res = await hideTemplate(modToken, shareId)
      expect(res.statusCode).toBe(200)
    })

    it('ignores a revoked or expired moderator badge when authorizing a hide', async () => {
      const author = await createTestUser()
      const { shareId } = await seedTemplate({ author_id: author.id, label: 'Someone Else\'s' })

      for (const badgeRow of [
        { badge: 'moderator', isActive: false },
        { badge: 'owner', isActive: true, expiresAt: new Date(Date.now() - 60_000) },
      ]) {
        const stranger = await createTestUser()
        const token = await createTestToken(stranger.id)
        await db.insert(userBadges).values({ userId: stranger.id, ...badgeRow })

        const res = await hideTemplate(token, shareId)
        expect(res.statusCode).toBe(403)
        expect(JSON.parse(res.payload).error).toBe('Not authorized to hide this template')
      }
    })

    it('refuses to hide an official template even for an owner-badge admin, with 403', async () => {
      const { user: admin, token: adminToken } = await verifiedUser()
      await db.insert(userBadges).values({ userId: admin.id, badge: 'owner' })
      const { shareId } = await seedTemplate({ official: true, author_id: null, author_name: 'Bobbinry', label: 'Official' })

      const res = await hideTemplate(adminToken, shareId)
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Cannot hide official templates' })
    })

    it('returns 404 with "Template not found" for an unknown shareId', async () => {
      const { token } = await verifiedUser()
      const res = await hideTemplate(token, 'nope-nope')
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Template not found' })
    })

    it('rejects an unauthenticated hide attempt', async () => {
      const { shareId } = await seedTemplate({ label: 'Whatever' })
      const res = await app.inject({ method: 'DELETE', url: `/api/templates/${shareId}` })
      expect(res.statusCode).toBe(401)
    })
  })
})
