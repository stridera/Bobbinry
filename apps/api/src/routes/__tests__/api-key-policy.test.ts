import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { build } from '../../server'
import { db } from '../../db/connection'
import { apiKeys, entities, users } from '../../db/schema'
import { hashApiKey } from '../../middleware/auth'
import { createTestApp, createTestUser, createTestProject, cleanupAllTestData } from '../../__tests__/test-helpers'

/**
 * API keys are default-deny (middleware/auth.ts, ApiKeyPolicy). This pins the
 * complete list of routes a key can reach, so opening another one is a
 * reviewed change to this file rather than a side effect of a new route, and
 * walks the paths that were open to any key before the policy existed.
 */

// Every route that admits an API key, and on what terms. 'in-handler' routes
// pick manuscript:* or entities:* by collection (assertEntityScope).
const KEY_ROUTES: Record<string, string> = {
  'POST /api/projects': 'projects:write',
  'GET /api/projects': 'projects:read',
  'GET /api/projects/:projectId': 'projects:read',
  'GET /api/projects/:projectId/bobbins': 'projects:read',
  'GET /api/projects/:projectId/changes': 'projects:read',

  'GET /api/collections/:collection/entities': 'in-handler',
  'POST /api/entities': 'in-handler',
  'GET /api/entities/:entityId': 'in-handler',
  'PUT /api/entities/:entityId': 'in-handler',
  'DELETE /api/entities/:entityId': 'in-handler',
  'POST /api/entities/batch': 'in-handler',
  'POST /api/entities/batch/atomic': 'in-handler',
  'PATCH /api/entities/:entityId/publish': 'in-handler',
  'PATCH /api/projects/:projectId/entity-types/:typeId/publish': 'in-handler',
  'POST /api/projects/:projectId/entities/reorder': 'in-handler',
  'POST /api/projects/:projectId/entity-types/reorder': 'in-handler',
  'GET /api/entities/:entityId/revisions': 'in-handler',
  'GET /api/entities/:entityId/revisions/:revisionId': 'in-handler',
  'GET /api/entities/:entityId/diff': 'in-handler',
  'POST /api/entities/:entityId/revisions': 'in-handler',
  'POST /api/entities/:entityId/revisions/:revisionId/restore': 'in-handler',
  'POST /api/import/parse': 'in-handler',
  'POST /api/import/commit': 'in-handler',
  'GET /api/projects/:projectId/export/snapshot': 'in-handler',
  'GET /api/projects/:projectId/export/:format': 'in-handler',
  'POST /api/projects/:projectId/search-replace/preview': 'in-handler',
  'POST /api/projects/:projectId/search-replace/apply': 'in-handler',

  'GET /api/projects/:projectId/entity-types': 'entities:read',
  'GET /api/projects/:projectId/entity-types/:typeId': 'entities:read',
  'POST /api/projects/:projectId/entity-types': 'entities:write',
  'PUT /api/projects/:projectId/entity-types/:typeId': 'entities:write',
  'POST /api/projects/:projectId/entity-types/:typeId/detach': 'entities:write',
  'DELETE /api/projects/:projectId/entity-types/:typeId': 'entities:write',
  'POST /api/templates': 'entities:write',
  'DELETE /api/templates/:shareId': 'entities:write',

  'GET /api/projects/:projectId/annotations': 'manuscript:read',
  'GET /api/projects/:projectId/annotations/stats': 'manuscript:read',
  'PUT /api/projects/:projectId/annotations/:annotationId/status': 'manuscript:read',
  'PATCH /api/projects/:projectId/annotations/:annotationId/status': 'manuscript:read',
  'POST /api/projects/:projectId/annotations/:annotationId/accept': 'manuscript:write',
  'GET /api/public/projects/:projectId/can-annotate': 'manuscript:read',
  'GET /api/public/chapters/:chapterId/annotations': 'manuscript:read',
  'POST /api/public/chapters/:chapterId/annotations': 'manuscript:read',
  'PUT /api/public/chapters/:chapterId/annotations/:annotationId': 'manuscript:read',
  'DELETE /api/public/chapters/:chapterId/annotations/:annotationId': 'manuscript:read',

  'GET /api/dashboard/stats': 'stats:read',
  'GET /api/users/me/projects': 'stats:read',
  'GET /api/users/me/projects/grouped': 'stats:read',
  'GET /api/users/me/recent-activity': 'stats:read',
  'GET /api/membership': 'profile:read',
}

