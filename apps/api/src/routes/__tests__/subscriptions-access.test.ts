import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import * as jose from 'jose'
import { sql } from 'drizzle-orm'
import { build } from '../../server'
import { db } from '../../db/connection'
import { users, subscriptionTiers, subscriptions } from '../../db/schema'
import { getJwtSecret } from '../../middleware/auth'

async function createTestToken(userId: string): Promise<string> {
  return new jose.SignJWT({ id: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(getJwtSecret())
}

describe('Subscriptions Access Control', () => {
  let app: any

  beforeAll(async () => {
    app = build({ logger: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    await db.delete(subscriptions).where(sql`true`)
    await db.delete(subscriptionTiers).where(sql`true`)
    await db.delete(users).where(sql`true`)
  })

  it('blocks users from reading another user subscriptions', async () => {
    const [subscriber] = await db.insert(users).values({
      email: 'subscriber@example.com',
      name: 'Subscriber'
    }).returning()

    const [otherUser] = await db.insert(users).values({
      email: 'other-user@example.com',
      name: 'Other User'
    }).returning()

    const [author] = await db.insert(users).values({
      email: 'author@example.com',
      name: 'Author'
    }).returning()

    const [tier] = await db.insert(subscriptionTiers).values({
      authorId: author!.id,
      name: 'Supporter',
      tierLevel: 1,
      chapterDelayDays: 0
    }).returning()

    await db.insert(subscriptions).values({
      subscriberId: subscriber!.id,
      authorId: author!.id,
      tierId: tier!.id,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    })

    const token = await createTestToken(otherUser!.id)

    const response = await app.inject({
      method: 'GET',
      url: `/api/users/${subscriber!.id}/subscriptions`,
      headers: { authorization: `Bearer ${token}` }
    })

    expect(response.statusCode).toBe(403)
  })

  it('returns active subscriptions for the authenticated subscriber', async () => {
    const [subscriber] = await db.insert(users).values({
      email: 'subscriber2@example.com',
      name: 'Subscriber 2'
    }).returning()

    const [author] = await db.insert(users).values({
      email: 'author2@example.com',
      name: 'Author 2'
    }).returning()

    const [tier] = await db.insert(subscriptionTiers).values({
      authorId: author!.id,
      name: 'Premium',
      tierLevel: 2,
      chapterDelayDays: 0
    }).returning()

    await db.insert(subscriptions).values({
      subscriberId: subscriber!.id,
      authorId: author!.id,
      tierId: tier!.id,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    })

    const token = await createTestToken(subscriber!.id)
    const response = await app.inject({
      method: 'GET',
      url: `/api/users/${subscriber!.id}/subscriptions?status=active`,
      headers: { authorization: `Bearer ${token}` }
    })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)
    expect(Array.isArray(payload.subscriptions)).toBe(true)
    expect(payload.subscriptions.length).toBe(1)
    expect(payload.subscriptions[0].subscription.status).toBe('active')
    expect(payload.subscriptions[0].tier.name).toBe('Premium')
    expect(payload.subscriptions[0].author.id).toBe(author!.id)
  })
})
