/**
 * Promo Codes & Gift Campaign Routes
 *
 * Admin CRUD for site-level discount codes and HMAC gift key campaigns.
 * Public validate/redeem endpoints for the membership page.
 *
 * Routes:
 *   GET    /admin/promo-codes                         — list discount codes
 *   POST   /admin/promo-codes                         — create discount code (+ Stripe coupon)
 *   PUT    /admin/promo-codes/:codeId                 — update discount code
 *   DELETE /admin/promo-codes/:codeId                 — deactivate discount code
 *   GET    /admin/promo-codes/:codeId/redemptions     — view redemptions
 *   GET    /admin/campaigns                           — list gift campaigns
 *   POST   /admin/campaigns                           — create gift campaign
 *   PUT    /admin/campaigns/:campaignId               — update campaign
 *   DELETE /admin/campaigns/:campaignId               — deactivate campaign
 *   POST   /admin/campaigns/:campaignId/generate-codes — generate printable codes
 *   GET    /admin/campaigns/:campaignId/redemptions   — view redemptions
 *   POST   /promo-codes/validate                      — validate any code (public, auth required)
 *   POST   /promo-codes/redeem                        — redeem a gift campaign code
 */

import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import {
  sitePromoCodes,
  sitePromoCampaigns,
  sitePromoRedemptions,
  siteMemberships,
  userBadges,
  users,
} from '../db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import { requireAuth, requireOwner, denyApiKeyAuth } from '../middleware/auth'
import { getStripe } from '../lib/stripe'
import type { Stripe } from 'stripe/cjs/stripe.core.js'
import {
  generateCampaignSecret,
  generateCampaignCodes,
  validateCampaignCode,
  parseCampaignPrefix,
} from '../lib/promo-hmac'

