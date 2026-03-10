import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData
} from '../../__tests__/test-helpers'

describe('Collections API', () => {
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

  // ──────────────────────────────────────────
  // CREATE
  // ──────────────────────────────────────────

  describe('POST /api/collections', () => {
    it('creates a collection with name', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      const res = await app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'My Series', description: 'A test series' }
      })

      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.payload)
      expect(body.collection.name).toBe('My Series')
      expect(body.collection.description).toBe('A test series')
      expect(body.collection.userId).toBe(user.id)
    })

    it('returns 400 for empty name', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      const res = await app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: '' }
      })

      expect(res.statusCode).toBe(400)
    })

    it('returns 401 without auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/collections',
        payload: { name: 'Unauthorized' }
      })

      expect(res.statusCode).toBe(401)
    })
  })

  // ──────────────────────────────────────────
  // LIST
  // ──────────────────────────────────────────

  describe('GET /api/users/me/collections', () => {
    it('returns only own collections', async () => {
      const userA = await createTestUser()
      const userB = await createTestUser()
      const tokenA = await createTestToken(userA.id)
      const tokenB = await createTestToken(userB.id)

      await app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'A Collection' }
      })
      await app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { name: 'B Collection' }
      })

      const res = await app.inject({
        method: 'GET',
        url: '/api/users/me/collections',
        headers: { authorization: `Bearer ${tokenA}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.collections.length).toBe(1)
      expect(body.collections[0].name).toBe('A Collection')
    })
  })

  // ──────────────────────────────────────────
  // GET BY ID
  // ──────────────────────────────────────────

  describe('GET /api/collections/:collectionId', () => {
    it('returns collection without auth (public)', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Public Collection' }
      })
      const collectionId = JSON.parse(createRes.payload).collection.id

      const res = await app.inject({
        method: 'GET',
        url: `/api/collections/${collectionId}`
      })

      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).collection.name).toBe('Public Collection')
    })

    it('returns 404 for nonexistent collection', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/collections/00000000-0000-0000-0000-000000000000'
      })

      expect(res.statusCode).toBe(404)
    })
  })

  // ──────────────────────────────────────────
  // UPDATE
  // ──────────────────────────────────────────

  describe('PUT /api/collections/:collectionId', () => {
    it('updates collection with partial data', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Original', description: 'Original desc' }
      })
      const collectionId = JSON.parse(createRes.payload).collection.id

      const res = await app.inject({
        method: 'PUT',
        url: `/api/collections/${collectionId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Updated' }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.collection.name).toBe('Updated')
    })
  })

  // ──────────────────────────────────────────
  // DELETE
  // ──────────────────────────────────────────

  describe('DELETE /api/collections/:collectionId', () => {
    it('deletes owned collection', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'To Delete' }
      })
      const collectionId = JSON.parse(createRes.payload).collection.id

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/collections/${collectionId}`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(204)

      // Verify deleted
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/collections/${collectionId}`
      })
      expect(getRes.statusCode).toBe(404)
    })

    it('projects stay intact after collection deletion', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id, { name: 'Survives' })

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Will Delete' }
      })
      const collectionId = JSON.parse(createRes.payload).collection.id

      // Add project
      await app.inject({
        method: 'POST',
        url: `/api/collections/${collectionId}/projects/${project.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: {}
      })

      // Delete collection
      await app.inject({
        method: 'DELETE',
        url: `/api/collections/${collectionId}`,
        headers: { authorization: `Bearer ${token}` }
      })

      // Project should still exist
      const projectRes = await app.inject({
        method: 'GET',
        url: '/api/projects',
        headers: { authorization: `Bearer ${token}` }
      })
      expect(projectRes.statusCode).toBe(200)
      const projects = JSON.parse(projectRes.payload)
      expect(projects.some((p: any) => p.id === project.id)).toBe(true)
    })
  })

  // ──────────────────────────────────────────
  // ADD / REMOVE PROJECTS
  // ──────────────────────────────────────────

  describe('Collection project membership', () => {
    it('adds project to collection', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Series' }
      })
      const collectionId = JSON.parse(createRes.payload).collection.id

      const res = await app.inject({
        method: 'POST',
        url: `/api/collections/${collectionId}/projects/${project.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: {}
      })

      expect(res.statusCode).toBe(201)
      expect(JSON.parse(res.payload).membership).toBeDefined()
    })

    it('adding project to collection twice inserts without error', async () => {
      // Note: no unique constraint on (collectionId, projectId) — duplicates accepted
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Series' }
      })
      const collectionId = JSON.parse(createRes.payload).collection.id

      const first = await app.inject({
        method: 'POST',
        url: `/api/collections/${collectionId}/projects/${project.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: {}
      })
      expect(first.statusCode).toBe(201)

      const second = await app.inject({
        method: 'POST',
        url: `/api/collections/${collectionId}/projects/${project.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: {}
      })

      // Without unique constraint, second insert succeeds as well
      expect(second.statusCode).toBe(201)
    })

    it('removes project from collection', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const project = await createTestProject(user.id)

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Series' }
      })
      const collectionId = JSON.parse(createRes.payload).collection.id

      await app.inject({
        method: 'POST',
        url: `/api/collections/${collectionId}/projects/${project.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: {}
      })

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/collections/${collectionId}/projects/${project.id}`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(204)
    })
  })

  // ──────────────────────────────────────────
  // REORDER
  // ──────────────────────────────────────────

  describe('PUT /api/collections/:id/projects/reorder', () => {
    it('reorders projects', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const p1 = await createTestProject(user.id, { name: 'Book 1' })
      const p2 = await createTestProject(user.id, { name: 'Book 2' })

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Series' }
      })
      const collectionId = JSON.parse(createRes.payload).collection.id

      // Add both projects
      await app.inject({
        method: 'POST',
        url: `/api/collections/${collectionId}/projects/${p1.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { orderIndex: 0 }
      })
      await app.inject({
        method: 'POST',
        url: `/api/collections/${collectionId}/projects/${p2.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { orderIndex: 1 }
      })

      // Reorder: p2 first, then p1
      const res = await app.inject({
        method: 'PUT',
        url: `/api/collections/${collectionId}/projects/reorder`,
        headers: { authorization: `Bearer ${token}` },
        payload: { projectIds: [p2.id, p1.id] }
      })

      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).success).toBe(true)

      // Verify order
      const listRes = await app.inject({
        method: 'GET',
        url: `/api/collections/${collectionId}/projects`
      })
      const projects = JSON.parse(listRes.payload).projects
      expect(projects[0].project.id).toBe(p2.id)
      expect(projects[1].project.id).toBe(p1.id)
    })
  })

  // ──────────────────────────────────────────
  // CROSS-USER ISOLATION
  // ──────────────────────────────────────────

  describe('Cross-user isolation', () => {
    it('user B cannot modify user A collection', async () => {
      const userA = await createTestUser()
      const userB = await createTestUser()
      const tokenA = await createTestToken(userA.id)
      const tokenB = await createTestToken(userB.id)

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/collections',
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { name: 'A Private' }
      })
      const collectionId = JSON.parse(createRes.payload).collection.id

      // User B tries to update
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/collections/${collectionId}`,
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { name: 'Hacked' }
      })
      expect(updateRes.statusCode).toBe(403)

      // User B tries to delete
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/collections/${collectionId}`,
        headers: { authorization: `Bearer ${tokenB}` }
      })
      expect(deleteRes.statusCode).toBe(403)
    })
  })
})
