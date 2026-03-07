import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { db } from '../../db/connection'
import { subscriptionTiers, subscriptions } from '../../db/schema'
import { createTestApp, createTestToken, createTestUser, cleanupAllTestData } from '../../__tests__/test-helpers'

describe('Subscriptions Access Control', () => {
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

  it('blocks users from reading another user subscriptions', async () => {
    const subscriber = await createTestUser({ name: 'Subscriber' })
    const otherUser = await createTestUser({ name: 'Other User' })
    const author = await createTestUser({ name: 'Author' })

    const [tier] = await db.insert(subscriptionTiers).values({
      authorId: author.id,
      name: 'Supporter',
      tierLevel: 1,
      chapterDelayDays: 0
    }).returning()

    await db.insert(subscriptions).values({
      subscriberId: subscriber.id,
      authorId: author.id,
      tierId: tier!.id,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    })

    const token = await createTestToken(otherUser.id)

    const response = await app.inject({
      method: 'GET',
      url: `/api/users/${subscriber.id}/subscriptions`,
      headers: { authorization: `Bearer ${token}` }
    })

    expect(response.statusCode).toBe(403)
  })

  it('returns active subscriptions for the authenticated subscriber', async () => {
    const subscriber = await createTestUser({ name: 'Subscriber 2' })
    const author = await createTestUser({ name: 'Author 2' })

    const [tier] = await db.insert(subscriptionTiers).values({
      authorId: author.id,
      name: 'Premium',
      tierLevel: 2,
      chapterDelayDays: 0
    }).returning()

    await db.insert(subscriptions).values({
      subscriberId: subscriber.id,
      authorId: author.id,
      tierId: tier!.id,
      status: 'active',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    })

    const token = await createTestToken(subscriber.id)
    const response = await app.inject({
      method: 'GET',
      url: `/api/users/${subscriber.id}/subscriptions?status=active`,
      headers: { authorization: `Bearer ${token}` }
    })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)
    expect(Array.isArray(payload.subscriptions)).toBe(true)
    expect(payload.subscriptions.length).toBe(1)
    expect(payload.subscriptions[0].subscription.status).toBe('active')
    expect(payload.subscriptions[0].tier.name).toBe('Premium')
    expect(payload.subscriptions[0].author.id).toBe(author.id)
  })
})