describe('API key policy', () => {
  it('admits keys on exactly the allowlisted routes', async () => {
    const app = build({ logger: false })
    const admitted: Record<string, string> = {}
    app.addHook('onRoute', (route) => {
      const policy = route.config?.apiKey
      if (!policy) return
      for (const method of [route.method].flat()) {
        // HEAD mirrors GET.
        if (method === 'HEAD') continue
        admitted[`${method} ${route.url}`] = policy === 'in-handler' ? policy : policy.scope
      }
    })
    await app.ready()
    await app.close()

    expect(admitted).toEqual(KEY_ROUTES)
  })

  describe('requests', () => {
    let app: any
    beforeAll(async () => { app = await createTestApp() })
    afterAll(async () => { await app.close() })
    afterEach(async () => { await cleanupAllTestData() })

    const ALL_SCOPES = [
      'projects:read', 'projects:write', 'manuscript:read', 'manuscript:write',
      'entities:read', 'entities:write', 'stats:read', 'profile:read',
    ]

    async function verifiedUser() {
      const user = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
      return user
    }

    /** A fresh key per call: resolved keys are cached by hash for a few seconds. */
    async function keyFor(userId: string, scopes: string[], projectId: string | null = null) {
      const token = `bby_${randomBytes(16).toString('hex')}`
      await db.insert(apiKeys).values({
        userId, name: 'Test Key', keyPrefix: token.slice(0, 8), keyHash: hashApiKey(token), scopes, projectId,
      })
      return token
    }

    async function seedChapter(projectId: string) {
      const [chapter] = await db.insert(entities).values({
        projectId,
        bobbinId: 'manuscript',
        collectionName: 'content',
        contentType: 'chapter',
        entityData: { title: 'Chapter 1', body: '<p>The reactor hummed, and then it did not.</p>', word_count: 9 },
      }).returning()
      return chapter!
    }

    function call(method: string, url: string, key: string, payload?: unknown) {
      return app.inject({ method, url, headers: { authorization: `Bearer ${key}` }, payload })
    }

    function fileSuggestion(key: string, projectId: string, chapterId: string) {
      return call('POST', `/api/public/chapters/${chapterId}/annotations`, key, {
        projectId,
        anchorQuote: 'The reactor hummed',
        annotationType: 'suggestion',
        content: 'reword',
        suggestedText: 'The reactor sang',
        chapterVersion: 1,
      })
    }

    async function chapterBody(chapterId: string) {
      const [row] = await db.select({ entityData: entities.entityData }).from(entities).where(eq(entities.id, chapterId))
      return (row!.entityData as { body: string }).body
    }

    it('refuses a key on a route that declares nothing, whatever its scopes', async () => {
      const user = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await seedChapter(project.id)
      const key = await keyFor(user.id, ALL_SCOPES)

      const res = await call('POST', '/api/entities/bulk-archive', key, { projectId: project.id, ids: [chapter.id] })

      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload).error).toBe('Session auth required')
      const [row] = await db.select({ archivedAt: entities.archivedAt }).from(entities).where(eq(entities.id, chapter.id))
      expect(row!.archivedAt).toBeNull()
    })

    it('lets a read-only key file a suggestion but not accept it into the chapter', async () => {
      const user = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await seedChapter(project.id)
      const readKey = await keyFor(user.id, ['manuscript:read'])

      const filed = await fileSuggestion(readKey, project.id, chapter.id)
      expect(filed.statusCode).toBe(201)
      const annotationId = JSON.parse(filed.payload).annotation.id

      const accept = `/api/projects/${project.id}/annotations/${annotationId}/accept`
      const refused = await call('POST', accept, readKey)
      expect(refused.statusCode).toBe(403)
      expect(JSON.parse(refused.payload).error).toBe('Insufficient scope')
      expect(await chapterBody(chapter.id)).toContain('The reactor hummed')

      const writeKey = await keyFor(user.id, ['manuscript:write'])
      const accepted = await call('POST', accept, writeKey)
      expect(accepted.statusCode).toBe(200)
      expect(await chapterBody(chapter.id)).toContain('The reactor sang')
    })

    it('runs the sync bots\' proofing loop on a manuscript:read key', async () => {
      const user = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await seedChapter(project.id)
      const key = await keyFor(user.id, ['manuscript:read'])

      const filed = await fileSuggestion(key, project.id, chapter.id)
      expect(filed.statusCode).toBe(201)
      const annotationId = JSON.parse(filed.payload).annotation.id

      const listed = await call('GET', `/api/projects/${project.id}/annotations`, key)
      expect(listed.statusCode).toBe(200)
      expect(JSON.parse(listed.payload).annotations).toHaveLength(1)

      const resolved = await call('PUT', `/api/projects/${project.id}/annotations/${annotationId}/status`, key, { status: 'resolved' })
      expect(resolved.statusCode).toBe(200)

      const deleted = await call('DELETE', `/api/public/chapters/${chapter.id}/annotations/${annotationId}`, key)
      expect(deleted.statusCode).toBe(200)
    })

    it('serves a key an optionalAuth route does not admit as anonymous', async () => {
      const user = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await seedChapter(project.id)
      const key = await keyFor(user.id, ['entities:read'])

      const res = await fileSuggestion(key, project.id, chapter.id)

      expect(res.statusCode).toBe(401)
    })

    it('refuses a project-restricted key on account-wide writes', async () => {
      const user = await verifiedUser()
      const project = await createTestProject(user.id)
      const key = await keyFor(user.id, ['projects:write'], project.id)

      const res = await call('POST', '/api/projects', key, { name: 'Escaped' })

      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload).message).toMatch(/restricted to a single project/)
    })

    it('gates whoami on profile:read', async () => {
      const user = await verifiedUser()

      expect((await call('GET', '/api/membership', await keyFor(user.id, ['profile:read']))).statusCode).toBe(200)
      expect((await call('GET', '/api/membership', await keyFor(user.id, ['projects:read']))).statusCode).toBe(403)
    })

    it('gates every export format on manuscript:read', async () => {
      const user = await verifiedUser()
      const project = await createTestProject(user.id)
      const key = await keyFor(user.id, ['entities:read'])

      const res = await call('GET', `/api/projects/${project.id}/export/txt`, key)

      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload).message).toMatch(/manuscript:read/)
    })
  })
})
