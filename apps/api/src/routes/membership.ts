/**
 * Membership Routes
 *
 * Platform-level supporter membership management and badge API.
 *
 * Routes:
 *   GET  /membership              — current user's tier + badges
 *   POST /membership/checkout     — create Stripe Checkout for supporter upgrade
 *   POST /membership/portal       — create Stripe Customer Portal session
 *   GET  /users/:userId/badges    — public: get any user's active badges
 */

import { FastifyPluginAsync } from 'fastify'
import { db } from '../db/connection'
import { siteMemberships, sitePromoCodes, sitePromoRedemptions, users } from '../db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth'
import { getUserMembershipTier, getUserBadges } from '../lib/membership'
import { getStripe } from '../lib/stripe'
import type { Checkout } from 'stripe/cjs/resources/Checkout/Sessions.js'

function isValidUUID(uuid: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)
}

const membershipPlugin: FastifyPluginAsync = async (fastify) => {

  // GET /membership — current user's membership status + badges
  fastify.get('/membership', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    try {
      const user = request.user!

      const tier = await getUserMembershipTier(user.id)
      const badges = await getUserBadges(user.id)

      // Get full membership details if supporter
      let membership = null
      if (tier === 'supporter') {
        const [m] = await db
          .select()
          .from(siteMemberships)
          .where(eq(siteMemberships.userId, user.id))
          .limit(1)
        if (m) {
          membership = {
            tier: m.tier,
            status: m.status,
            currentPeriodEnd: m.currentPeriodEnd,
            cancelAtPeriodEnd: m.cancelAtPeriodEnd,
            source: (m.stripeSubscriptionId ? 'stripe' : 'admin') as 'stripe' | 'admin',
          }
        }
      }

      // Check if user has a password (credentials account vs OAuth-only)
      const [dbUser] = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1)

      return reply.send({ user: { id: user.id, email: user.email, name: user.name }, tier, badges, membership, emailVerified: !!user.emailVerified, hasPassword: !!dbUser?.passwordHash })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch membership' })
    }
  })

  // POST /membership/checkout — create Stripe Checkout session for supporter upgrade
  fastify.post<{
    Body: { billingPeriod?: 'monthly' | 'yearly'; promoCode?: string }
  }>('/membership/checkout', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    try {
      const user = request.user!
      const { billingPeriod = 'monthly', promoCode } = request.body || {}

      const stripe = getStripe()
      if (!stripe) {
        return reply.status(503).send({ error: 'Stripe not configured' })
      }

      // Check if already a supporter
      const currentTier = await getUserMembershipTier(user.id)
      if (currentTier === 'supporter') {
        return reply.status(400).send({ error: 'Already a supporter' })
      }

      // Get the right price ID
      const priceId = billingPeriod === 'yearly'
        ? process.env.STRIPE_SUPPORTER_YEARLY_PRICE_ID
        : process.env.STRIPE_SUPPORTER_MONTHLY_PRICE_ID

      if (!priceId) {
        return reply.status(503).send({ error: 'Supporter pricing not configured' })
      }

      // Get or create Stripe customer
      const [dbUser] = await db
        .select({ id: users.id, email: users.email, stripeCustomerId: users.stripeCustomerId })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1)

      if (!dbUser) {
        return reply.status(404).send({ error: 'User not found' })
      }

      let customerId = dbUser.stripeCustomerId

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: dbUser.email,
          metadata: { bobbinry_user_id: user.id },
        })
        customerId = customer.id

        await db
          .update(users)
          .set({ stripeCustomerId: customerId, updatedAt: new Date() })
          .where(eq(users.id, user.id))
      }

      const baseUrl = process.env.WEB_ORIGIN || 'http://localhost:3100'

      // Validate promo code if provided
      let stripeCouponId: string | null = null
      let validatedPromoCodeId: string | null = null

      if (promoCode) {
        const normalizedCode = promoCode.toUpperCase().trim()
        const [code] = await db
          .select()
          .from(sitePromoCodes)
          .where(and(
            eq(sitePromoCodes.code, normalizedCode),
            eq(sitePromoCodes.isActive, true)
          ))
          .limit(1)

        if (!code) {
          return reply.status(400).send({ error: 'Invalid promo code' })
        }

        if (code.expiresAt && new Date(code.expiresAt) < new Date()) {
          return reply.status(400).send({ error: 'Promo code has expired' })
        }

        // Check if user already redeemed
        const [existingRedemption] = await db
          .select({ id: sitePromoRedemptions.id })
          .from(sitePromoRedemptions)
          .where(and(
            eq(sitePromoRedemptions.promoCodeId, code.id),
            eq(sitePromoRedemptions.userId, user.id)
          ))
          .limit(1)

        if (existingRedemption) {
          return reply.status(409).send({ error: 'You have already used this promo code' })
        }

        // Atomic: claim a redemption slot (prevents exceeding maxRedemptions under concurrency)
        const [claimed] = await db
          .update(sitePromoCodes)
          .set({
            currentRedemptions: sql`${sitePromoCodes.currentRedemptions} + 1`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(sitePromoCodes.id, code.id),
            sql`(${sitePromoCodes.maxRedemptions} IS NULL OR ${sitePromoCodes.currentRedemptions} < ${sitePromoCodes.maxRedemptions})`
          ))
          .returning({ id: sitePromoCodes.id })

        if (!claimed) {
          return reply.status(400).send({ error: 'Promo code is no longer available' })
        }

        stripeCouponId = code.stripeCouponId
        validatedPromoCodeId = code.id
      }

      const sessionParams: Checkout.SessionCreateParams = {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: {
          metadata: {
            bobbinry_type: 'site_membership',
            bobbinry_user_id: user.id,
          },
        },
        metadata: {
          bobbinry_type: 'site_membership',
          bobbinry_user_id: user.id,
        },
        success_url: `${baseUrl}/membership?upgraded=true`,
        cancel_url: `${baseUrl}/membership?upgraded=false`,
        ...(stripeCouponId ? { discounts: [{ coupon: stripeCouponId }] } : {}),
      }

      const session = await stripe.checkout.sessions.create(sessionParams)

      // Record redemption after successful session creation
      if (validatedPromoCodeId) {
        await db.insert(sitePromoRedemptions).values({
          userId: user.id,
          promoCodeId: validatedPromoCodeId,
          resultType: 'checkout_discount',
          metadata: { stripeSessionId: session.id },
        })
      }

      return reply.send({ checkoutUrl: session.url, sessionId: session.id })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to create checkout session' })
    }
  })

  // POST /membership/portal — create Stripe Customer Portal session
  fastify.post('/membership/portal', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    try {
      const user = request.user!

      const stripe = getStripe()
      if (!stripe) {
        return reply.status(503).send({ error: 'Stripe not configured' })
      }

      const [dbUser] = await db
        .select({ stripeCustomerId: users.stripeCustomerId })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1)

      if (!dbUser?.stripeCustomerId) {
        return reply.status(400).send({ error: 'No Stripe customer found' })
      }

      const baseUrl = process.env.WEB_ORIGIN || 'http://localhost:3100'
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: dbUser.stripeCustomerId,
        return_url: `${baseUrl}/membership`,
      })

      return reply.send({ url: portalSession.url })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to create portal session' })
    }
  })

  // GET /users/:userId/badges — public: get any user's active badges
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/badges', async (request, reply) => {
    try {
      const { userId } = request.params
      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      const badges = await getUserBadges(userId)
      return reply.send({ badges })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch badges' })
    }
  })
}

export default membershipPlugin
