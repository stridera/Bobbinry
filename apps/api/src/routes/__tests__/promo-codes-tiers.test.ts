import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import {
  users,
  userBadges,
  subscriptionTiers,
  sitePromoCodes,
  sitePromoCampaigns,
  sitePromoRedemptions,
  siteMemberships,
} from '../../db/schema'
import { createTestApp, createTestToken, createTestUser, cleanupAllTestData } from '../../__tests__/test-helpers'
import { generateCampaignSecret, generateCampaignCode } from '../../lib/promo-hmac'

/**
 * Site-wide promo codes / gift campaigns (apps/api/src/routes/promo-codes.ts)
 * and author subscription tiers (apps/api/src/routes/users/tiers.ts).
 *
 * Promo code + campaign *creation via the API* needs Stripe only for the
 * discount-code path (it creates a Stripe coupon); campaign creation has no
 * Stripe dependency at all. Where Stripe is required we assert the
 * "not configured" behaviour with STRIPE_SECRET_KEY unset, and set up
 * discount-code fixtures via direct DB inserts instead of the API.
 */
describe('Promo codes & subscription tiers', () => {
  let app: any

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    delete process.env.STRIPE_SECRET_KEY
    await cleanupAllTestData()
  })

  async function verifiedUser() {
    const user = await createTestUser()
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
    return { user, token: await createTestToken(user.id) }
  }

  async function ownerUser() {
    const { user, token } = await verifiedUser()
    await db.insert(userBadges).values({ userId: user.id, badge: 'owner' })
    return { user, token }
  }

  function inject(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, token?: string, payload?: unknown) {
    return app.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload,
    })
  }

  // ═══════════════════════════════════════════════════════════════
  // Subscription tiers (apps/api/src/routes/users/tiers.ts)
  // ═══════════════════════════════════════════════════════════════

  describe('subscription tiers', () => {
    it('401s create/update/delete/tier-unlocks without a token', async () => {
      const { user } = await verifiedUser()
      const createRes = await inject('POST', `/api/users/${user.id}/subscription-tiers`, undefined, { name: 'X', tierLevel: 1 })
      expect(createRes.statusCode).toBe(401)

      const updateRes = await inject('PUT', `/api/users/${user.id}/subscription-tiers/${user.id}`, undefined, { name: 'Y' })
      expect(updateRes.statusCode).toBe(401)

      const deleteRes = await inject('DELETE', `/api/users/${user.id}/subscription-tiers/${user.id}`, undefined)
      expect(deleteRes.statusCode).toBe(401)

      const unlocksRes = await inject('GET', `/api/users/${user.id}/tier-unlocks`, undefined)
      expect(unlocksRes.statusCode).toBe(401)
    })

    it('refuses another user with 403 "Forbidden" (requireSelf) on create/update/delete', async () => {
      const { user: author } = await verifiedUser()
      const { token: attackerToken } = await verifiedUser()

      const createRes = await inject('POST', `/api/users/${author.id}/subscription-tiers`, attackerToken, { name: 'X', tierLevel: 1 })
      expect(createRes.statusCode).toBe(403)
      expect(JSON.parse(createRes.payload)).toEqual({ error: 'Forbidden', message: 'You can only access your own data' })

      const updateRes = await inject('PUT', `/api/users/${author.id}/subscription-tiers/${author.id}`, attackerToken, { name: 'Y' })
      expect(updateRes.statusCode).toBe(403)

      const deleteRes = await inject('DELETE', `/api/users/${author.id}/subscription-tiers/${author.id}`, attackerToken)
      expect(deleteRes.statusCode).toBe(403)
    })

    it('rejects a missing or blank tier name with 400 "Tier name is required"', async () => {
      const { user, token } = await verifiedUser()

      const missing = await inject('POST', `/api/users/${user.id}/subscription-tiers`, token, { tierLevel: 1 })
      expect(missing.statusCode).toBe(400)
      expect(JSON.parse(missing.payload)).toEqual({ error: 'Tier name is required' })

      const blank = await inject('POST', `/api/users/${user.id}/subscription-tiers`, token, { name: '   ', tierLevel: 1 })
      expect(blank.statusCode).toBe(400)
      expect(JSON.parse(blank.payload)).toEqual({ error: 'Tier name is required' })
    })

    it('creates a free tier without touching Stripe (no priceMonthly/priceYearly > 0)', async () => {
      const { user, token } = await verifiedUser()
      const res = await inject('POST', `/api/users/${user.id}/subscription-tiers`, token, {
        name: 'Free Tier',
        tierLevel: 1,
        earlyAccessDays: 3,
      })
      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.payload)
      expect(body.tier.name).toBe('Free Tier')
      expect(body.tier.authorId).toBe(user.id)
      expect(body.tier.isActive).toBe(true)
      expect(body.onboardingUrl).toBeUndefined()
    })

    it('creates a paid tier and succeeds without an onboardingUrl when Stripe is not configured', async () => {
      delete process.env.STRIPE_SECRET_KEY
      const { user, token } = await verifiedUser()
      const res = await inject('POST', `/api/users/${user.id}/subscription-tiers`, token, {
        name: 'Paid Tier',
        tierLevel: 1,
        priceMonthly: '5.00',
      })
      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.payload)
      expect(body.tier.name).toBe('Paid Tier')
      expect(body).not.toHaveProperty('onboardingUrl')
    })

    it('lists tiers for an author on the public endpoint, and never leaks Stripe fields', async () => {
      const { user, token } = await verifiedUser()
      await inject('POST', `/api/users/${user.id}/subscription-tiers`, token, { name: 'Tier A', tierLevel: 1 })
      await inject('POST', `/api/users/${user.id}/subscription-tiers`, token, { name: 'Tier B', tierLevel: 2 })

      const res = await inject('GET', `/api/users/${user.id}/subscription-tiers`, undefined)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.acceptsPayments).toBe(false)
      expect(body.tiers).toHaveLength(2)
      for (const tier of body.tiers) {
        expect(JSON.stringify(tier).toLowerCase()).not.toContain('stripe')
      }
    })

    it('rejects an invalid userId format on the public list endpoint with 400', async () => {
      const res = await inject('GET', '/api/users/not-a-uuid/subscription-tiers', undefined)
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Invalid user ID format' })
    })

    it('updates only allow-listed fields — a smuggled authorId is ignored', async () => {
      const { user: author, token } = await verifiedUser()
      const { user: intruder } = await verifiedUser()
      const created = JSON.parse(
        (await inject('POST', `/api/users/${author.id}/subscription-tiers`, token, { name: 'Original', tierLevel: 1 })).payload
      )

      const res = await inject('PUT', `/api/users/${author.id}/subscription-tiers/${created.tier.id}`, token, {
        name: 'Renamed',
        authorId: intruder.id,
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.tier.name).toBe('Renamed')
      expect(body.tier.authorId).toBe(author.id)
    })

    it('returns 404 updating a tier ID that does not exist', async () => {
      const { user, token } = await verifiedUser()
      const res = await inject('PUT', `/api/users/${user.id}/subscription-tiers/${user.id}`, token, { name: 'X' })
      // user.id is a valid UUID but not a tier id — falls through to not-found
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Tier not found' })
    })

    it('rejects an invalid tierId format on update with 400', async () => {
      const { user, token } = await verifiedUser()
      const res = await inject('PUT', `/api/users/${user.id}/subscription-tiers/not-a-uuid`, token, { name: 'X' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Invalid tier ID format' })
    })

    it('a deactivated tier stays in the author\'s own list but disappears from what readers see', async () => {
      const { user, token } = await verifiedUser()
      const other = await verifiedUser()
      const created = JSON.parse(
        (await inject('POST', `/api/users/${user.id}/subscription-tiers`, token, { name: 'ToDeactivate', tierLevel: 1 })).payload
      )
      const deactivate = await inject('PUT', `/api/users/${user.id}/subscription-tiers/${created.tier.id}`, token, { isActive: false })
      expect(deactivate.statusCode).toBe(200)
      expect(JSON.parse(deactivate.payload).tier.isActive).toBe(false)

      const own = JSON.parse((await inject('GET', `/api/users/${user.id}/subscription-tiers`, token)).payload)
      expect(own.tiers.some((t: any) => t.id === created.tier.id && t.isActive === false)).toBe(true)
      for (const viewerToken of [undefined, other.token]) {
        const list = JSON.parse((await inject('GET', `/api/users/${user.id}/subscription-tiers`, viewerToken)).payload)
        expect(list.tiers.some((t: any) => t.id === created.tier.id)).toBe(false)
      }
    })

    it('rejects non-numeric or negative prices, levels and early-access days with 400', async () => {
      const { user, token } = await verifiedUser()
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ name: 'T', tierLevel: 'abc' }, 'tierLevel must be a non-negative integer'],
        [{ name: 'T' }, 'tierLevel must be a non-negative integer'],
        [{ name: 'T', tierLevel: 1, priceMonthly: '-5' }, 'priceMonthly must be a non-negative number'],
        [{ name: 'T', tierLevel: 1, priceYearly: 'free' }, 'priceYearly must be a non-negative number'],
        [{ name: 'T', tierLevel: 1, earlyAccessDays: 1.5 }, 'earlyAccessDays must be a non-negative integer'],
      ]
      for (const [body, message] of cases) {
        const res = await inject('POST', `/api/users/${user.id}/subscription-tiers`, token, body)
        expect(res.statusCode).toBe(400)
        expect(JSON.parse(res.payload)).toEqual({ error: message })
      }
      const created = JSON.parse((await inject('POST', `/api/users/${user.id}/subscription-tiers`, token, { name: 'T', tierLevel: 1 })).payload)
      const bad = await inject('PUT', `/api/users/${user.id}/subscription-tiers/${created.tier.id}`, token, { tierLevel: -1 })
      expect(bad.statusCode).toBe(400)
      const ok = await inject('PUT', `/api/users/${user.id}/subscription-tiers/${created.tier.id}`, token, { priceMonthly: '4.50' })
      expect(ok.statusCode).toBe(200)
    })

    it('deletes a tier (own tiers only) and it disappears from the list', async () => {
      const { user, token } = await verifiedUser()
      const created = JSON.parse(
        (await inject('POST', `/api/users/${user.id}/subscription-tiers`, token, { name: 'ToDelete', tierLevel: 1 })).payload
      )
      const del = await inject('DELETE', `/api/users/${user.id}/subscription-tiers/${created.tier.id}`, token)
      expect(del.statusCode).toBe(200)
      expect(JSON.parse(del.payload)).toEqual({ success: true })

      const list = JSON.parse((await inject('GET', `/api/users/${user.id}/subscription-tiers`, undefined)).payload)
      expect(list.tiers.find((t: any) => t.id === created.tier.id)).toBeUndefined()
    })

    it('returns an empty tier-unlocks list for an author with no tiers', async () => {
      const { user, token } = await verifiedUser()
      const res = await inject('GET', `/api/users/${user.id}/tier-unlocks`, token)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ tiers: [] })
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // Admin: site promo (discount) codes
  // ═══════════════════════════════════════════════════════════════

  describe('admin discount codes', () => {
    it('401s every admin promo-code route without a token', async () => {
      expect((await inject('GET', '/api/admin/promo-codes', undefined)).statusCode).toBe(401)
      expect((await inject('POST', '/api/admin/promo-codes', undefined, {})).statusCode).toBe(401)
      expect((await inject('PUT', '/api/admin/promo-codes/00000000-0000-0000-0000-000000000000', undefined, {})).statusCode).toBe(401)
      expect((await inject('DELETE', '/api/admin/promo-codes/00000000-0000-0000-0000-000000000000', undefined)).statusCode).toBe(401)
      expect((await inject('GET', '/api/admin/promo-codes/00000000-0000-0000-0000-000000000000/redemptions', undefined)).statusCode).toBe(401)
    })

    it('rejects a verified non-owner with 403 "Owner access required" (requireOwner)', async () => {
      const { token } = await verifiedUser()
      const res = await inject('POST', '/api/admin/promo-codes', token, {
        code: 'NOPE', discountType: 'percent', discountValue: 10,
      })
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Forbidden', message: 'Owner access required' })
    })

    it('rejects a create missing code/discountType/discountValue with 400', async () => {
      const { token } = await ownerUser()
      const res = await inject('POST', '/api/admin/promo-codes', token, { discountType: 'percent' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'code, discountType, and discountValue are required' })
    })

    it('rejects creating a code that already exists with 409, before ever calling Stripe', async () => {
      const { user: admin, token } = await ownerUser()
      await db.insert(sitePromoCodes).values({
        code: 'DUPE10',
        stripeCouponId: 'coupon_fixture',
        discountType: 'percent',
        discountValue: '10.00',
        createdBy: admin.id,
      })

      const res = await inject('POST', '/api/admin/promo-codes', token, {
        code: 'dupe10', discountType: 'percent', discountValue: 10,
      })
      expect(res.statusCode).toBe(409)
      expect(JSON.parse(res.payload)).toEqual({ error: 'A promo code with this code already exists' })
    })

    it('returns 503 "Stripe not configured" creating a new code with STRIPE_SECRET_KEY unset', async () => {
      delete process.env.STRIPE_SECRET_KEY
      const { token } = await ownerUser()
      const res = await inject('POST', '/api/admin/promo-codes', token, {
        code: 'FRESH10', discountType: 'percent', discountValue: 10,
      })
      expect(res.statusCode).toBe(503)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Stripe not configured' })
    })

    it('lists codes and supports the active=true filter', async () => {
      const { user: admin, token } = await ownerUser()
      await db.insert(sitePromoCodes).values([
        { code: 'ACTIVE1', stripeCouponId: 'c1', discountType: 'percent', discountValue: '10.00', createdBy: admin.id, isActive: true },
        { code: 'INACTIVE1', stripeCouponId: 'c2', discountType: 'percent', discountValue: '10.00', createdBy: admin.id, isActive: false },
      ])

      const all = JSON.parse((await inject('GET', '/api/admin/promo-codes', token)).payload)
      expect(all.codes.map((c: any) => c.code).sort()).toEqual(['ACTIVE1', 'INACTIVE1'])

      const activeOnly = JSON.parse((await inject('GET', '/api/admin/promo-codes?active=true', token)).payload)
      expect(activeOnly.codes.map((c: any) => c.code)).toEqual(['ACTIVE1'])
    })

    it('updates a code (deactivate) and returns 404 for an unknown id', async () => {
      const { user: admin, token } = await ownerUser()
      const [created] = await db.insert(sitePromoCodes).values({
        code: 'TOGGLE1', stripeCouponId: 'c3', discountType: 'percent', discountValue: '10.00', createdBy: admin.id,
      }).returning()

      const res = await inject('PUT', `/api/admin/promo-codes/${created!.id}`, token, { isActive: false })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).isActive).toBe(false)

      const missing = await inject('PUT', '/api/admin/promo-codes/00000000-0000-0000-0000-000000000000', token, { isActive: false })
      expect(missing.statusCode).toBe(404)
      expect(JSON.parse(missing.payload)).toEqual({ error: 'Promo code not found' })
    })

    it('deactivates via DELETE and returns 404 for an unknown id', async () => {
      const { user: admin, token } = await ownerUser()
      const [created] = await db.insert(sitePromoCodes).values({
        code: 'DEL1', stripeCouponId: 'c4', discountType: 'percent', discountValue: '10.00', createdBy: admin.id,
      }).returning()

      const res = await inject('DELETE', `/api/admin/promo-codes/${created!.id}`, token)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ success: true })
      const [row] = await db.select().from(sitePromoCodes).where(eq(sitePromoCodes.id, created!.id))
      expect(row!.isActive).toBe(false)

      const missing = await inject('DELETE', '/api/admin/promo-codes/00000000-0000-0000-0000-000000000000', token)
      expect(missing.statusCode).toBe(404)
    })

    it('lists redemptions for a code with the redeeming user joined in', async () => {
      const { user: admin, token } = await ownerUser()
      const { user: redeemer } = await verifiedUser()
      const [code] = await db.insert(sitePromoCodes).values({
        code: 'REDEEMED1', stripeCouponId: 'c5', discountType: 'percent', discountValue: '10.00', createdBy: admin.id,
      }).returning()
      await db.insert(sitePromoRedemptions).values({
        userId: redeemer.id, promoCodeId: code!.id, resultType: 'checkout_discount',
      })

      const res = await inject('GET', `/api/admin/promo-codes/${code!.id}/redemptions`, token)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.redemptions).toHaveLength(1)
      expect(body.redemptions[0].userId).toBe(redeemer.id)
      expect(body.redemptions[0].email).toBe(redeemer.email)
    })

    it('is not scoped to the creating admin — a different owner-badge user can still manage the code', async () => {
      // No per-creator ownership check exists on the admin promo-code routes:
      // any user with the 'owner' badge can update/deactivate any code,
      // including ones created by a different admin.
      const { user: creator } = await ownerUser()
      const { token: otherOwnerToken } = await ownerUser()
      const [code] = await db.insert(sitePromoCodes).values({
        code: 'CROSSADMIN1', stripeCouponId: 'c6', discountType: 'percent', discountValue: '10.00', createdBy: creator.id,
      }).returning()

      const res = await inject('PUT', `/api/admin/promo-codes/${code!.id}`, otherOwnerToken, { isActive: false })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).isActive).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // Admin: gift campaigns (HMAC codes, no Stripe dependency)
  // ═══════════════════════════════════════════════════════════════

  describe('admin gift campaigns', () => {
    it('401s every admin campaign route without a token', async () => {
      expect((await inject('GET', '/api/admin/campaigns', undefined)).statusCode).toBe(401)
      expect((await inject('POST', '/api/admin/campaigns', undefined, {})).statusCode).toBe(401)
      expect((await inject('PUT', '/api/admin/campaigns/00000000-0000-0000-0000-000000000000', undefined, {})).statusCode).toBe(401)
      expect((await inject('DELETE', '/api/admin/campaigns/00000000-0000-0000-0000-000000000000', undefined)).statusCode).toBe(401)
      expect((await inject('POST', '/api/admin/campaigns/00000000-0000-0000-0000-000000000000/generate-codes', undefined, { count: 1 })).statusCode).toBe(401)
      expect((await inject('GET', '/api/admin/campaigns/00000000-0000-0000-0000-000000000000/redemptions', undefined)).statusCode).toBe(401)
    })

    it('rejects a verified non-owner with 403 on campaign create', async () => {
      const { token } = await verifiedUser()
      const res = await inject('POST', '/api/admin/campaigns', token, { name: 'X', prefix: 'ABC', giftDurationMonths: 3 })
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Forbidden', message: 'Owner access required' })
    })

    it('validates required fields, prefix format, and prefix uniqueness on create', async () => {
      const { token } = await ownerUser()

      const missing = await inject('POST', '/api/admin/campaigns', token, { name: 'X' })
      expect(missing.statusCode).toBe(400)
      expect(JSON.parse(missing.payload)).toEqual({ error: 'name, prefix, and giftDurationMonths are required' })

      const badPrefix = await inject('POST', '/api/admin/campaigns', token, { name: 'X', prefix: 'AB-C', giftDurationMonths: 3 })
      expect(badPrefix.statusCode).toBe(400)
      expect(JSON.parse(badPrefix.payload)).toEqual({ error: 'Prefix must be alphanumeric (A-Z, 0-9)' })

      const created = await inject('POST', '/api/admin/campaigns', token, { name: 'Launch Gift', prefix: 'LAUNCH', giftDurationMonths: 3 })
      expect(created.statusCode).toBe(201)
      const body = JSON.parse(created.payload)
      expect(body.prefix).toBe('LAUNCH')
      expect(body.codeCount).toBe(0)
      expect(body).not.toHaveProperty('secret')

      const dupe = await inject('POST', '/api/admin/campaigns', token, { name: 'Dupe', prefix: 'launch', giftDurationMonths: 1 })
      expect(dupe.statusCode).toBe(409)
      expect(JSON.parse(dupe.payload)).toEqual({ error: 'A campaign with this prefix already exists' })
    })

    it('lists campaigns without ever exposing the HMAC secret', async () => {
      const { token } = await ownerUser()
      await inject('POST', '/api/admin/campaigns', token, { name: 'Listed', prefix: 'LISTED', giftDurationMonths: 6 })

      const res = await inject('GET', '/api/admin/campaigns', token)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.campaigns.length).toBeGreaterThanOrEqual(1)
      for (const c of body.campaigns) {
        expect(c).not.toHaveProperty('secret')
      }
    })

    it('updates a campaign and returns 404 for an unknown id', async () => {
      const { token } = await ownerUser()
      const created = JSON.parse(
        (await inject('POST', '/api/admin/campaigns', token, { name: 'Updatable', prefix: 'UPDX', giftDurationMonths: 2 })).payload
      )

      const res = await inject('PUT', `/api/admin/campaigns/${created.id}`, token, { isActive: false })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).isActive).toBe(false)

      const missing = await inject('PUT', '/api/admin/campaigns/00000000-0000-0000-0000-000000000000', token, { isActive: false })
      expect(missing.statusCode).toBe(404)
      expect(JSON.parse(missing.payload)).toEqual({ error: 'Campaign not found' })
    })

    it('deactivates via DELETE and returns 404 for an unknown id', async () => {
      const { token } = await ownerUser()
      const created = JSON.parse(
        (await inject('POST', '/api/admin/campaigns', token, { name: 'Deletable', prefix: 'DELX', giftDurationMonths: 2 })).payload
      )

      const res = await inject('DELETE', `/api/admin/campaigns/${created.id}`, token)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ success: true })

      const missing = await inject('DELETE', '/api/admin/campaigns/00000000-0000-0000-0000-000000000000', token)
      expect(missing.statusCode).toBe(404)
    })

    it('generates codes: validates count, 404s an unknown campaign, and produces HMAC-matching codes', async () => {
      const { token } = await ownerUser()
      const created = JSON.parse(
        (await inject('POST', '/api/admin/campaigns', token, { name: 'Codes', prefix: 'CODEX', giftDurationMonths: 4 })).payload
      )

      const zero = await inject('POST', `/api/admin/campaigns/${created.id}/generate-codes`, token, { count: 0 })
      expect(zero.statusCode).toBe(400)
      expect(JSON.parse(zero.payload)).toEqual({ error: 'count must be between 1 and 10000' })

      const tooMany = await inject('POST', `/api/admin/campaigns/${created.id}/generate-codes`, token, { count: 10001 })
      expect(tooMany.statusCode).toBe(400)

      const missing = await inject('POST', '/api/admin/campaigns/00000000-0000-0000-0000-000000000000/generate-codes', token, { count: 1 })
      expect(missing.statusCode).toBe(404)
      expect(JSON.parse(missing.payload)).toEqual({ error: 'Campaign not found' })

      const first = await inject('POST', `/api/admin/campaigns/${created.id}/generate-codes`, token, { count: 3 })
      expect(first.statusCode).toBe(200)
      const firstBody = JSON.parse(first.payload)
      expect(firstBody.startSeq).toBe(1)
      expect(firstBody.endSeq).toBe(3)
      expect(firstBody.totalCodes).toBe(3)
      expect(firstBody.codes).toHaveLength(3)

      const [row] = await db.select().from(sitePromoCampaigns).where(eq(sitePromoCampaigns.id, created.id))
      expect(firstBody.codes).toEqual([
        generateCampaignCode(row!.secret, row!.prefix, 1),
        generateCampaignCode(row!.secret, row!.prefix, 2),
        generateCampaignCode(row!.secret, row!.prefix, 3),
      ])

      // A second batch continues the sequence rather than restarting it.
      const second = await inject('POST', `/api/admin/campaigns/${created.id}/generate-codes`, token, { count: 2 })
      const secondBody = JSON.parse(second.payload)
      expect(secondBody.startSeq).toBe(4)
      expect(secondBody.endSeq).toBe(5)
      expect(secondBody.totalCodes).toBe(5)
    })

    it('lists redemptions for a campaign with the redeeming user joined in', async () => {
      const { user: admin, token } = await ownerUser()
      const { user: redeemer } = await verifiedUser()
      const [campaign] = await db.insert(sitePromoCampaigns).values({
        name: 'RedemptionCampaign', prefix: 'REDEEM1', secret: generateCampaignSecret(),
        giftDurationMonths: 1, codeCount: 1, createdBy: admin.id,
      }).returning()
      await db.insert(sitePromoRedemptions).values({
        userId: redeemer.id, campaignId: campaign!.id, resultType: 'membership_granted',
      })

      const res = await inject('GET', `/api/admin/campaigns/${campaign!.id}/redemptions`, token)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.redemptions).toHaveLength(1)
      expect(body.redemptions[0].userId).toBe(redeemer.id)
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // Public: validate & redeem
  // ═══════════════════════════════════════════════════════════════

  describe('public validate/redeem', () => {
    async function makeDiscountCode(overrides: Partial<typeof sitePromoCodes.$inferInsert> = {}) {
      const { user: admin } = await ownerUser()
      const [code] = await db.insert(sitePromoCodes).values({
        code: 'PUBLICSAVE',
        stripeCouponId: 'coupon_fixture',
        discountType: 'percent',
        discountValue: '15.00',
        createdBy: admin.id,
        ...overrides,
      }).returning()
      return code!
    }

    async function makeCampaign(overrides: Partial<typeof sitePromoCampaigns.$inferInsert> = {}) {
      const { user: admin } = await ownerUser()
      const secret = generateCampaignSecret()
      const prefix = overrides.prefix ?? 'PUBGIFT'
      const [campaign] = await db.insert(sitePromoCampaigns).values({
        name: 'Public Gift',
        prefix,
        secret,
        giftDurationMonths: 2,
        codeCount: 1,
        createdBy: admin.id,
        ...overrides,
      }).returning()
      return campaign!
    }

    it('401s validate and redeem without a token', async () => {
      expect((await inject('POST', '/api/promo-codes/validate', undefined, { code: 'X' })).statusCode).toBe(401)
      expect((await inject('POST', '/api/promo-codes/redeem', undefined, { code: 'X' })).statusCode).toBe(401)
    })

    it('rejects a missing code with 400 on both endpoints', async () => {
      const { token } = await verifiedUser()
      const v = await inject('POST', '/api/promo-codes/validate', token, {})
      expect(v.statusCode).toBe(400)
      expect(JSON.parse(v.payload)).toEqual({ error: 'code is required' })

      const r = await inject('POST', '/api/promo-codes/redeem', token, {})
      expect(r.statusCode).toBe(400)
      expect(JSON.parse(r.payload)).toEqual({ error: 'code is required' })
    })

    describe('discount codes', () => {
      it('validates an active, unredeemed discount code', async () => {
        const code = await makeDiscountCode()
        const { token } = await verifiedUser()
        const res = await inject('POST', '/api/promo-codes/validate', token, { code: code.code.toLowerCase() })
        expect(res.statusCode).toBe(200)
        expect(JSON.parse(res.payload)).toEqual({
          valid: true,
          type: 'discount',
          discountType: code.discountType,
          discountValue: code.discountValue,
          discountDurationMonths: code.discountDurationMonths,
          alreadyRedeemed: false,
        })
      })

      it('reports alreadyRedeemed:true when this user already has a redemption', async () => {
        const code = await makeDiscountCode()
        const { user, token } = await verifiedUser()
        await db.insert(sitePromoRedemptions).values({ userId: user.id, promoCodeId: code.id, resultType: 'checkout_discount' })

        const res = await inject('POST', '/api/promo-codes/validate', token, { code: code.code })
        expect(JSON.parse(res.payload).alreadyRedeemed).toBe(true)
      })

      it('reports an expired discount code as invalid with "This code has expired"', async () => {
        const code = await makeDiscountCode({ expiresAt: new Date(Date.now() - 86400_000) })
        const { token } = await verifiedUser()
        const res = await inject('POST', '/api/promo-codes/validate', token, { code: code.code })
        expect(res.statusCode).toBe(200)
        expect(JSON.parse(res.payload)).toEqual({ valid: false, error: 'This code has expired' })
      })

      it('reports an inactive discount code as invalid with the generic "Invalid code" message', async () => {
        const code = await makeDiscountCode({ isActive: false })
        const { token } = await verifiedUser()
        const res = await inject('POST', '/api/promo-codes/validate', token, { code: code.code })
        expect(JSON.parse(res.payload)).toEqual({ valid: false, error: 'Invalid code' })
      })

      it('reports an exhausted discount code (maxRedemptions reached) as no longer available', async () => {
        const code = await makeDiscountCode({ maxRedemptions: 1, currentRedemptions: 1 })
        const { token } = await verifiedUser()
        const res = await inject('POST', '/api/promo-codes/validate', token, { code: code.code })
        expect(JSON.parse(res.payload)).toEqual({ valid: false, error: 'This code is no longer available' })
      })

      it('reports an unknown code as invalid', async () => {
        const { token } = await verifiedUser()
        const res = await inject('POST', '/api/promo-codes/validate', token, { code: 'DOESNOTEXIST' })
        expect(JSON.parse(res.payload)).toEqual({ valid: false, error: 'Invalid code' })
      })
    })

    describe('gift campaign codes', () => {
      it('validates a valid gift code', async () => {
        const campaign = await makeCampaign({ prefix: 'VALIDATE1' })
        const goodCode = generateCampaignCode(campaign.secret, campaign.prefix, 1)
        const { token } = await verifiedUser()

        const res = await inject('POST', '/api/promo-codes/validate', token, { code: goodCode })
        expect(res.statusCode).toBe(200)
        expect(JSON.parse(res.payload)).toEqual({
          valid: true,
          type: 'gift',
          giftDurationMonths: campaign.giftDurationMonths,
          campaignName: campaign.name,
          alreadyRedeemed: false,
        })
      })

      it('reports an expired campaign code as invalid with "This code has expired"', async () => {
        const campaign = await makeCampaign({ prefix: 'EXPIRED1', expiresAt: new Date(Date.now() - 86400_000) })
        const code = generateCampaignCode(campaign.secret, campaign.prefix, 1)
        const { token } = await verifiedUser()
        const res = await inject('POST', '/api/promo-codes/validate', token, { code })
        expect(JSON.parse(res.payload)).toEqual({ valid: false, error: 'This code has expired' })
      })

      it('reports an exhausted campaign as no longer available', async () => {
        const campaign = await makeCampaign({ prefix: 'EXHAUST1', maxRedemptions: 1, currentRedemptions: 1 })
        const code = generateCampaignCode(campaign.secret, campaign.prefix, 1)
        const { token } = await verifiedUser()
        const res = await inject('POST', '/api/promo-codes/validate', token, { code })
        expect(JSON.parse(res.payload)).toEqual({ valid: false, error: 'This code is no longer available' })
      })

      it('refuses a code with a tampered HMAC suffix as "Invalid code"', async () => {
        const campaign = await makeCampaign({ prefix: 'TAMPER1' })
        const goodCode = generateCampaignCode(campaign.secret, campaign.prefix, 1)
        // Flip the last character of the suffix to break the HMAC match.
        const lastChar = goodCode.at(-1)!
        const replacement = lastChar === 'A' ? 'B' : 'A'
        const tampered = goodCode.slice(0, -1) + replacement
        const { token } = await verifiedUser()

        const res = await inject('POST', '/api/promo-codes/validate', token, { code: tampered })
        expect(JSON.parse(res.payload)).toEqual({ valid: false, error: 'Invalid code' })
      })
    })

    describe('redeem', () => {
      it('rejects a code with no dash as "Invalid gift code format"', async () => {
        const { token } = await verifiedUser()
        const res = await inject('POST', '/api/promo-codes/redeem', token, { code: 'NODASHCODE' })
        expect(res.statusCode).toBe(400)
        expect(JSON.parse(res.payload)).toEqual({ error: 'Invalid gift code format' })
      })

      it('rejects an unknown campaign prefix as "Invalid code"', async () => {
        const { token } = await verifiedUser()
        const res = await inject('POST', '/api/promo-codes/redeem', token, { code: 'NOSUCHPREFIX-ABCDEFGH' })
        expect(res.statusCode).toBe(400)
        expect(JSON.parse(res.payload)).toEqual({ error: 'Invalid code' })
      })

      it('rejects an expired campaign with "This code has expired"', async () => {
        const campaign = await makeCampaign({ prefix: 'REDEXP1', expiresAt: new Date(Date.now() - 86400_000) })
        const code = generateCampaignCode(campaign.secret, campaign.prefix, 1)
        const { token } = await verifiedUser()
        const res = await inject('POST', '/api/promo-codes/redeem', token, { code })
        expect(res.statusCode).toBe(400)
        expect(JSON.parse(res.payload)).toEqual({ error: 'This code has expired' })
      })

      it('rejects a tampered HMAC suffix with "Invalid code"', async () => {
        const campaign = await makeCampaign({ prefix: 'REDTAMPER1' })
        const goodCode = generateCampaignCode(campaign.secret, campaign.prefix, 1)
        const lastChar = goodCode.at(-1)!
        const replacement = lastChar === 'A' ? 'B' : 'A'
        const tampered = goodCode.slice(0, -1) + replacement
        const { token } = await verifiedUser()
        const res = await inject('POST', '/api/promo-codes/redeem', token, { code: tampered })
        expect(res.statusCode).toBe(400)
        expect(JSON.parse(res.payload)).toEqual({ error: 'Invalid code' })
      })

      it('redeems a valid gift code, grants a supporter membership, and blocks a second redemption', async () => {
        const campaign = await makeCampaign({ prefix: 'REDEEMOK1' })
        const code = generateCampaignCode(campaign.secret, campaign.prefix, 1)
        const { token } = await verifiedUser()

        const res = await inject('POST', '/api/promo-codes/redeem', token, { code })
        expect(res.statusCode).toBe(200)
        const body = JSON.parse(res.payload)
        expect(body.success).toBe(true)
        expect(body.membership.tier).toBe('supporter')
        expect(body.membership.giftDurationMonths).toBe(campaign.giftDurationMonths)

        const again = await inject('POST', '/api/promo-codes/redeem', token, { code })
        expect(again.statusCode).toBe(409)
        expect(JSON.parse(again.payload)).toEqual({ error: 'You have already redeemed a code from this campaign' })
      })

      it('rejects redemption once the campaign is exhausted with "This code is no longer available"', async () => {
        const campaign = await makeCampaign({ prefix: 'REDEXHAUST1', maxRedemptions: 1, currentRedemptions: 1 })
        const code = generateCampaignCode(campaign.secret, campaign.prefix, 1)
        const { token } = await verifiedUser()

        const res = await inject('POST', '/api/promo-codes/redeem', token, { code })
        expect(res.statusCode).toBe(400)
        expect(JSON.parse(res.payload)).toEqual({ error: 'This code is no longer available' })
      })

      it('rejects redemption for a user with an active paid supporter subscription', async () => {
        const campaign = await makeCampaign({ prefix: 'REDPAID1' })
        const code = generateCampaignCode(campaign.secret, campaign.prefix, 1)
        const { user, token } = await verifiedUser()
        await db.insert(siteMemberships).values({
          userId: user.id, tier: 'supporter', status: 'active', stripeSubscriptionId: 'sub_fixture',
        })

        const res = await inject('POST', '/api/promo-codes/redeem', token, { code })
        expect(res.statusCode).toBe(409)
        expect(JSON.parse(res.payload)).toEqual({ error: 'You already have an active paid supporter membership' })
      })
    })
  })
})
