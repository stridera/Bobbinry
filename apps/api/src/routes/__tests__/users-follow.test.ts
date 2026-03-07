import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { userFollowers } from '../../db/schema'
import { createTestApp, createTestToken, createTestUser, cleanupAllTestData } from '../../__tests__/test-helpers'

describe('Users Follow API', () => {
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

  it('prevents duplicate follow relationships', async () => {
    const follower = await createTestUser({ name: 'Follower' })
    const following = await createTestUser({ name: 'Following' })

    const token = await createTestToken(follower.id)

    const first = await app.inject({
      method: 'POST',
      url: `/api/users/${follower.id}/follow`,
      headers: { authorization: `Bearer ${token}` },
      payload: { followingId: following.id }
    })

    const second = await app.inject({
      method: 'POST',
      url: `/api/users/${follower.id}/follow`,
      headers: { authorization: `Bearer ${token}` },
      payload: { followingId: following.id }
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(400)

    const rows = await db
      .select()
      .from(userFollowers)
      .where(and(
        eq(userFollowers.followerId, follower.id),
        eq(userFollowers.followingId, following.id)
      ))

    expect(rows.length).toBe(1)
  })
})
