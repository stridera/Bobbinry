/**
 * End-to-end Integration Test
 *
 * Chains the full happy-path workflow through the API:
 * signup → verify email → login → create project → install bobbin (DB) →
 * create entity → publish → create collection → add to collection →
 * follow user → check notifications
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { db } from '../../db/connection'
import { emailVerificationTokens, bobbinsInstalled, users } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { createTestApp, createTestToken, createTestUser, cleanupAllTestData } from '../test-helpers'

/** Poll DB for a verification token (created asynchronously after signup). */
async function waitForVerificationToken(userId: string, maxMs = 3000): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const [row] = await db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, userId))
      .limit(1)
    if (row) return row.token
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('Verification token not found within timeout')
}

describe('E2E Workflow', () => {
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

  it('completes the full happy-path workflow', async () => {
    // 1. Signup
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'e2e@test.local', password: 'password123', name: 'E2E User' }
    })
    expect(signupRes.statusCode).toBe(201)
    const signupBody = JSON.parse(signupRes.payload)
    const userId = signupBody.id
    expect(userId).toBeDefined()

    // 2. Verify email (token created async — poll for it)
    const verifyToken = await waitForVerificationToken(userId)

    const verifyRes = await app.inject({
      method: 'GET',
      url: `/api/auth/verify-email?token=${verifyToken}`
    })
    expect(verifyRes.statusCode).toBe(200)

    // 3. Login
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'e2e@test.local', password: 'password123' }
    })
    expect(loginRes.statusCode).toBe(200)

    // Use a test token for subsequent requests (login doesn't return a JWT)
    const token = await createTestToken(userId)

    // 4. Create project
    const projectRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'E2E Project', description: 'End-to-end test project' }
    })
    expect(projectRes.statusCode).toBe(201)
    const project = JSON.parse(projectRes.payload)
    const projectId = project.id

    // 5. Install manuscript bobbin via DB (bypasses manifest validation)
    await db.insert(bobbinsInstalled).values({
      projectId,
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

    // 6. Create entity (chapter)
    const entityRes = await app.inject({
      method: 'POST',
      url: '/api/entities',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        collection: 'content',
        projectId,
        data: { title: 'E2E Chapter', order: 1 }
      }
    })
    expect([200, 201]).toContain(entityRes.statusCode)
    const chapter = JSON.parse(entityRes.payload)
    const chapterId = chapter.id

    // 7. Publish chapter
    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/chapters/${chapterId}/publish`,
      headers: { authorization: `Bearer ${token}` },
      payload: { publishStatus: 'published' }
    })
    expect([200, 201]).toContain(publishRes.statusCode)

    // 8. Create collection
    const collectionRes = await app.inject({
      method: 'POST',
      url: '/api/collections',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'E2E Series' }
    })
    expect(collectionRes.statusCode).toBe(201)
    const collectionId = JSON.parse(collectionRes.payload).collection.id

    // 9. Add project to collection
    const addRes = await app.inject({
      method: 'POST',
      url: `/api/collections/${collectionId}/projects/${projectId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {}
    })
    expect(addRes.statusCode).toBe(201)

    // 10. Follow another user
    const otherUser = await createTestUser({ name: 'Other Author' })
    const otherToken = await createTestToken(otherUser.id)

    const followRes = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/follow`,
      headers: { authorization: `Bearer ${token}` },
      payload: { followingId: otherUser.id }
    })
    expect(followRes.statusCode).toBe(201)

    // 11. Check notifications for the followed user
    const notifRes = await app.inject({
      method: 'GET',
      url: '/api/notifications',
      headers: { authorization: `Bearer ${otherToken}` }
    })
    expect(notifRes.statusCode).toBe(200)
    const notifBody = JSON.parse(notifRes.payload)
    expect(Array.isArray(notifBody.notifications)).toBe(true)
  })
})
