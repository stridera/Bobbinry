import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { db } from '../../db/connection'
import {
  users,
  projects,
  entities,
  projectCollections,
  projectCollectionMemberships,
  userProfiles
} from '../../db/schema'
import { eq } from 'drizzle-orm'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData
} from '../../__tests__/test-helpers'

/**
 * Dashboard API: the author's project dashboard — project listing (flat and
 * grouped by collection), cross-project recent activity, aggregate stats,
 * archive/unarchive, short URLs, and trash lifecycle (soft delete / restore /
 * permanent delete). Covers apps/api/src/routes/dashboard.ts.
 */
describe('Dashboard API', () => {
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

  function inject(method: string, url: string, token?: string, payload?: unknown) {
    return app.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload
    })
  }

  async function createCollection(userId: string, overrides: { name?: string; deletedAt?: Date; updatedAt?: Date } = {}) {
    const [collection] = await db.insert(projectCollections).values({
      userId,
      name: overrides.name ?? 'Test Collection',
      deletedAt: overrides.deletedAt ?? null,
      updatedAt: overrides.updatedAt ?? new Date()
    }).returning()
    return collection!
  }

  async function addToCollection(projectId: string, collectionId: string, orderIndex = 0) {
    await db.insert(projectCollectionMemberships).values({ projectId, collectionId, orderIndex })
  }

  async function createEntity(projectId: string, overrides: {
    collectionName?: string
    lastEditedAt?: Date
    deletedAt?: Date | null
  } = {}) {
    const [entity] = await db.insert(entities).values({
      projectId,
      bobbinId: 'manuscript',
      collectionName: overrides.collectionName ?? 'content',
      entityData: { title: 'Untitled' },
      lastEditedAt: overrides.lastEditedAt ?? new Date(),
      deletedAt: overrides.deletedAt ?? null
    }).returning()
    return entity!
  }

  // ──────────────────────────────────────────
  // GET /api/dashboard/stats
  // ──────────────────────────────────────────

  describe('GET /api/dashboard/stats', () => {
    it('returns 401 without a token', async () => {
      const res = await inject('GET', '/api/dashboard/stats')
      expect(res.statusCode).toBe(401)
    })

    it('returns zeroed stats for a brand new user with no projects', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      const res = await inject('GET', '/api/dashboard/stats', token)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({
        stats: {
          projects: { total: '0', active: '0', archived: '0' },
          collections: { total: '0' },
          entities: { total: '0' },
          trashed: { total: '0' }
        }
      })
    })

    it('counts projects, collections, entities and trashed items precisely — and never another author\'s', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      // 2 active projects, 1 archived, 1 trashed
      const p1 = await createTestProject(user.id, { name: 'Active One' })
      const p2 = await createTestProject(user.id, { name: 'Active Two' })
      const p3 = await createTestProject(user.id, { name: 'Archived' })
      const p4 = await createTestProject(user.id, { name: 'Trashed' })
      await db.update(projects).set({ isArchived: true, archivedAt: new Date() }).where(eq(projects.id, p3.id))
      await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, p4.id))

      // 1 active collection, 1 trashed collection
      await createCollection(user.id, { name: 'Live Collection' })
      await createCollection(user.id, { name: 'Trashed Collection', deletedAt: new Date() })

      // Entities: 2 live content rows in p1 plus one entity_type_definitions
      // row (the project's schema, not authored content — not counted),
      // 1 soft-deleted in p1 (must not count), 1 live in p2, 1 live in the
      // archived project p3 (its project's own deletedAt is null, so it is
      // still in-scope for this aggregate even though p3 is archived).
      await createEntity(p1.id, { collectionName: 'content' })
      await createEntity(p1.id, { collectionName: 'content' })
      await createEntity(p1.id, { collectionName: 'entity_type_definitions' })
      await createEntity(p1.id, { collectionName: 'content', deletedAt: new Date() })
      await createEntity(p2.id, { collectionName: 'content' })
      await createEntity(p3.id, { collectionName: 'content' })
      // Entity inside the trashed project p4 — its project is excluded from
      // the projectIds lookup entirely, so this must not be reachable at all.
      await createEntity(p4.id, { collectionName: 'content' })

      // A second author with their own project/entities — must never leak in.
      const other = await createTestUser()
      const otherProject = await createTestProject(other.id)
      await createEntity(otherProject.id, { collectionName: 'content' })
      await createEntity(otherProject.id, { collectionName: 'content' })

      const res = await inject('GET', '/api/dashboard/stats', token)
      expect(res.statusCode).toBe(200)
      const { stats } = JSON.parse(res.payload)

      expect(stats.projects).toEqual({ total: '3', active: '2', archived: '1' })
      expect(stats.collections).toEqual({ total: '1' })
      expect(stats.entities).toEqual({ total: '4' })
      // trashed = trashed projects (1) + trashed collections (1); entities
      // are not part of this figure at all.
      expect(stats.trashed).toEqual({ total: '2' })

      // The other author's own stats are independent and unaffected.
      const otherToken = await createTestToken(other.id)
      const otherRes = await inject('GET', '/api/dashboard/stats', otherToken)
      const otherStats = JSON.parse(otherRes.payload).stats
      expect(otherStats.projects.total).toBe('1')
      expect(otherStats.entities.total).toBe('2')
    })
  })

  // ──────────────────────────────────────────
  // GET /api/users/me/projects
  // ──────────────────────────────────────────

  describe('GET /api/users/me/projects', () => {
    it('returns 401 without a token', async () => {
      const res = await inject('GET', '/api/users/me/projects')
      expect(res.statusCode).toBe(401)
    })

    it('returns an empty array for a user with no projects', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const res = await inject('GET', '/api/users/me/projects', token)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ projects: [] })
    })

    it('excludes archived and trashed projects by default, orders by updatedAt desc, and includes collection info', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      const collection = await createCollection(user.id, { name: 'Series A' })
      const older = await createTestProject(user.id, { name: 'Older' })
      const newer = await createTestProject(user.id, { name: 'Newer' })
      const archived = await createTestProject(user.id, { name: 'Archived' })
      const trashed = await createTestProject(user.id, { name: 'Trashed' })
      await addToCollection(older.id, collection.id)
      await db.update(projects).set({ updatedAt: new Date(Date.now() - 60_000) }).where(eq(projects.id, older.id))
      await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, newer.id))
      await db.update(projects).set({ isArchived: true }).where(eq(projects.id, archived.id))
      await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, trashed.id))

      const res = await inject('GET', '/api/users/me/projects', token)
      expect(res.statusCode).toBe(200)
      const { projects: list } = JSON.parse(res.payload)

      expect(list.map((p: any) => p.project.id)).toEqual([newer.id, older.id])

      const olderRow = list.find((p: any) => p.project.id === older.id)
      expect(olderRow.collectionId).toBe(collection.id)
      expect(olderRow.collectionName).toBe('Series A')
      const newerRow = list.find((p: any) => p.project.id === newer.id)
      expect(newerRow.collectionId).toBeNull()
      expect(newerRow.collectionName).toBeNull()
    })

    it('includes archived projects when includeArchived=true, but still excludes trashed', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const archived = await createTestProject(user.id, { name: 'Archived' })
      const trashed = await createTestProject(user.id, { name: 'Trashed' })
      await db.update(projects).set({ isArchived: true }).where(eq(projects.id, archived.id))
      await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, trashed.id))

      const res = await inject('GET', '/api/users/me/projects?includeArchived=true', token)
      const { projects: list } = JSON.parse(res.payload)
      expect(list.map((p: any) => p.project.id)).toEqual([archived.id])
    })

    it('never returns another author\'s projects', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      await createTestProject(user.id, { name: 'Mine' })

      const other = await createTestUser()
      await createTestProject(other.id, { name: 'Not Mine' })

      const res = await inject('GET', '/api/users/me/projects', token)
      const { projects: list } = JSON.parse(res.payload)
      expect(list).toHaveLength(1)
      expect(list[0].project.name).toBe('Mine')
    })
  })

  // ──────────────────────────────────────────
  // GET /api/users/me/projects/grouped
  // ──────────────────────────────────────────

  describe('GET /api/users/me/projects/grouped', () => {
    it('returns 401 without a token', async () => {
      const res = await inject('GET', '/api/users/me/projects/grouped')
      expect(res.statusCode).toBe(401)
    })

    it('groups projects by collection, sorted by orderIndex, and separates uncategorized ones', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      const collection = await createCollection(user.id, { name: 'Series A' })
      const trashedCollection = await createCollection(user.id, { name: 'Old Series', deletedAt: new Date() })
      const second = await createTestProject(user.id, { name: 'Book 2' })
      const first = await createTestProject(user.id, { name: 'Book 1' })
      const uncategorized = await createTestProject(user.id, { name: 'Standalone' })
      const archived = await createTestProject(user.id, { name: 'Archived Book' })
      await addToCollection(second.id, collection.id, 1)
      await addToCollection(first.id, collection.id, 0)
      await addToCollection(archived.id, collection.id, 2)
      await db.update(projects).set({ isArchived: true }).where(eq(projects.id, archived.id))

      const res = await inject('GET', '/api/users/me/projects/grouped', token)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)

      expect(body.collections).toHaveLength(1)
      expect(body.collections[0].id).toBe(collection.id)
      // Ordered by orderIndex ascending; the archived member is excluded entirely.
      expect(body.collections[0].projects.map((p: any) => p.id)).toEqual([first.id, second.id])
      expect(body.uncategorized.map((p: any) => p.id)).toEqual([uncategorized.id])
      // The trashed collection itself never appears, even empty.
      expect(body.collections.some((c: any) => c.id === trashedCollection.id)).toBe(false)
    })
  })

  // ──────────────────────────────────────────
  // GET /api/users/me/recent-activity
  // ──────────────────────────────────────────

  describe('GET /api/users/me/recent-activity', () => {
    it('returns 401 without a token', async () => {
      const res = await inject('GET', '/api/users/me/recent-activity')
      expect(res.statusCode).toBe(401)
    })

    it('returns an empty activity list for a user with no projects', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const res = await inject('GET', '/api/users/me/recent-activity', token)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ activity: [] })
    })

    it('orders newest-first, excludes entity_type_definitions and soft-deleted rows, truncates at the limit, and never another author\'s entities', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const p1 = await createTestProject(user.id, { name: 'P1' })
      const p2 = await createTestProject(user.id, { name: 'P2' })

      const now = Date.now()
      const newest = await createEntity(p2.id, { collectionName: 'characters', lastEditedAt: new Date(now) })
      const second = await createEntity(p1.id, { collectionName: 'content', lastEditedAt: new Date(now - 60_000) })
      const third = await createEntity(p1.id, { collectionName: 'content', lastEditedAt: new Date(now - 120_000) })
      // Excluded: internal type-definitions row, more recent than everything else.
      await createEntity(p1.id, { collectionName: 'entity_type_definitions', lastEditedAt: new Date(now + 60_000) })
      // Excluded: soft-deleted, more recent than everything else.
      await createEntity(p1.id, { collectionName: 'content', lastEditedAt: new Date(now + 60_000), deletedAt: new Date() })

      const other = await createTestUser()
      const otherProject = await createTestProject(other.id)
      await createEntity(otherProject.id, { collectionName: 'content', lastEditedAt: new Date(now + 60_000) })

      const res = await inject('GET', '/api/users/me/recent-activity', token)
      expect(res.statusCode).toBe(200)
      const { activity } = JSON.parse(res.payload)
      expect(activity.map((a: any) => a.entity.id)).toEqual([newest.id, second.id, third.id])
      expect(activity[0].projectName).toBe('P2')
      expect(activity[1].projectId).toBe(p1.id)

      const limited = await inject('GET', '/api/users/me/recent-activity?limit=2', token)
      const { activity: limitedActivity } = JSON.parse(limited.payload)
      expect(limitedActivity.map((a: any) => a.entity.id)).toEqual([newest.id, second.id])
    })
  })

  // ──────────────────────────────────────────
  // Archive / unarchive
  // ──────────────────────────────────────────

  describe('PUT /api/projects/:projectId/archive and /unarchive', () => {
    it('returns 401 without a token', async () => {
      const res = await inject('PUT', `/api/projects/${crypto.randomUUID()}/archive`)
      expect(res.statusCode).toBe(401)
    })

    it('archives and unarchives a project the caller owns', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)

      const archiveRes = await inject('PUT', `/api/projects/${project.id}/archive`, token)
      expect(archiveRes.statusCode).toBe(200)
      const archived = JSON.parse(archiveRes.payload).project
      expect(archived.isArchived).toBe(true)
      expect(archived.archivedAt).not.toBeNull()

      const unarchiveRes = await inject('PUT', `/api/projects/${project.id}/unarchive`, token)
      expect(unarchiveRes.statusCode).toBe(200)
      const unarchived = JSON.parse(unarchiveRes.payload).project
      expect(unarchived.isArchived).toBe(false)
      expect(unarchived.archivedAt).toBeNull()
    })

    it('refuses to archive another author\'s project with the exact ownership refusal', async () => {
      const owner = await createTestUser()
      const project = await createTestProject(owner.id)
      const attacker = await createTestUser()
      const attackerToken = await createTestToken(attacker.id)

      const res = await inject('PUT', `/api/projects/${project.id}/archive`, attackerToken)
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload)).toEqual({
        error: 'Forbidden',
        message: 'You do not have permission to access this project'
      })

      const [row] = await db.select().from(projects).where(eq(projects.id, project.id))
      expect(row!.isArchived).toBe(false)
    })

    it('returns 404 for a project that does not exist', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const res = await inject('PUT', `/api/projects/${crypto.randomUUID()}/archive`, token)
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Project not found' })
    })
  })

  // ──────────────────────────────────────────
  // Short URLs
  // ──────────────────────────────────────────

  describe('Short URLs', () => {
    it('claims a custom short URL, and a second attempt at the same URL by another project 409s', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const p1 = await createTestProject(user.id)
      const p2 = await createTestProject(user.id)

      const res = await inject('POST', `/api/projects/${p1.id}/short-url`, token, { customUrl: 'my-cool-story' })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).project.shortUrl).toBe('my-cool-story')

      const conflict = await inject('POST', `/api/projects/${p2.id}/short-url`, token, { customUrl: 'my-cool-story' })
      expect(conflict.statusCode).toBe(409)
      expect(JSON.parse(conflict.payload)).toEqual({ error: 'Short URL already taken' })
    })

    it('generates a random short URL when no customUrl is given', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)

      const res = await inject('POST', `/api/projects/${project.id}/short-url`, token, {})
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).project.shortUrl).toMatch(/^[a-f0-9]{8}$/)
    })

    it('rejects a reserved word, an over-length URL, and an invalid-format URL, all with 400', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)

      const reserved = await inject('POST', `/api/projects/${project.id}/short-url`, token, { customUrl: 'admin' })
      expect(reserved.statusCode).toBe(400)
      expect(JSON.parse(reserved.payload)).toEqual({ error: 'Short URL is reserved' })

      const tooLong = await inject('POST', `/api/projects/${project.id}/short-url`, token, { customUrl: 'a'.repeat(121) })
      expect(tooLong.statusCode).toBe(400)
      expect(JSON.parse(tooLong.payload)).toEqual({ error: 'Short URL must be 120 characters or less' })

      const badFormat = await inject('POST', `/api/projects/${project.id}/short-url`, token, { customUrl: 'Not Valid!' })
      expect(badFormat.statusCode).toBe(400)
      expect(JSON.parse(badFormat.payload)).toEqual({ error: 'Short URL must contain only lowercase letters, numbers, and hyphens' })
    })

    it('refuses to claim a short URL on another author\'s project', async () => {
      const owner = await createTestUser()
      const project = await createTestProject(owner.id)
      const attacker = await createTestUser()
      const attackerToken = await createTestToken(attacker.id)

      const res = await inject('POST', `/api/projects/${project.id}/short-url`, attackerToken, { customUrl: 'stolen' })
      expect(res.statusCode).toBe(403)
    })

    it('releases a claimed short URL', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)
      await inject('POST', `/api/projects/${project.id}/short-url`, token, { customUrl: 'release-me' })

      const res = await inject('DELETE', `/api/projects/${project.id}/short-url`, token)
      expect(res.statusCode).toBe(204)

      const [row] = await db.select().from(projects).where(eq(projects.id, project.id))
      expect(row!.shortUrl).toBeNull()
      expect(row!.shortUrlClaimedAt).toBeNull()
    })

    it('POST /api/short-urls/check requires no auth and reports availability, taken, and reserved', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)
      await inject('POST', `/api/projects/${project.id}/short-url`, token, { customUrl: 'taken-url' })

      const available = await inject('POST', '/api/short-urls/check', undefined, { shortUrl: 'brand-new-url', type: 'project' })
      expect(available.statusCode).toBe(200)
      expect(JSON.parse(available.payload)).toEqual({ available: true })

      const taken = await inject('POST', '/api/short-urls/check', undefined, { shortUrl: 'taken-url', type: 'project' })
      expect(JSON.parse(taken.payload)).toEqual({ available: false, reason: 'taken' })

      const reserved = await inject('POST', '/api/short-urls/check', undefined, { shortUrl: 'settings', type: 'project' })
      expect(JSON.parse(reserved.payload)).toEqual({ available: false, reason: 'reserved' })
    })
  })

  // ──────────────────────────────────────────
  // Trash lifecycle: soft delete, restore, permanent delete, listing
  // ──────────────────────────────────────────

  describe('Project trash lifecycle', () => {
    it('soft-deletes a project, which then disappears from the project list and appears in trash', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id, { name: 'To Be Trashed' })

      const delRes = await inject('DELETE', `/api/projects/${project.id}`, token)
      expect(delRes.statusCode).toBe(204)

      const listRes = await inject('GET', '/api/users/me/projects', token)
      expect(JSON.parse(listRes.payload).projects).toEqual([])

      const trashRes = await inject('GET', '/api/users/me/trash', token)
      const trashBody = JSON.parse(trashRes.payload)
      expect(trashBody.projects).toHaveLength(1)
      expect(trashBody.projects[0].id).toBe(project.id)
      expect(trashBody.projects[0].type).toBe('project')
      // autoDeleteAt = deletedAt + 30 days
      const deletedAt = new Date(trashBody.projects[0].deletedAt).getTime()
      const autoDeleteAt = new Date(trashBody.projects[0].autoDeleteAt).getTime()
      expect(autoDeleteAt - deletedAt).toBe(30 * 24 * 60 * 60 * 1000)
    })

    it('refuses to soft-delete another author\'s project', async () => {
      const owner = await createTestUser()
      const project = await createTestProject(owner.id)
      const attacker = await createTestUser()
      const attackerToken = await createTestToken(attacker.id)

      const res = await inject('DELETE', `/api/projects/${project.id}`, attackerToken)
      expect(res.statusCode).toBe(403)

      const [row] = await db.select().from(projects).where(eq(projects.id, project.id))
      expect(row!.deletedAt).toBeNull()
    })

    it('restores a trashed project back to the active list', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)
      await inject('DELETE', `/api/projects/${project.id}`, token)

      const restoreRes = await inject('PUT', `/api/projects/${project.id}/restore`, token)
      expect(restoreRes.statusCode).toBe(200)
      expect(JSON.parse(restoreRes.payload).project.deletedAt).toBeNull()

      const listRes = await inject('GET', '/api/users/me/projects', token)
      expect(JSON.parse(listRes.payload).projects.map((p: any) => p.project.id)).toEqual([project.id])
    })

    it('returns 404 restoring a project that is not actually trashed', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)

      const res = await inject('PUT', `/api/projects/${project.id}/restore`, token)
      expect(res.statusCode).toBe(404)
    })

    it('refuses to restore another author\'s trashed project', async () => {
      const owner = await createTestUser()
      const ownerToken = await createTestToken(owner.id)
      const project = await createTestProject(owner.id)
      await inject('DELETE', `/api/projects/${project.id}`, ownerToken)

      const attacker = await createTestUser()
      const attackerToken = await createTestToken(attacker.id)
      const res = await inject('PUT', `/api/projects/${project.id}/restore`, attackerToken)
      expect(res.statusCode).toBe(403)
    })

    it('permanently deletes a trashed project, removing the row entirely', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)
      await inject('DELETE', `/api/projects/${project.id}`, token)

      const res = await inject('DELETE', `/api/projects/${project.id}/permanent`, token)
      expect(res.statusCode).toBe(204)

      const rows = await db.select().from(projects).where(eq(projects.id, project.id))
      expect(rows).toHaveLength(0)
    })

    it('returns 404 permanently deleting a project that was never trashed', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)

      const res = await inject('DELETE', `/api/projects/${project.id}/permanent`, token)
      expect(res.statusCode).toBe(404)
      const rows = await db.select().from(projects).where(eq(projects.id, project.id))
      expect(rows).toHaveLength(1)
    })

    it('GET /api/users/me/trash returns 401 without a token and never another author\'s items', async () => {
      const unauth = await inject('GET', '/api/users/me/trash')
      expect(unauth.statusCode).toBe(401)

      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const other = await createTestUser()
      const otherProject = await createTestProject(other.id)
      await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, otherProject.id))

      const res = await inject('GET', '/api/users/me/trash', token)
      const body = JSON.parse(res.payload)
      expect(body.projects).toEqual([])
      expect(body.collections).toEqual([])
    })
  })

  // ──────────────────────────────────────────
  // Short URL resolution
  // ──────────────────────────────────────────

  describe('GET /api/p/:shortUrl and /api/c/:shortUrl', () => {
    it('resolves a project short URL using the username when a profile exists', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)
      await inject('POST', `/api/projects/${project.id}/short-url`, token, { customUrl: 'resolvable' })
      await db.insert(userProfiles).values({ userId: user.id, username: 'authorname' })

      const res = await inject('GET', '/api/p/resolvable')
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.projectId).toBe(project.id)
      expect(body.redirectTo).toBe('/read/authorname/resolvable')
    })

    it('falls back to the owner id when there is no user profile', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)
      await inject('POST', `/api/projects/${project.id}/short-url`, token, { customUrl: 'no-profile' })

      const res = await inject('GET', '/api/p/no-profile')
      const body = JSON.parse(res.payload)
      expect(body.redirectTo).toBe(`/read/${user.id}/no-profile`)
    })

    it('returns 404 for an unknown or trashed project short URL', async () => {
      const missing = await inject('GET', '/api/p/does-not-exist')
      expect(missing.statusCode).toBe(404)

      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)
      await inject('POST', `/api/projects/${project.id}/short-url`, token, { customUrl: 'soon-trashed' })
      await inject('DELETE', `/api/projects/${project.id}`, token)

      const res = await inject('GET', '/api/p/soon-trashed')
      expect(res.statusCode).toBe(404)
    })

    it('resolves a collection short URL and 404s for an unknown or trashed one', async () => {
      const user = await createTestUser()
      const collection = await createCollection(user.id, { name: 'Series A' })
      await db.update(projectCollections).set({ shortUrl: 'collection-url' }).where(eq(projectCollections.id, collection.id))

      const res = await inject('GET', '/api/c/collection-url')
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.collectionId).toBe(collection.id)
      expect(body.redirectTo).toBe(`/collections/${collection.id}`)

      const missing = await inject('GET', '/api/c/no-such-collection')
      expect(missing.statusCode).toBe(404)

      const trashed = await createCollection(user.id, { name: 'Trashed', deletedAt: new Date() })
      await db.update(projectCollections).set({ shortUrl: 'trashed-collection-url' }).where(eq(projectCollections.id, trashed.id))
      const trashedRes = await inject('GET', '/api/c/trashed-collection-url')
      expect(trashedRes.statusCode).toBe(404)
    })
  })
})