const promoCodesPlugin: FastifyPluginAsync = async (fastify) => {
  const adminPreHandler = [requireAuth, requireOwner, denyApiKeyAuth]

  // ─── Admin: Discount Codes ─────────────────────────────────────────

  /**
   * GET /admin/promo-codes — list all discount codes
   */
  fastify.get<{
    Querystring: { active?: string }
  }>('/admin/promo-codes', {
    preHandler: adminPreHandler,
  }, async (request, reply) => {
    const { active } = request.query
    const conditions = active === 'true' ? [eq(sitePromoCodes.isActive, true)] : []

    const codes = await db
      .select()
      .from(sitePromoCodes)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(sitePromoCodes.createdAt))

    return reply.send({ codes })
  })

  /**
   * POST /admin/promo-codes — create a discount code + Stripe coupon
   */
  fastify.post<{
    Body: {
      code: string
      discountType: 'percent' | 'fixed_amount'
      discountValue: number
      discountDurationMonths?: number
      maxRedemptions?: number
      expiresAt?: string
    }
  }>('/admin/promo-codes', {
    preHandler: adminPreHandler,
  }, async (request, reply) => {
    const { code, discountType, discountValue, discountDurationMonths, maxRedemptions, expiresAt } = request.body
    const user = request.user!

    if (!code || !discountType || discountValue == null) {
      return reply.status(400).send({ error: 'code, discountType, and discountValue are required' })
    }

    const normalizedCode = code.toUpperCase().trim()

    // Check uniqueness
    const [existing] = await db
      .select({ id: sitePromoCodes.id })
      .from(sitePromoCodes)
      .where(eq(sitePromoCodes.code, normalizedCode))
      .limit(1)

    if (existing) {
      return reply.status(409).send({ error: 'A promo code with this code already exists' })
    }

    // Create Stripe coupon
    const stripe = getStripe()
    if (!stripe) {
      return reply.status(503).send({ error: 'Stripe not configured' })
    }

    const couponParams: Stripe.CouponCreateParams = {
      name: normalizedCode,
      metadata: { bobbinry_promo_code: normalizedCode },
      ...(discountType === 'percent'
        ? { percent_off: discountValue }
        : { amount_off: Math.round(discountValue * 100), currency: 'usd' }),
      ...(discountDurationMonths
        ? { duration: 'repeating', duration_in_months: discountDurationMonths }
        : { duration: 'once' }),
    }

    const stripeCoupon = await stripe.coupons.create(couponParams)

    const [created] = await db
      .insert(sitePromoCodes)
      .values({
        code: normalizedCode,
        stripeCouponId: stripeCoupon.id,
        discountType,
        discountValue: String(discountValue),
        discountDurationMonths: discountDurationMonths || null,
        maxRedemptions: maxRedemptions || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy: user.id,
      })
      .returning()

    return reply.status(201).send(created)
  })

  /**
   * PUT /admin/promo-codes/:codeId — update discount code
   */
  fastify.put<{
    Params: { codeId: string }
    Body: { isActive?: boolean; maxRedemptions?: number | null; expiresAt?: string | null }
  }>('/admin/promo-codes/:codeId', {
    preHandler: adminPreHandler,
  }, async (request, reply) => {
    const { codeId } = request.params
    const { isActive, maxRedemptions, expiresAt } = request.body

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (isActive !== undefined) updates.isActive = isActive
    if (maxRedemptions !== undefined) updates.maxRedemptions = maxRedemptions
    if (expiresAt !== undefined) updates.expiresAt = expiresAt ? new Date(expiresAt) : null

    const [updated] = await db
      .update(sitePromoCodes)
      .set(updates)
      .where(eq(sitePromoCodes.id, codeId))
      .returning()

    if (!updated) {
      return reply.status(404).send({ error: 'Promo code not found' })
    }

    return reply.send(updated)
  })

  /**
   * DELETE /admin/promo-codes/:codeId — deactivate
   */
  fastify.delete<{
    Params: { codeId: string }
  }>('/admin/promo-codes/:codeId', {
    preHandler: adminPreHandler,
  }, async (request, reply) => {
    const { codeId } = request.params

    const [updated] = await db
      .update(sitePromoCodes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(sitePromoCodes.id, codeId))
      .returning()

    if (!updated) {
      return reply.status(404).send({ error: 'Promo code not found' })
    }

    return reply.send({ success: true })
  })

  /**
   * GET /admin/promo-codes/:codeId/redemptions
   */
  fastify.get<{
    Params: { codeId: string }
  }>('/admin/promo-codes/:codeId/redemptions', {
    preHandler: adminPreHandler,
  }, async (request, reply) => {
    const { codeId } = request.params

    const redemptions = await db
      .select({
        id: sitePromoRedemptions.id,
        userId: sitePromoRedemptions.userId,
        email: users.email,
        name: users.name,
        redeemedAt: sitePromoRedemptions.redeemedAt,
        resultType: sitePromoRedemptions.resultType,
        metadata: sitePromoRedemptions.metadata,
      })
      .from(sitePromoRedemptions)
      .innerJoin(users, eq(users.id, sitePromoRedemptions.userId))
      .where(eq(sitePromoRedemptions.promoCodeId, codeId))
      .orderBy(desc(sitePromoRedemptions.redeemedAt))

    return reply.send({ redemptions })
  })

  // ─── Admin: Gift Campaigns ─────────────────────────────────────────

  /**
   * GET /admin/campaigns — list all campaigns
   */
  fastify.get<{
    Querystring: { active?: string }
  }>('/admin/campaigns', {
    preHandler: adminPreHandler,
  }, async (request, reply) => {
    const { active } = request.query
    const conditions = active === 'true' ? [eq(sitePromoCampaigns.isActive, true)] : []

    const campaigns = await db
      .select({
        id: sitePromoCampaigns.id,
        name: sitePromoCampaigns.name,
        prefix: sitePromoCampaigns.prefix,
        codeCount: sitePromoCampaigns.codeCount,
        giftDurationMonths: sitePromoCampaigns.giftDurationMonths,
        maxRedemptions: sitePromoCampaigns.maxRedemptions,
        currentRedemptions: sitePromoCampaigns.currentRedemptions,
        expiresAt: sitePromoCampaigns.expiresAt,
        isActive: sitePromoCampaigns.isActive,
        createdAt: sitePromoCampaigns.createdAt,
      })
      .from(sitePromoCampaigns)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(sitePromoCampaigns.createdAt))

    // Don't expose secrets in the list
    return reply.send({ campaigns })
  })

  /**
   * POST /admin/campaigns — create a gift campaign
   */
  fastify.post<{
    Body: {
      name: string
      prefix: string
      giftDurationMonths: number
      maxRedemptions?: number
      expiresAt?: string
    }
  }>('/admin/campaigns', {
    preHandler: adminPreHandler,
  }, async (request, reply) => {
    const { name, prefix, giftDurationMonths, maxRedemptions, expiresAt } = request.body
    const user = request.user!

    if (!name || !prefix || !giftDurationMonths) {
      return reply.status(400).send({ error: 'name, prefix, and giftDurationMonths are required' })
    }

    const normalizedPrefix = prefix.toUpperCase().trim()

    if (!/^[A-Z0-9]+$/.test(normalizedPrefix)) {
      return reply.status(400).send({ error: 'Prefix must be alphanumeric (A-Z, 0-9)' })
    }

    // Check uniqueness against both campaigns and promo codes
    const [existingCampaign] = await db
      .select({ id: sitePromoCampaigns.id })
      .from(sitePromoCampaigns)
      .where(eq(sitePromoCampaigns.prefix, normalizedPrefix))
      .limit(1)

    if (existingCampaign) {
      return reply.status(409).send({ error: 'A campaign with this prefix already exists' })
    }

    const secret = generateCampaignSecret()

    const [created] = await db
      .insert(sitePromoCampaigns)
      .values({
        name,
        prefix: normalizedPrefix,
        secret,
        giftDurationMonths,
        maxRedemptions: maxRedemptions || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy: user.id,
      })
      .returning({
        id: sitePromoCampaigns.id,
        name: sitePromoCampaigns.name,
        prefix: sitePromoCampaigns.prefix,
        codeCount: sitePromoCampaigns.codeCount,
        giftDurationMonths: sitePromoCampaigns.giftDurationMonths,
        maxRedemptions: sitePromoCampaigns.maxRedemptions,
        currentRedemptions: sitePromoCampaigns.currentRedemptions,
        expiresAt: sitePromoCampaigns.expiresAt,
        isActive: sitePromoCampaigns.isActive,
        createdAt: sitePromoCampaigns.createdAt,
      })

    return reply.status(201).send(created)
  })

  /**
   * PUT /admin/campaigns/:campaignId — update campaign
   */
  fastify.put<{
    Params: { campaignId: string }
    Body: { isActive?: boolean; maxRedemptions?: number | null; expiresAt?: string | null }
  }>('/admin/campaigns/:campaignId', {
    preHandler: adminPreHandler,
  }, async (request, reply) => {
    const { campaignId } = request.params
    const { isActive, maxRedemptions, expiresAt } = request.body

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (isActive !== undefined) updates.isActive = isActive
    if (maxRedemptions !== undefined) updates.maxRedemptions = maxRedemptions
    if (expiresAt !== undefined) updates.expiresAt = expiresAt ? new Date(expiresAt) : null

    const [updated] = await db
      .update(sitePromoCampaigns)
      .set(updates)
      .where(eq(sitePromoCampaigns.id, campaignId))
      .returning({
        id: sitePromoCampaigns.id,
        name: sitePromoCampaigns.name,
        prefix: sitePromoCampaigns.prefix,
        codeCount: sitePromoCampaigns.codeCount,
        giftDurationMonths: sitePromoCampaigns.giftDurationMonths,
        maxRedemptions: sitePromoCampaigns.maxRedemptions,
        currentRedemptions: sitePromoCampaigns.currentRedemptions,
        expiresAt: sitePromoCampaigns.expiresAt,
        isActive: sitePromoCampaigns.isActive,
        updatedAt: sitePromoCampaigns.updatedAt,
      })

    if (!updated) {
      return reply.status(404).send({ error: 'Campaign not found' })
    }

    return reply.send(updated)
  })

  /**
   * DELETE /admin/campaigns/:campaignId — deactivate
   */
  fastify.delete<{
    Params: { campaignId: string }
  }>('/admin/campaigns/:campaignId', {
    preHandler: adminPreHandler,
  }, async (request, reply) => {
    const { campaignId } = request.params

    const [updated] = await db
      .update(sitePromoCampaigns)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(sitePromoCampaigns.id, campaignId))
      .returning()

    if (!updated) {
      return reply.status(404).send({ error: 'Campaign not found' })
    }

    return reply.send({ success: true })
  })

  /**
   * POST /admin/campaigns/:campaignId/generate-codes — generate printable codes
   */
  fastify.post<{
    Params: { campaignId: string }
    Body: { count: number }
  }>('/admin/campaigns/:campaignId/generate-codes', {
    preHandler: adminPreHandler,
  }, async (request, reply) => {
    const { campaignId } = request.params
    const { count } = request.body

    if (!count || count < 1 || count > 10000) {
      return reply.status(400).send({ error: 'count must be between 1 and 10000' })
    }

    const [campaign] = await db
      .select()
      .from(sitePromoCampaigns)
      .where(eq(sitePromoCampaigns.id, campaignId))
      .limit(1)

    if (!campaign) {
      return reply.status(404).send({ error: 'Campaign not found' })
    }

    const startSeq = campaign.codeCount + 1
    const newTotal = campaign.codeCount + count
    const codes = generateCampaignCodes(campaign.secret, campaign.prefix, startSeq, newTotal)

    // Update codeCount
    await db
      .update(sitePromoCampaigns)
      .set({ codeCount: newTotal, updatedAt: new Date() })
      .where(eq(sitePromoCampaigns.id, campaignId))

    return reply.send({ codes, startSeq, endSeq: newTotal, totalCodes: newTotal })
  })

  /**
   * GET /admin/campaigns/:campaignId/redemptions
   */
  fastify.get<{
    Params: { campaignId: string }
  }>('/admin/campaigns/:campaignId/redemptions', {
    preHandler: adminPreHandler,
  }, async (request, reply) => {
    const { campaignId } = request.params

    const redemptions = await db
      .select({
        id: sitePromoRedemptions.id,
        userId: sitePromoRedemptions.userId,
        email: users.email,
        name: users.name,
        redeemedAt: sitePromoRedemptions.redeemedAt,
        resultType: sitePromoRedemptions.resultType,
        metadata: sitePromoRedemptions.metadata,
      })
      .from(sitePromoRedemptions)
      .innerJoin(users, eq(users.id, sitePromoRedemptions.userId))
      .where(eq(sitePromoRedemptions.campaignId, campaignId))
      .orderBy(desc(sitePromoRedemptions.redeemedAt))

    return reply.send({ redemptions })
  })

  // ─── Public: Validate & Redeem ─────────────────────────────────────

  /**
   * POST /promo-codes/validate — validate any code type
   */
  fastify.post<{
    Body: { code: string }
  }>('/promo-codes/validate', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { code } = request.body
    const userId = request.user!.id

    if (!code || typeof code !== 'string') {
      return reply.status(400).send({ error: 'code is required' })
    }

    const normalizedCode = code.toUpperCase().trim()

    // Check if this is a campaign code (has a dash with suffix)
    const prefix = parseCampaignPrefix(normalizedCode)

    // Try campaign code first (has PREFIX-SUFFIX format)
    if (prefix) {
      const [campaign] = await db
        .select()
        .from(sitePromoCampaigns)
        .where(and(
          eq(sitePromoCampaigns.prefix, prefix),
          eq(sitePromoCampaigns.isActive, true)
        ))
        .limit(1)

      if (campaign && validateCampaignCode(normalizedCode, campaign.secret, campaign.prefix, campaign.codeCount)) {
        if (campaign.expiresAt && new Date(campaign.expiresAt) < new Date()) {
          return reply.send({ valid: false, error: 'This code has expired' })
        }
        if (campaign.maxRedemptions && campaign.currentRedemptions >= campaign.maxRedemptions) {
          return reply.send({ valid: false, error: 'This code is no longer available' })
        }

        const [existingRedemption] = await db
          .select({ id: sitePromoRedemptions.id })
          .from(sitePromoRedemptions)
          .where(and(
            eq(sitePromoRedemptions.campaignId, campaign.id),
            eq(sitePromoRedemptions.userId, userId)
          ))
          .limit(1)

        return reply.send({
          valid: true,
          type: 'gift',
          giftDurationMonths: campaign.giftDurationMonths,
          campaignName: campaign.name,
          alreadyRedeemed: !!existingRedemption,
        })
      }
      // HMAC didn't match or no campaign found — fall through to discount code check
    }

    // Try as a shared discount code (exact match on full code)
    const [promoCode] = await db
      .select()
      .from(sitePromoCodes)
      .where(and(
        eq(sitePromoCodes.code, normalizedCode),
        eq(sitePromoCodes.isActive, true)
      ))
      .limit(1)

    if (!promoCode) {
      return reply.send({ valid: false, error: 'Invalid code' })
    }

    if (promoCode.expiresAt && new Date(promoCode.expiresAt) < new Date()) {
      return reply.send({ valid: false, error: 'This code has expired' })
    }
    if (promoCode.maxRedemptions && promoCode.currentRedemptions >= promoCode.maxRedemptions) {
      return reply.send({ valid: false, error: 'This code is no longer available' })
    }

    const [existingRedemption] = await db
      .select({ id: sitePromoRedemptions.id })
      .from(sitePromoRedemptions)
      .where(and(
        eq(sitePromoRedemptions.promoCodeId, promoCode.id),
        eq(sitePromoRedemptions.userId, userId)
      ))
      .limit(1)

    return reply.send({
      valid: true,
      type: 'discount',
      discountType: promoCode.discountType,
      discountValue: promoCode.discountValue,
      discountDurationMonths: promoCode.discountDurationMonths,
      alreadyRedeemed: !!existingRedemption,
    })
  })

  /**
   * POST /promo-codes/redeem — redeem a gift campaign code
   */
  fastify.post<{
    Body: { code: string }
  }>('/promo-codes/redeem', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { code } = request.body
    const userId = request.user!.id

    if (!code || typeof code !== 'string') {
      return reply.status(400).send({ error: 'code is required' })
    }

    const normalizedCode = code.toUpperCase().trim()
    const prefix = parseCampaignPrefix(normalizedCode)

    if (!prefix) {
      return reply.status(400).send({ error: 'Invalid gift code format' })
    }

    // Find campaign
    const [campaign] = await db
      .select()
      .from(sitePromoCampaigns)
      .where(and(
        eq(sitePromoCampaigns.prefix, prefix),
        eq(sitePromoCampaigns.isActive, true)
      ))
      .limit(1)

    if (!campaign) {
      return reply.status(400).send({ error: 'Invalid code' })
    }

    // Validate expiration
    if (campaign.expiresAt && new Date(campaign.expiresAt) < new Date()) {
      return reply.status(400).send({ error: 'This code has expired' })
    }

    // Validate HMAC
    if (!validateCampaignCode(normalizedCode, campaign.secret, campaign.prefix, campaign.codeCount)) {
      return reply.status(400).send({ error: 'Invalid code' })
    }

    // Validate expiration
    if (campaign.expiresAt && new Date(campaign.expiresAt) < new Date()) {
      return reply.status(400).send({ error: 'This code has expired' })
    }

    // Atomic: claim a redemption slot (prevents exceeding maxRedemptions under concurrency)
    const [claimed] = await db
      .update(sitePromoCampaigns)
      .set({
        currentRedemptions: sql`${sitePromoCampaigns.currentRedemptions} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(sitePromoCampaigns.id, campaign.id),
        sql`(${sitePromoCampaigns.maxRedemptions} IS NULL OR ${sitePromoCampaigns.currentRedemptions} < ${sitePromoCampaigns.maxRedemptions})`
      ))
      .returning({ id: sitePromoCampaigns.id })

    if (!claimed) {
      return reply.status(400).send({ error: 'This code is no longer available' })
    }

    // Check if user already redeemed from this campaign (unique index is the ultimate guard)
    const [existingRedemption] = await db
      .select({ id: sitePromoRedemptions.id })
      .from(sitePromoRedemptions)
      .where(and(
        eq(sitePromoRedemptions.campaignId, campaign.id),
        eq(sitePromoRedemptions.userId, userId)
      ))
      .limit(1)

    if (existingRedemption) {
      // Roll back the counter
      await db
        .update(sitePromoCampaigns)
        .set({
          currentRedemptions: sql`GREATEST(${sitePromoCampaigns.currentRedemptions} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(sitePromoCampaigns.id, campaign.id))
      return reply.status(409).send({ error: 'You have already redeemed a code from this campaign' })
    }

    // Check current membership status
    const [currentMembership] = await db
      .select()
      .from(siteMemberships)
      .where(eq(siteMemberships.userId, userId))
      .limit(1)

    if (
      currentMembership?.tier === 'supporter' &&
      currentMembership.status === 'active' &&
      currentMembership.stripeSubscriptionId
    ) {
      // Roll back the counter
      await db
        .update(sitePromoCampaigns)
        .set({
          currentRedemptions: sql`GREATEST(${sitePromoCampaigns.currentRedemptions} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(sitePromoCampaigns.id, campaign.id))
      return reply.status(409).send({ error: 'You already have an active paid supporter membership' })
    }

    // Calculate expiration: extend if existing gift membership has time left
    const now = new Date()
    let baseDate = now
    if (
      currentMembership?.tier === 'supporter' &&
      currentMembership.status === 'active' &&
      !currentMembership.stripeSubscriptionId &&
      currentMembership.currentPeriodEnd &&
      new Date(currentMembership.currentPeriodEnd) > now
    ) {
      baseDate = new Date(currentMembership.currentPeriodEnd)
    }

    const expiresAt = new Date(baseDate)
    expiresAt.setMonth(expiresAt.getMonth() + campaign.giftDurationMonths)

    // Grant membership + badge in parallel, then record audit
    await Promise.all([
      db.insert(siteMemberships)
        .values({
          userId,
          tier: 'supporter',
          status: 'active',
          stripeSubscriptionId: null,
          stripePriceId: null,
          currentPeriodStart: now,
          currentPeriodEnd: expiresAt,
          cancelAtPeriodEnd: false,
        })
        .onConflictDoUpdate({
          target: siteMemberships.userId,
          set: {
            tier: 'supporter',
            status: 'active',
            stripeSubscriptionId: null,
            stripePriceId: null,
            currentPeriodStart: now,
            currentPeriodEnd: expiresAt,
            cancelAtPeriodEnd: false,
            updatedAt: now,
          },
        }),
      db.insert(userBadges)
        .values({
          userId,
          badge: 'supporter',
          label: 'Supporter',
          expiresAt,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [userBadges.userId, userBadges.badge],
          set: { isActive: true, expiresAt },
        }),
    ])

    // Record redemption (unique index on campaign_id+user_id is the final guard)
    await db.insert(sitePromoRedemptions).values({
      userId,
      campaignId: campaign.id,
      resultType: 'membership_granted',
      metadata: { codeUsed: normalizedCode, giftExpiresAt: expiresAt.toISOString() },
    })

    return reply.send({
      success: true,
      membership: {
        tier: 'supporter',
        expiresAt: expiresAt.toISOString(),
        giftDurationMonths: campaign.giftDurationMonths,
      },
    })
  })
}

export default promoCodesPlugin
