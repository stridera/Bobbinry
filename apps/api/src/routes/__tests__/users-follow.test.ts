import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import * as jose from 'jose'
import { sql, and, eq } from 'drizzle-orm'
import { build } from '../../server'
import { db } from '../../db/connection'
import { users, userFollowers } from '../../db/schema'
import { getJwtSecret } from '../../middleware/auth'

async function createTestToken(userId: string): Promise<string> {
  return new jose.SignJWT({ id: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(getJwtSecret())
}

describe('Users Follow API', () => {
  let app: any

  beforeAll(async () => {
    app = build({ logger: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    await db.delete(userFollowers).where(sql`true`)
    await db.delete(users).where(sql`true`)
  })

  it('prevents duplicate follow relationships', async () => {
    const [follower] = await db.insert(users).values({
      email: 'follower@example.com',
      name: 'Follower'
    }).returning()

    const [following] = await db.insert(users).values({
      email: 'following@example.com',
      name: 'Following'
    }).returning()

    const token = await createTestToken(follower!.id)

    const first = await app.inject({
      method: 'POST',
      url: `/api/users/${follower!.id}/follow`,
      headers: { authorization: `Bearer ${token}` },
      payload: { followingId: following!.id }
    })

    const second = await app.inject({
      method: 'POST',
      url: `/api/users/${follower!.id}/follow`,
      headers: { authorization: `Bearer ${token}` },
      payload: { followingId: following!.id }
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(400)

    const rows = await db
      .select()
      .from(userFollowers)
      .where(and(
        eq(userFollowers.followerId, follower!.id),
        eq(userFollowers.followingId, following!.id)
      ))

    expect(rows.length).toBe(1)
  })
})

