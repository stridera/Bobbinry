import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { users, subscriptions, subscriptionTiers, subscriptionPayments, userPaymentConfig } from '../../db/schema'
import { getStripe } from '../../lib/stripe'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'

/**
 * Stripe webhook + membership money-movement tests.
 *
 * Stripe itself is never called — `lib/stripe`'s `getStripe()` is mocked so
 * `webhooks.constructEvent` is fully test-controlled, while the module's pure
 * helpers (getSubscriptionPeriod, splitName, HANDLED_WEBHOOK_EVENTS, etc.) are
 * the real implementations via `jest.requireActual`.
 */
jest.mock('../../lib/stripe', () => {
  const actual = jest.requireActual('../../lib/stripe')
  return {
    ...actual,
    getStripe: jest.fn(actual.getStripe),
  }
})

const mockGetStripe = getStripe as unknown as jest.Mock

type FakeEvent = { id: string; type: string; data: { object: Record<string, unknown> } }

function buildEvent(type: string, object: Record<string, unknown>): FakeEvent {
  return { id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } }
}

describe('Stripe webhook + membership routes', () => {
  let app: any
  let fakeStripe: any

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    fakeStripe = { webhooks: { constructEvent: jest.fn() } }
    mockGetStripe.mockReturnValue(fakeStripe)
  })

  afterEach(async () => {
    await cleanupAllTestData()
    delete process.env.STRIPE_WEBHOOK_SECRET
    delete process.env.STRIPE_SECRET_KEY
    mockGetStripe.mockReset()
  })

  function postWebhook(event: unknown, opts: { signature?: string | null } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const sig = opts.signature === undefined ? 't=1,v1=test' : opts.signature
    if (sig !== null) headers['stripe-signature'] = sig
    return app.inject({
      method: 'POST',
      url: '/api/stripe/webhook',
      headers,
      payload: JSON.stringify(event),
    })
  }

  /** Configure the mocked Stripe client to hand back `event` from constructEvent. */
  function stubEvent(event: FakeEvent) {
    fakeStripe.webhooks.constructEvent.mockReturnValue(event)
  }

  async function verifiedUser(overrides: { email?: string } = {}) {
    const user = await createTestUser(overrides)
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
    return { user, token: await createTestToken(user.id) }
  }

  async function createTier(authorId: string, tierLevel = 1) {
    const [tier] = await db.insert(subscriptionTiers).values({
      authorId,
      name: 'Patron',
      tierLevel,
    }).returning()
    return tier!
  }

  async function createSubscriptionRow(opts: {
    subscriberId: string
    authorId: string
    tierId: string
    stripeSubscriptionId: string
    status?: string
    currentPeriodStart?: Date
    currentPeriodEnd?: Date
    cancelAtPeriodEnd?: boolean
  }) {
    const [sub] = await db.insert(subscriptions).values({
      subscriberId: opts.subscriberId,
      authorId: opts.authorId,
      tierId: opts.tierId,
      stripeSubscriptionId: opts.stripeSubscriptionId,
      status: opts.status ?? 'active',
      currentPeriodStart: opts.currentPeriodStart ?? new Date(),
      currentPeriodEnd: opts.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false,
    }).returning()
    return sub!
  }

  // ==========================================================================
  // 1. Signature verification
  // ==========================================================================

  it('returns 400 and writes nothing when the stripe-signature header is missing', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
    const event = buildEvent('customer.subscription.created', { id: 'sub_no_sig' })

    const res = await postWebhook(event, { signature: null })

    expect(res.statusCode).toBe(400)
    expect(fakeStripe.webhooks.constructEvent).not.toHaveBeenCalled()
    const rows = await db.select().from(subscriptions)
    expect(rows).toHaveLength(0)
  })

  it('an invalid signature is a 400 and writes nothing', async () => {
    // A forged or stale payload must not be retried by Stripe, so it is a
    // client error, not the generic 500 the top-level catch would produce.
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
    fakeStripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload')
    })
    const event = buildEvent('customer.subscription.created', { id: 'sub_bad_sig' })

    const res = await postWebhook(event)

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload).error).toBe('Invalid webhook signature')
    const rows = await db.select().from(subscriptions)
    expect(rows).toHaveLength(0)
  })

  // ==========================================================================
  // 2. customer.subscription.created
  // ==========================================================================

  it('customer.subscription.created inserts a subscriptions row from event metadata + period', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
    const author = await createTestUser()
    const subscriber = await createTestUser()
    const tier = await createTier(author.id)

    const periodStart = Math.floor(Date.now() / 1000)
    const periodEnd = periodStart + 30 * 24 * 60 * 60

    const event = buildEvent('customer.subscription.created', {
      id: 'sub_created_1',
      status: 'active',
      cancel_at_period_end: false,
      metadata: {
        bobbinry_subscriber_id: subscriber.id,
        bobbinry_author_id: author.id,
        bobbinry_tier_id: tier.id,
      },
      items: { data: [{ current_period_start: periodStart, current_period_end: periodEnd }] },
    })
    stubEvent(event)

    const res = await postWebhook(event)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({ received: true })

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, 'sub_created_1'))
    expect(row).toBeDefined()
    expect(row!.status).toBe('active')
    expect(row!.tierId).toBe(tier.id)
    expect(row!.authorId).toBe(author.id)
    expect(row!.subscriberId).toBe(subscriber.id)
    expect(row!.currentPeriodStart.getTime()).toBe(periodStart * 1000)
    expect(row!.currentPeriodEnd.getTime()).toBe(periodEnd * 1000)
  })

  // ==========================================================================
  // 3. customer.subscription.updated / .deleted
  // ==========================================================================

  it('customer.subscription.updated moves status, period start and period end', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
    const author = await createTestUser()
    const subscriber = await createTestUser()
    const tier = await createTier(author.id)
    const originalStart = new Date('2026-01-01T00:00:00Z')
    const sub = await createSubscriptionRow({
      subscriberId: subscriber.id,
      authorId: author.id,
      tierId: tier.id,
      stripeSubscriptionId: 'sub_updated_1',
      status: 'active',
      currentPeriodStart: originalStart,
      currentPeriodEnd: new Date('2026-02-01T00:00:00Z'),
      cancelAtPeriodEnd: false,
    })

    const newPeriodEnd = Math.floor(new Date('2026-03-01T00:00:00Z').getTime() / 1000)

    const newPeriodStart = newPeriodEnd - 30 * 24 * 60 * 60
    const event = buildEvent('customer.subscription.updated', {
      id: 'sub_updated_1',
      status: 'past_due',
      cancel_at_period_end: true,
      items: { data: [{ current_period_start: newPeriodStart, current_period_end: newPeriodEnd }] },
    })
    stubEvent(event)

    const res = await postWebhook(event)
    expect(res.statusCode).toBe(200)

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id))
    expect(row!.status).toBe('past_due')
    expect(row!.cancelAtPeriodEnd).toBe(true)
    expect(row!.currentPeriodEnd.getTime()).toBe(newPeriodEnd * 1000)
    expect(row!.currentPeriodStart.getTime()).toBe(newPeriodStart * 1000)
  })

  it("customer.subscription.deleted sets status to exactly 'canceled'", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
    const author = await createTestUser()
    const subscriber = await createTestUser()
    const tier = await createTier(author.id)
    const sub = await createSubscriptionRow({
      subscriberId: subscriber.id,
      authorId: author.id,
      tierId: tier.id,
      stripeSubscriptionId: 'sub_deleted_1',
      status: 'active',
    })

    const event = buildEvent('customer.subscription.deleted', { id: 'sub_deleted_1' })
    stubEvent(event)

    const res = await postWebhook(event)
    expect(res.statusCode).toBe(200)

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id))
    expect(row!.status).toBe('canceled')
  })

  // ==========================================================================
  // 4. invoice.payment_succeeded / invoice.payment_failed
  // ==========================================================================

  it('invoice.payment_succeeded records a succeeded payment and restores active status', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
    const author = await createTestUser()
    const subscriber = await createTestUser()
    const tier = await createTier(author.id)
    const sub = await createSubscriptionRow({
      subscriberId: subscriber.id,
      authorId: author.id,
      tierId: tier.id,
      stripeSubscriptionId: 'sub_pay_ok',
      status: 'past_due',
    })

    const newPeriodEnd = Math.floor(new Date('2026-04-01T00:00:00Z').getTime() / 1000)
    const event = buildEvent('invoice.payment_succeeded', {
      id: 'in_ok_1',
      subscription: 'sub_pay_ok',
      amount_paid: 999,
      currency: 'usd',
      payment_intent: 'pi_ok_1',
      lines: { data: [{ period: { end: newPeriodEnd } }] },
    })
    stubEvent(event)

    const res = await postWebhook(event)
    expect(res.statusCode).toBe(200)

    const [payment] = await db.select().from(subscriptionPayments).where(eq(subscriptionPayments.subscriptionId, sub.id))
    expect(payment).toBeDefined()
    expect(payment!.amount).toBe('9.99')
    expect(payment!.currency).toBe('USD')
    expect(payment!.status).toBe('succeeded')
    expect(payment!.stripePaymentIntentId).toBe('pi_ok_1')

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id))
    expect(row!.status).toBe('active')
    expect(row!.currentPeriodEnd.getTime()).toBe(newPeriodEnd * 1000)
  })

  it("invoice.payment_failed sets status to 'past_due' and records a failed payment", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
    const author = await createTestUser()
    const subscriber = await createTestUser()
    const tier = await createTier(author.id)
    const sub = await createSubscriptionRow({
      subscriberId: subscriber.id,
      authorId: author.id,
      tierId: tier.id,
      stripeSubscriptionId: 'sub_pay_fail',
      status: 'active',
    })

    const event = buildEvent('invoice.payment_failed', {
      id: 'in_fail_1',
      subscription: 'sub_pay_fail',
      amount_due: 500,
      currency: 'usd',
      payment_intent: 'pi_fail_1',
    })
    stubEvent(event)

    const res = await postWebhook(event)
    expect(res.statusCode).toBe(200)

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id))
    expect(row!.status).toBe('past_due')

    const [payment] = await db.select().from(subscriptionPayments).where(eq(subscriptionPayments.subscriptionId, sub.id))
    expect(payment).toBeDefined()
    expect(payment!.amount).toBe('5.00')
    expect(payment!.status).toBe('failed')
    expect(payment!.stripePaymentIntentId).toBe('pi_fail_1')
    expect(payment!.failureReason).toBe('Payment failed')
  })

  // ==========================================================================
  // 5. charge.refunded / account.updated
  // ==========================================================================

  it('charge.refunded marks the matching payment refunded', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
    const author = await createTestUser()
    const subscriber = await createTestUser()
    const tier = await createTier(author.id)
    const sub = await createSubscriptionRow({
      subscriberId: subscriber.id,
      authorId: author.id,
      tierId: tier.id,
      stripeSubscriptionId: 'sub_refund_1',
    })
    const [payment] = await db.insert(subscriptionPayments).values({
      subscriptionId: sub.id,
      amount: '9.99',
      currency: 'USD',
      status: 'succeeded',
      stripePaymentIntentId: 'pi_refund_target',
      paidAt: new Date(),
    }).returning()

    const event = buildEvent('charge.refunded', {
      id: 'ch_refund_1',
      payment_intent: 'pi_refund_target',
    })
    stubEvent(event)

    const res = await postWebhook(event)
    expect(res.statusCode).toBe(200)

    const [row] = await db.select().from(subscriptionPayments).where(eq(subscriptionPayments.id, payment!.id))
    expect(row!.status).toBe('refunded')
    expect(row!.refundedAt).not.toBeNull()
  })

  it('account.updated marks stripeOnboardingComplete when charges_enabled + details_submitted', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
    const author = await createTestUser()
    await db.insert(userPaymentConfig).values({
      userId: author.id,
      stripeAccountId: 'acct_connect_1',
      stripeAccountType: 'express',
      stripeOnboardingComplete: false,
    })

    const event = buildEvent('account.updated', {
      id: 'acct_connect_1',
      charges_enabled: true,
      details_submitted: true,
    })
    stubEvent(event)

    const res = await postWebhook(event)
    expect(res.statusCode).toBe(200)

    const [row] = await db.select().from(userPaymentConfig).where(eq(userPaymentConfig.userId, author.id))
    expect(row!.stripeOnboardingComplete).toBe(true)
  })

  // ==========================================================================
  // 6. Unknown event type
  // ==========================================================================

  it('an unknown event type returns 200 and changes nothing', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
    const event = buildEvent('payment_intent.succeeded', { id: 'pi_unhandled_1' })
    stubEvent(event)

    const res = await postWebhook(event)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({ received: true })

    const subRows = await db.select().from(subscriptions)
    const paymentRows = await db.select().from(subscriptionPayments)
    expect(subRows).toHaveLength(0)
    expect(paymentRows).toHaveLength(0)
  })

  // ==========================================================================
  // 7. Idempotency
  // ==========================================================================

  it('replaying the same customer.subscription.created event twice leaves exactly one row', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
    const author = await createTestUser()
    const subscriber = await createTestUser()
    const tier = await createTier(author.id)

    const periodStart = Math.floor(Date.now() / 1000)
    const periodEnd = periodStart + 30 * 24 * 60 * 60
    const event = buildEvent('customer.subscription.created', {
      id: 'sub_replay_1',
      status: 'active',
      cancel_at_period_end: false,
      metadata: {
        bobbinry_subscriber_id: subscriber.id,
        bobbinry_author_id: author.id,
        bobbinry_tier_id: tier.id,
      },
      items: { data: [{ current_period_start: periodStart, current_period_end: periodEnd }] },
    })
    stubEvent(event)

    const first = await postWebhook(event)
    const second = await postWebhook(event)

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, 'sub_replay_1'))
    expect(rows).toHaveLength(1)
  })

  // ==========================================================================
  // 8. Membership routes
  // ==========================================================================

  describe('GET /membership', () => {
    it('returns 401 without a token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/membership' })
      expect(res.statusCode).toBe(401)
    })

    it('returns the expected shape for a signed-in user with no membership', async () => {
      const { user, token } = await verifiedUser()
      const res = await app.inject({
        method: 'GET',
        url: '/api/membership',
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body).toEqual({
        user: { id: user.id, email: user.email, name: user.name },
        tier: 'free',
        badges: [],
        membership: null,
        emailVerified: true,
        hasPassword: false,
      })
    })
  })

  describe('POST /membership/checkout', () => {
    it('returns 401 without a token', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/membership/checkout', payload: {} })
      expect(res.statusCode).toBe(401)
    })

    it('returns 503 "Stripe not configured" when Stripe is unconfigured, not a 500', async () => {
      const { token } = await verifiedUser()
      delete process.env.STRIPE_SECRET_KEY
      mockGetStripe.mockReturnValueOnce(null)

      const res = await app.inject({
        method: 'POST',
        url: '/api/membership/checkout',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      })
      expect(res.statusCode).toBe(503)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Stripe not configured' })
    })
  })
})
