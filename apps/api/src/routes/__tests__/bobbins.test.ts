import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from '@jest/globals'
import { db } from '../../db/connection'
import { bobbinsInstalled } from '../../db/schema'
import { and, eq } from 'drizzle-orm'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData
} from '../../__tests__/test-helpers'

/** Install a bobbin directly via DB (bypasses manifest validation). */
async function installBobbinViaBD(projectId: string, bobbinId: string, manifest?: Record<string, any>) {
  const [row] = await db.insert(bobbinsInstalled).values({
    projectId,
    bobbinId,
    version: '1.0.0',
    manifestJson: manifest ?? { id: bobbinId, name: bobbinId, version: '1.0.0' }
  }).returning()
  return row!
}

describe('Bobbins API', () => {
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
  // LIST
  // ──────────────────────────────────────────

  describe('GET /api/projects/:projectId/bobbins', () => {
    it('lists installed bobbins', async () => {
      const user = await createTestUser()
      const project = await createTestProject(user.id)
      const token = await createTestToken(user.id)

      await installBobbinViaBD(project.id, 'manuscript', {
        id: 'manuscript', name: 'Manuscript', version: '1.0.0',
        data: { collections: [{ name: 'chapters', fields: [] }] }
      })

      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/bobbins`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.bobbins).toBeDefined()
      expect(body.bobbins.length).toBeGreaterThanOrEqual(1)
    })

    it('lists multiple installed bobbins', async () => {
      const user = await createTestUser()
      const project = await createTestProject(user.id)
      const token = await createTestToken(user.id)

      await installBobbinViaBD(project.id, 'manuscript')
      await installBobbinViaBD(project.id, 'entities')

      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/bobbins`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.bobbins.length).toBe(2)
    })
  })

  // ──────────────────────────────────────────
  // INSTALL
  // ──────────────────────────────────────────

  describe('POST /api/projects/:projectId/bobbins/install', () => {
    let user: any
    let project: any
    let token: string

    beforeEach(async () => {
      user = await createTestUser()
      project = await createTestProject(user.id)
      token = await createTestToken(user.id)
    })

    it('installs a bobbin from inline manifest content', async () => {
      const manifest = JSON.stringify({
        id: 'test-bobbin',
        name: 'Test Bobbin',
        version: '1.0.0',
        data: {
          collections: [{ name: 'items', fields: [{ name: 'title', type: 'text' }] }]
        }
      })

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/bobbins/install`,
        headers: { authorization: `Bearer ${token}` },
        payload: { manifestContent: manifest, manifestType: 'json' }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.success).toBe(true)
      expect(body.bobbin).toBeDefined()
    })

    it('returns 403 for path outside bobbins/', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/bobbins/install`,
        headers: { authorization: `Bearer ${token}` },
        payload: { manifestPath: 'nonexistent/manifest.yaml' }
      })

      expect(res.statusCode).toBe(403)
    })

    it('returns 401 without auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/bobbins/install`,
        payload: { manifestPath: 'bobbins/manuscript/manifest.yaml' }
      })

      expect(res.statusCode).toBe(401)
    })

    it('returns 404 for non-owner project', async () => {
      const otherUser = await createTestUser()
      const otherToken = await createTestToken(otherUser.id)

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/bobbins/install`,
        headers: { authorization: `Bearer ${otherToken}` },
        payload: { manifestPath: 'bobbins/manuscript/manifest.yaml' }
      })

      expect([403, 404]).toContain(res.statusCode)
    })
  })

  // ──────────────────────────────────────────
  // UNINSTALL
  // ──────────────────────────────────────────

  describe('DELETE /api/projects/:projectId/bobbins/:bobbinId', () => {
    it('uninstalls an installed bobbin', async () => {
      const user = await createTestUser()
      const project = await createTestProject(user.id)
      const token = await createTestToken(user.id)

      await installBobbinViaBD(project.id, 'manuscript')

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${project.id}/bobbins/manuscript`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect([200, 204]).toContain(res.statusCode)

      // Verify it's removed
      const rows = await db.select().from(bobbinsInstalled)
        .where(and(eq(bobbinsInstalled.projectId, project.id), eq(bobbinsInstalled.bobbinId, 'manuscript')))
      expect(rows.length).toBe(0)
    })

    it('returns 404 for nonexistent bobbin', async () => {
      const user = await createTestUser()
      const project = await createTestProject(user.id)
      const token = await createTestToken(user.id)

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${project.id}/bobbins/nonexistent`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(404)
    })
  })
})
