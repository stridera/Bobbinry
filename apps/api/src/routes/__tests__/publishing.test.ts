import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { db } from '../../db/connection'
import { entities, bobbinsInstalled, users } from '../../db/schema'
import { eq } from 'drizzle-orm'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData
} from '../../__tests__/test-helpers'

describe('Publishing API', () => {
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

  /**
   * Helper: create user (verified), project, install manuscript bobbin via DB,
   * create a chapter entity via API. Returns { user, project, token, chapter }.
   */
  async function setupPublishingScenario() {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const token = await createTestToken(user.id)

    // Verify email so requireVerified passes
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))

    // Install manuscript bobbin via DB (bypasses manifest validation)
    await db.insert(bobbinsInstalled).values({
      projectId: project.id,
      bobbinId: 'manuscript',
      version: '1.0.0',
      manifestJson: {
        id: 'manuscript',
        name: 'Manuscript',
        version: '1.0.0',
        data: {
          collections: [
            { name: 'books', fields: [] },
            { name: 'chapters', fields: [] },
            { name: 'scenes', fields: [] }
          ]
        }
      }
    })

    // Create a chapter entity via API
    const entityRes = await app.inject({
      method: 'POST',
      url: '/api/entities',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        collection: 'content',
        projectId: project.id,
        data: { title: 'Chapter 1', order: 1 }
      }
    })

    const chapter = JSON.parse(entityRes.payload)

    return { user, project, token, chapter }
  }

  // ──────────────────────────────────────────
  // PUBLISH / UNPUBLISH / COMPLETE / REVERT
  // ──────────────────────────────────────────

  describe('Chapter publication workflow', () => {
    it('publishes a chapter', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      expect([200, 201]).toContain(res.statusCode)
      const body = JSON.parse(res.payload)
      expect(body.publication).toBeDefined()
      expect(body.publication.publishStatus).toBe('published')
    })

    it('gets publication status', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publication`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.publication.publishStatus).toBe('published')
    })

    it('lists publications with status filter', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/publications?status=published`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.publications.length).toBeGreaterThanOrEqual(1)
    })

    it('unpublishes a chapter', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/unpublish`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.publication.publishStatus).toBe('draft')
    })

    it('marks chapter as complete', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/complete`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect([200, 201]).toContain(res.statusCode)
      const body = JSON.parse(res.payload)
      expect(body.publication.publishStatus).toBe('complete')
    })

    it('reverts to draft', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/revert-to-draft`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.publication.publishStatus).toBe('draft')
    })
  })

  // ──────────────────────────────────────────
  // PUBLISH CONFIG
  // ──────────────────────────────────────────

  describe('Publish config', () => {
    it('gets default config and updates it', async () => {
      const { project, token } = await setupPublishingScenario()

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/publish-config`,
        headers: { authorization: `Bearer ${token}` }
      })
      expect(getRes.statusCode).toBe(200)

      const putRes = await app.inject({
        method: 'PUT',
        url: `/api/projects/${project.id}/publish-config`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          publishingMode: 'manual',
          enableComments: true,
          enableReactions: true
        }
      })

      expect([200, 201]).toContain(putRes.statusCode)
      const body = JSON.parse(putRes.payload)
      expect(body.config.publishingMode).toBe('manual')
      expect(body.config.enableComments).toBe(true)

      const verifyRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/publish-config`,
        headers: { authorization: `Bearer ${token}` }
      })
      expect(JSON.parse(verifyRes.payload).config.publishingMode).toBe('manual')
    })
  })

  // ──────────────────────────────────────────
  // EMBARGO CRUD
  // ──────────────────────────────────────────

  describe('Embargo schedules', () => {
    it('creates, gets, updates, and deletes an embargo', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      // Create
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/embargoes`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          entityId: chapter.id,
          publishMode: 'scheduled',
          publicReleaseDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        }
      })
      expect(createRes.statusCode).toBe(201)
      const embargo = JSON.parse(createRes.payload).embargo
      expect(embargo.id).toBeDefined()

      // Get
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/embargo`,
        headers: { authorization: `Bearer ${token}` }
      })
      expect(getRes.statusCode).toBe(200)

      // Update
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/embargoes/${embargo.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishMode: 'immediate' }
      })
      expect(updateRes.statusCode).toBe(200)

      // Delete
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/embargoes/${embargo.id}`,
        headers: { authorization: `Bearer ${token}` }
      })
      expect(deleteRes.statusCode).toBe(200)

      // Verify deleted
      const verifyRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/embargo`,
        headers: { authorization: `Bearer ${token}` }
      })
      expect(verifyRes.statusCode).toBe(404)
    })
  })

  // ──────────────────────────────────────────
  // CHAPTER VIEWS / ANALYTICS
  // ──────────────────────────────────────────

  describe('Chapter views and analytics', () => {
    it('tracks a view and returns analytics', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      // Publish first
      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      // Record a view
      const viewRes = await app.inject({
        method: 'POST',
        url: `/api/chapters/${chapter.id}/views`,
        payload: { sessionId: 'test-session-1', deviceType: 'desktop' }
      })
      expect(viewRes.statusCode).toBe(201)

      // Get analytics
      const analyticsRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/analytics`,
        headers: { authorization: `Bearer ${token}` }
      })
      expect(analyticsRes.statusCode).toBe(200)
      const analytics = JSON.parse(analyticsRes.payload).analytics
      expect(analytics.totalViews).toBeGreaterThanOrEqual(1)
    })
  })
})
