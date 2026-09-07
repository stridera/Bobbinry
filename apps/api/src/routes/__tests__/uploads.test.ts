import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { users } from '../../db/schema'
import { createTestApp, createTestToken, createTestUser, createTestProject, cleanupAllTestData } from '../../__tests__/test-helpers'

/**
 * Upload presign ownership. Avatars have no project; every other context must
 * name a project the caller owns. The ownership preHandler is `optional`, so
 * an avatar request without projectId must not be rejected as a bad id.
 */
describe('POST /uploads/presign ownership', () => {
  let app: any
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  afterEach(async () => { await cleanupAllTestData() })

  async function verifiedUser() {
    const user = await createTestUser()
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
    return { user, token: await createTestToken(user.id) }
  }

  it('presigns an avatar upload with no projectId', async () => {
    const { token } = await verifiedUser()
    const res = await app.inject({
      method: 'POST', url: '/api/uploads/presign',
      headers: { authorization: `Bearer ${token}` },
      payload: { filename: 'me.png', contentType: 'image/png', size: 1024, context: 'avatar' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload).fileKey).toMatch(/^users\/.*\/avatars\//)
  })

  it('requires a projectId for project-scoped contexts', async () => {
    const { token } = await verifiedUser()
    const res = await app.inject({
      method: 'POST', url: '/api/uploads/presign',
      headers: { authorization: `Bearer ${token}` },
      payload: { filename: 'cover.png', contentType: 'image/png', size: 1024, context: 'cover' },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toMatch(/projectId is required/)
  })

  it("refuses to presign into another user's project", async () => {
    const { token } = await verifiedUser()
    const victim = await createTestUser()
    const project = await createTestProject(victim.id)
    const res = await app.inject({
      method: 'POST', url: '/api/uploads/presign',
      headers: { authorization: `Bearer ${token}` },
      payload: { filename: 'cover.png', contentType: 'image/png', size: 1024, context: 'cover', projectId: project.id },
    })
    expect(res.statusCode).toBe(403)
  })
})
