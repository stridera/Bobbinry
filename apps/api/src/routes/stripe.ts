import { FastifyPluginAsync, FastifyInstance } from 'fastify'
import Stripe from 'stripe'
import { db } from '../db/connection'
import {
  subscriptions,
  subscriptionPayments,
  subscriptionTiers,
  userPaymentConfig,
  users,
  userProfiles,
  siteMemberships,
  userBadges,
} from '../db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { requireAuth, requireSelf, requireVerified, denyApiKeyAuth } from '../middleware/auth'
import { serverEventBus, subscriptionChanged } from '../lib/event-bus'
import { getStripe, createExpressAccount, createOnboardingLink } from '../lib/stripe'

function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

const PLATFORM_FEE_PERCENT = parseInt(process.env.PLATFORM_FEE_PERCENT || '5', 10)

const stripePlugin: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // PAYMENT CONFIG ROUTES (preserved from original)
  // ============================================================================

  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/payment-config', {
    preHandler: [requireAuth, denyApiKeyAuth]
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }
      if (!requireSelf(request, reply, userId)) return

      const config = await db
        .select()
        .from(userPaymentConfig)
        .where(eq(userPaymentConfig.userId, userId))
        .limit(1)

      if (config.length === 0) {
        return reply.status(200).send({
          paymentConfig: {
            userId,
            stripeAccountId: null,
            stripeOnboardingComplete: false,
            patreonAccessToken: null,
            patreonCampaignId: null,
            paymentProvider: 'stripe'
          }
        })
      }

      // Auto-check Stripe status if account exists but onboarding not marked complete
      const cfg = config[0]!
      if (cfg.stripeAccountId && !cfg.stripeOnboardingComplete) {
        const stripe = getStripe()
        if (stripe) {
          try {
            const account = await stripe.accounts.retrieve(cfg.stripeAccountId)
            if (account.charges_enabled && account.details_submitted) {
              await db.update(userPaymentConfig).set({
                stripeOnboardingComplete: true,
                updatedAt: new Date()
              }).where(eq(userPaymentConfig.userId, userId))
              cfg.stripeOnboardingComplete = true
            }
          } catch {
            // Stripe check failed, return stale data
          }
        }
      }

      const sanitized = {
        ...cfg,
        patreonAccessToken: cfg.patreonAccessToken ? '***REDACTED***' : null,
        patreonRefreshToken: cfg.patreonRefreshToken ? '***REDACTED***' : null
      }

      return reply.status(200).send({ paymentConfig: sanitized })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch payment configuration' })
    }
  })

  fastify.put<{
    Params: { userId: string }
    Body: {
      stripeAccountId?: string
      stripeOnboardingComplete?: boolean
      patreonAccessToken?: string
      patreonRefreshToken?: string
      patreonCampaignId?: string
      paymentProvider?: 'stripe' | 'patreon' | 'both'
    }
  }>('/users/:userId/payment-config', {
    preHandler: [requireAuth, denyApiKeyAuth]
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const configData = request.body
      if (!isValidUUID(userId)) return reply.status(400).send({ error: 'Invalid user ID format' })
      if (!requireSelf(request, reply, userId)) return

      const existing = await db.select().from(userPaymentConfig).where(eq(userPaymentConfig.userId, userId)).limit(1)

      if (existing.length > 0) {
        const [updated] = await db.update(userPaymentConfig).set({ ...configData, updatedAt: new Date() }).where(eq(userPaymentConfig.userId, userId)).returning()
        if (!updated) return reply.status(500).send({ error: 'Failed to update payment config' })
        return reply.status(200).send({ paymentConfig: { ...updated, patreonAccessToken: updated.patreonAccessToken ? '***REDACTED***' : null, patreonRefreshToken: updated.patreonRefreshToken ? '***REDACTED***' : null } })
      } else {
        const [created] = await db.insert(userPaymentConfig).values({ userId, ...configData }).returning()
        if (!created) return reply.status(500).send({ error: 'Failed to create payment config' })
        return reply.status(201).send({ paymentConfig: { ...created, patreonAccessToken: created.patreonAccessToken ? '***REDACTED***' : null, patreonRefreshToken: created.patreonRefreshToken ? '***REDACTED***' : null } })
      }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update payment configuration' })
    }
  })

  // ============================================================================
  // STRIPE CONNECT EXPRESS ONBOARDING
  // ============================================================================

  /**
   * Create a Stripe Express account and return an Account Link for onboarding.
   * Express accounts: Stripe hosts the onboarding + payout dashboard.
   */
  fastify.post<{
    Params: { userId: string }
    Body: { returnUrl?: string; refreshUrl?: string }
  }>('/users/:userId/stripe/connect', {
    preHandler: [requireAuth, requireVerified, denyApiKeyAuth]
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      const { returnUrl, refreshUrl } = request.body
      if (!isValidUUID(userId)) return reply.status(400).send({ error: 'Invalid user ID format' })
      if (!requireSelf(request, reply, userId)) return

      const stripe = getStripe()
      if (!stripe) {
        return reply.status(503).send({
          error: 'Stripe not configured',
          message: 'Set STRIPE_SECRET_KEY environment variable to enable payments'
        })
      }

      // Check if user already has a Stripe account
      const [existing] = await db.select().from(userPaymentConfig).where(eq(userPaymentConfig.userId, userId)).limit(1)

      let stripeAccountId = existing?.stripeAccountId

      if (!stripeAccountId) {
        // Get user + profile for prefill
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
        if (!user) return reply.status(404).send({ error: 'User not found' })

        const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1)

        const account = await createExpressAccount(stripe, { user, profile })
        stripeAccountId = account.id

        // Save account ID + type
        await db.insert(userPaymentConfig).values({
          userId,
          stripeAccountId: account.id,
          stripeAccountType: 'express',
          stripeOnboardingComplete: false,
          paymentProvider: 'stripe'
        }).onConflictDoUpdate({
          target: userPaymentConfig.userId,
          set: {
            stripeAccountId: account.id,
            stripeAccountType: 'express',
            updatedAt: new Date()
          }
        })
      }

      // Create Account Link for onboarding
      const baseUrl = process.env.WEB_ORIGIN || 'http://localhost:3100'
      const accountLink = await createOnboardingLink(
        stripe,
        stripeAccountId,
        returnUrl || `${baseUrl}/settings/monetization?stripe=complete`,
        refreshUrl || `${baseUrl}/settings/monetization?stripe=refresh`
      )

      return reply.status(200).send({ url: accountLink.url })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to initiate Stripe Connect' })
    }
  })

  /**
   * Get a temporary Stripe dashboard login link for Express accounts.
   * For legacy Standard accounts, returns the direct Stripe dashboard URL.
   */
  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/stripe/dashboard-link', {
    preHandler: [requireAuth, denyApiKeyAuth]
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      if (!isValidUUID(userId)) return reply.status(400).send({ error: 'Invalid user ID format' })
      if (!requireSelf(request, reply, userId)) return

      const [config] = await db.select().from(userPaymentConfig).where(eq(userPaymentConfig.userId, userId)).limit(1)
      if (!config?.stripeAccountId) {
        return reply.status(404).send({ error: 'No Stripe account found' })
      }

      // Legacy Standard accounts: direct dashboard link
      if (!config.stripeAccountType || config.stripeAccountType === 'standard') {
        return reply.status(200).send({ url: 'https://dashboard.stripe.com' })
      }

      // Express accounts: generate a temporary login link
      const stripe = getStripe()
      if (!stripe) return reply.status(503).send({ error: 'Stripe not configured' })

      const loginLink = await stripe.accounts.createLoginLink(config.stripeAccountId)
      return reply.status(200).send({ url: loginLink.url })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to generate dashboard link' })
    }
  })

  /**
   * Handle Stripe Connect OAuth/onboarding callback.
   * Checks account status and marks onboarding complete.
   */
  fastify.get<{
    Querystring: { code?: string; state?: string; error?: string }
  }>('/stripe/connect/callback', async (request, reply) => {
    try {
      const { code, state, error: queryError } = request.query

      if (queryError) {
        return reply.status(400).send({ error: `Stripe Connect error: ${queryError}` })
      }

      if (!state) {
        return reply.status(400).send({ error: 'Missing state parameter' })
      }

      const userId = state
      if (!isValidUUID(userId)) return reply.status(400).send({ error: 'Invalid user ID in state' })

      const stripe = getStripe()
      if (!stripe) return reply.status(503).send({ error: 'Stripe not configured' })

      // If we have a code, exchange it (OAuth flow)
      if (code) {
        const response = await stripe.oauth.token({ grant_type: 'authorization_code', code })
        const stripeAccountId = response.stripe_user_id

        await db.insert(userPaymentConfig).values({
          userId,
          stripeAccountId: stripeAccountId || null,
          stripeOnboardingComplete: true,
          paymentProvider: 'stripe'
        }).onConflictDoUpdate({
          target: userPaymentConfig.userId,
          set: {
            stripeAccountId: stripeAccountId || undefined,
            stripeOnboardingComplete: true,
            updatedAt: new Date()
          }
        })
      }

      // Check if the Express account is fully onboarded
      const [config] = await db.select().from(userPaymentConfig).where(eq(userPaymentConfig.userId, userId)).limit(1)

      if (config?.stripeAccountId) {
        const account = await stripe.accounts.retrieve(config.stripeAccountId)
        const isComplete = account.charges_enabled && account.details_submitted

        if (isComplete && !config.stripeOnboardingComplete) {
          await db.update(userPaymentConfig).set({
            stripeOnboardingComplete: true,
            updatedAt: new Date()
          }).where(eq(userPaymentConfig.userId, userId))
        }
      }

      const baseUrl = process.env.WEB_ORIGIN || 'http://localhost:3100'
      return reply.redirect(`${baseUrl}/settings/monetization?stripe=complete`)
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to handle Stripe callback' })
    }
  })

  /**
   * Verify Stripe Connect onboarding status.
   * Called after user returns from Stripe onboarding to check if account is ready.
   */
  fastify.post<{
    Params: { userId: string }
  }>('/users/:userId/stripe/verify-onboarding', {
    preHandler: [requireAuth, denyApiKeyAuth]
  }, async (request, reply) => {
    try {
      const { userId } = request.params
      if (!isValidUUID(userId)) return reply.status(400).send({ error: 'Invalid user ID format' })
      if (!requireSelf(request, reply, userId)) return

      const stripe = getStripe()
      if (!stripe) return reply.status(503).send({ error: 'Stripe not configured' })

      const [config] = await db.select().from(userPaymentConfig).where(eq(userPaymentConfig.userId, userId)).limit(1)
      if (!config?.stripeAccountId) {
        return reply.status(200).send({ onboardingComplete: false })
      }

      const account = await stripe.accounts.retrieve(config.stripeAccountId)
      const isComplete = !!(account.charges_enabled && account.details_submitted)
      const detailsSubmitted = !!account.details_submitted

      if (isComplete && !config.stripeOnboardingComplete) {
        await db.update(userPaymentConfig).set({
          stripeOnboardingComplete: true,
          updatedAt: new Date()
        }).where(eq(userPaymentConfig.userId, userId))
      }

      return reply.status(200).send({
        onboardingComplete: isComplete,
        detailsSubmitted,
        chargesEnabled: !!account.charges_enabled,
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to verify onboarding status' })
    }
  })

  // ============================================================================
  // CHECKOUT FLOW
  // ============================================================================

  /**
   * Create a Stripe Checkout Session for subscribing to an author.
   * Uses connected accounts with application_fee_percent.
   */
  fastify.post<{
    Body: {
      subscriberId: string
      authorId: string
      tierId: string
      billingPeriod?: 'monthly' | 'yearly'
      returnUrl?: string
    }
  }>('/subscribe/checkout', {
    preHandler: [requireAuth, denyApiKeyAuth]
  }, async (request, reply) => {
    try {
      const { subscriberId, authorId, tierId, billingPeriod = 'monthly', returnUrl } = request.body
      if (!requireSelf(request, reply, subscriberId)) return

      const stripe = getStripe()
      if (!stripe) return reply.status(503).send({ error: 'Stripe not configured' })

      // Get tier details
      const [tier] = await db.select().from(subscriptionTiers).where(eq(subscriptionTiers.id, tierId)).limit(1)
      if (!tier) return reply.status(404).send({ error: 'Tier not found' })

      // Get author's Stripe account
      const [authorConfig] = await db.select().from(userPaymentConfig).where(eq(userPaymentConfig.userId, authorId)).limit(1)
      if (!authorConfig?.stripeAccountId || !authorConfig.stripeOnboardingComplete) {
        return reply.status(400).send({ error: 'Author has not completed Stripe onboarding' })
      }

      // Calculate price in cents
      const price = billingPeriod === 'yearly'
        ? Math.round(parseFloat(tier.priceYearly || '0') * 100)
        : Math.round(parseFloat(tier.priceMonthly || '0') * 100)

      if (price <= 0) {
        return reply.status(400).send({ error: 'Tier has no price set' })
      }

      const baseUrl = process.env.WEB_ORIGIN || 'http://localhost:3100'

      // Create Checkout Session with connected account
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: price,
            recurring: {
              interval: billingPeriod === 'yearly' ? 'year' : 'month'
            },
            product_data: {
              name: tier.name,
              ...(tier.description ? { description: tier.description } : {})
            }
          },
          quantity: 1
        }],
        subscription_data: {
          metadata: {
            bobbinry_subscriber_id: subscriberId,
            bobbinry_author_id: authorId,
            bobbinry_tier_id: tierId
          },
          application_fee_percent: PLATFORM_FEE_PERCENT,
          transfer_data: {
            destination: authorConfig.stripeAccountId
          }
        },
        metadata: {
          bobbinry_subscriber_id: subscriberId,
          bobbinry_author_id: authorId,
          bobbinry_tier_id: tierId
        },
        success_url: returnUrl ? `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}subscribed=true` : `${baseUrl}/settings/subscriptions?subscribed=true`,
        cancel_url: returnUrl || `${baseUrl}/explore`
      })

      return reply.status(200).send({ checkoutUrl: session.url, sessionId: session.id })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to create checkout session' })
    }
  })

  /**
   * Create a Stripe Customer Portal session for managing billing.
   */
  fastify.post<{
    Body: { userId: string; subscriptionId?: string; returnUrl?: string }
  }>('/subscribe/portal-session', {
    preHandler: [requireAuth, denyApiKeyAuth]
  }, async (request, reply) => {
    try {
      const { userId, subscriptionId, returnUrl } = request.body
      if (!requireSelf(request, reply, userId)) return

      const stripe = getStripe()
      if (!stripe) return reply.status(503).send({ error: 'Stripe not configured' })

      // Find the specific subscription or the first one with a Stripe ID
      const query = subscriptionId
        ? db.select().from(subscriptions).where(
            and(eq(subscriptions.id, subscriptionId), eq(subscriptions.subscriberId, userId))
          ).limit(1)
        : db.select().from(subscriptions).where(
            and(eq(subscriptions.subscriberId, userId), sql`${subscriptions.stripeSubscriptionId} IS NOT NULL`)
          ).limit(1)

      const [sub] = await query
      if (!sub?.stripeSubscriptionId) {
        return reply.status(400).send({ error: 'No active subscription found' })
      }

      // Get customer from subscription
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
      const customerId = stripeSub.customer as string

      const baseUrl = process.env.WEB_ORIGIN || 'http://localhost:3100'
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl || `${baseUrl}/settings/subscriptions`
      })

      return reply.status(200).send({ url: portalSession.url })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to create portal session' })
    }
  })

  // ============================================================================
  // STRIPE WEBHOOK HANDLER
  // ============================================================================

  fastify.post('/stripe/webhook', {
    config: { rawBody: true }
  }, async (request: any, reply) => {
    try {
      const stripe = getStripe()
      if (!stripe) return reply.status(503).send({ error: 'Stripe not configured' })

      const signature = request.headers['stripe-signature'] as string
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
      let event: Stripe.Event

      if (signature && webhookSecret && request.rawBody) {
        // Verify webhook signature
        event = stripe.webhooks.constructEvent(
          request.rawBody as string,
          signature,
          webhookSecret
        )
      } else if (process.env.NODE_ENV === 'development') {
        // Development only: trust the payload when webhook secret isn't configured
        fastify.log.warn('Stripe webhook received without signature verification (dev mode)')
        event = request.body as Stripe.Event
      } else {
        return reply.status(400).send({ error: 'Missing webhook signature' })
      }

      fastify.log.info({ eventType: event.type }, 'Stripe webhook received')

      // Detect platform (site_membership) vs author subscription events
      const eventObj = event.data.object as any
      const isSiteMembership = eventObj?.metadata?.bobbinry_type === 'site_membership'

      switch (event.type) {
        case 'checkout.session.completed':
          if (isSiteMembership) {
            await handleSiteMembershipCheckout(event.data.object as Stripe.Checkout.Session, stripe, fastify)
          } else {
            await handleAuthorCheckoutCompleted(event.data.object as Stripe.Checkout.Session, stripe, fastify)
          }
          break
        case 'customer.subscription.created':
          if (!isSiteMembership) {
            await handleSubscriptionCreated(event.data.object as Stripe.Subscription, fastify)
          }
          break
        case 'customer.subscription.updated':
          if (isSiteMembership) {
            await handleSiteMembershipUpdated(event.data.object as Stripe.Subscription, fastify)
          } else {
            await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, fastify)
          }
          break
        case 'customer.subscription.deleted':
          if (isSiteMembership) {
            await handleSiteMembershipDeleted(event.data.object as Stripe.Subscription, fastify)
          } else {
            await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, fastify)
          }
          break
        case 'invoice.payment_succeeded':
          if (isSiteMembership) {
            await handleSiteMembershipPaymentSucceeded(event.data.object as Stripe.Invoice, fastify)
          } else {
            await handlePaymentSucceeded(event.data.object as Stripe.Invoice, fastify)
          }
          break
        case 'invoice.payment_failed':
          if (isSiteMembership) {
            await handleSiteMembershipPaymentFailed(event.data.object as Stripe.Invoice, fastify)
          } else {
            await handlePaymentFailed(event.data.object as Stripe.Invoice, fastify)
          }
          break
        case 'charge.refunded':
          await handleChargeRefunded(event.data.object as Stripe.Charge, fastify)
          break
        case 'account.updated':
          await handleAccountUpdated(event.data.object as Stripe.Account, fastify)
          break
        default:
          fastify.log.info({ eventType: event.type }, 'Unhandled webhook event type')
      }

      return reply.status(200).send({ received: true })
    } catch (error) {
      fastify.log.error(error, 'Stripe webhook processing failed')
      return reply.status(500).send({ error: 'Webhook processing failed' })
    }
  })
}

// ============================================================================
// WEBHOOK EVENT HANDLERS
// ============================================================================

/** Extract period dates from a Stripe subscription (handles both legacy and items-based APIs) */
function getSubscriptionPeriod(sub: any): { start: Date; end: Date } {
  const periodStart = sub.current_period_start
    ?? sub.items?.data?.[0]?.current_period_start
  const periodEnd = sub.current_period_end
    ?? sub.items?.data?.[0]?.current_period_end
  return {
    start: periodStart ? new Date(periodStart * 1000) : new Date(),
    end: periodEnd ? new Date(periodEnd * 1000) : new Date(),
  }
}

/**
 * Fallback handler for author subscription checkout completion.
 * If the subscription was created as 'incomplete', this activates it
 * once checkout succeeds (in case subscription.updated webhook is delayed).
 */
async function handleAuthorCheckoutCompleted(session: Stripe.Checkout.Session, stripe: Stripe, fastify: FastifyInstance) {
  try {
    const metadata = session.metadata || {}
    const subscriberId = metadata.bobbinry_subscriber_id
    const authorId = metadata.bobbinry_author_id
    const tierId = metadata.bobbinry_tier_id

    if (!subscriberId || !authorId || !tierId) return

    const stripeSubId = typeof session.subscription === 'string'
      ? session.subscription
      : (session.subscription as any)?.id

    if (!stripeSubId) return

    // Retrieve the subscription to get current status and period
    const stripeSub = await stripe.subscriptions.retrieve(stripeSubId)

    // Find and update the existing subscription record
    const [existing] = await db.select().from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId)).limit(1)

    const period = getSubscriptionPeriod(stripeSub)

    if (existing) {
      await db.update(subscriptions).set({
        status: stripeSub.status as string,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        updatedAt: new Date()
      }).where(eq(subscriptions.id, existing.id))

      fastify.log.info({ subscriptionId: existing.id, status: stripeSub.status }, 'Author subscription activated via checkout.session.completed')
    } else {
      // Subscription record doesn't exist yet — create it
      await db.insert(subscriptions).values({
        subscriberId,
        authorId,
        tierId,
        status: stripeSub.status as string,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
        stripeSubscriptionId: stripeSubId
      })

      fastify.log.info({ subscriberId, authorId, tierId }, 'Author subscription created via checkout.session.completed')
    }
  } catch (error) {
    fastify.log.error(error, 'Failed to handle author checkout completed')
  }
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription, fastify: FastifyInstance) {
  try {
    fastify.log.info({ subscriptionId: subscription.id }, 'Processing subscription created')

    const metadata = subscription.metadata || {}
    const subscriberId = metadata.bobbinry_subscriber_id
    const authorId = metadata.bobbinry_author_id
    const tierId = metadata.bobbinry_tier_id

    if (!subscriberId || !authorId || !tierId) {
      fastify.log.warn({ metadata }, 'Missing bobbinry metadata on subscription')
      return
    }

    // Check if subscription already exists
    const [existing] = await db.select().from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, subscription.id)).limit(1)

    if (existing) {
      fastify.log.info({ subscriptionId: existing.id }, 'Subscription already exists')
      return
    }

    const period = getSubscriptionPeriod(subscription)
    await db.insert(subscriptions).values({
      subscriberId,
      authorId,
      tierId,
      status: subscription.status as string,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      stripeSubscriptionId: subscription.id
    })

    // Emit subscription:changed event for Discord role sync, etc.
    const [tier] = await db.select({ tierLevel: subscriptionTiers.tierLevel })
      .from(subscriptionTiers).where(eq(subscriptionTiers.id, tierId)).limit(1)
    serverEventBus.fire(subscriptionChanged(authorId, subscriberId, tierId, tier?.tierLevel ?? 0, 'created'))

    fastify.log.info({ subscriberId, authorId, tierId }, 'Subscription created from webhook')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle subscription created')
    throw error
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription, fastify: FastifyInstance) {
  try {
    const [sub] = await db.select().from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, subscription.id)).limit(1)

    if (!sub) {
      fastify.log.warn({ stripeSubId: subscription.id }, 'Subscription not found in database')
      return
    }

    const period = getSubscriptionPeriod(subscription)
    await db.update(subscriptions).set({
      status: subscription.status as string,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      updatedAt: new Date()
    }).where(eq(subscriptions.id, sub.id))

    // Check for tier change (upgrade/downgrade) and emit event
    const metadata = subscription.metadata || {}
    const newTierId = metadata.bobbinry_tier_id
    if (newTierId && newTierId !== sub.tierId) {
      const [[oldTier], [newTier]] = await Promise.all([
        db.select({ tierLevel: subscriptionTiers.tierLevel }).from(subscriptionTiers).where(eq(subscriptionTiers.id, sub.tierId)).limit(1),
        db.select({ tierLevel: subscriptionTiers.tierLevel }).from(subscriptionTiers).where(eq(subscriptionTiers.id, newTierId)).limit(1),
      ])
      const action = (newTier?.tierLevel ?? 0) > (oldTier?.tierLevel ?? 0) ? 'upgraded' : 'downgraded'
      serverEventBus.fire(subscriptionChanged(sub.authorId, sub.subscriberId, newTierId, newTier?.tierLevel ?? 0, action))
    }

    fastify.log.info({ subscriptionId: sub.id, status: subscription.status }, 'Subscription updated')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle subscription updated')
    throw error
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription, fastify: FastifyInstance) {
  try {
    // Fetch subscription before updating so we can emit the event
    const [sub] = await db.select().from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, subscription.id)).limit(1)

    await db.update(subscriptions).set({
      status: 'canceled',
      updatedAt: new Date()
    }).where(eq(subscriptions.stripeSubscriptionId, subscription.id))

    // Emit subscription:changed event for Discord role removal
    if (sub) {
      const [tier] = await db.select({ tierLevel: subscriptionTiers.tierLevel })
        .from(subscriptionTiers).where(eq(subscriptionTiers.id, sub.tierId)).limit(1)
      serverEventBus.fire(subscriptionChanged(sub.authorId, sub.subscriberId, sub.tierId, tier?.tierLevel ?? 0, 'canceled'))
    }

    fastify.log.info({ stripeSubId: subscription.id }, 'Subscription canceled')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle subscription deleted')
    throw error
  }
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice, fastify: FastifyInstance) {
  try {
    const inv = invoice as any
    const stripeSubId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id
    if (!stripeSubId) return

    const [sub] = await db.select().from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId)).limit(1)

    if (!sub) {
      fastify.log.warn({ stripeSubId }, 'Subscription not found for payment')
      return
    }

    const paymentIntentId = typeof inv.payment_intent === 'string' ? inv.payment_intent : inv.payment_intent?.id

    await db.insert(subscriptionPayments).values({
      subscriptionId: sub.id,
      amount: ((invoice.amount_paid || 0) / 100).toFixed(2),
      currency: (invoice.currency || 'usd').toUpperCase(),
      status: 'succeeded',
      stripePaymentIntentId: paymentIntentId || null,
      paidAt: new Date()
    })

    fastify.log.info({ subscriptionId: sub.id }, 'Payment recorded')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle payment succeeded')
    throw error
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice, fastify: FastifyInstance) {
  try {
    const inv = invoice as any
    const stripeSubId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id
    if (!stripeSubId) return

    const [sub] = await db.select().from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId)).limit(1)

    if (!sub) return

    await db.update(subscriptions).set({
      status: 'past_due',
      updatedAt: new Date()
    }).where(eq(subscriptions.id, sub.id))

    const paymentIntentId = typeof inv.payment_intent === 'string' ? inv.payment_intent : inv.payment_intent?.id

    await db.insert(subscriptionPayments).values({
      subscriptionId: sub.id,
      amount: ((invoice.amount_due || 0) / 100).toFixed(2),
      currency: (invoice.currency || 'usd').toUpperCase(),
      status: 'failed',
      stripePaymentIntentId: paymentIntentId || null,
      failureReason: 'Payment failed'
    })

    fastify.log.info({ subscriptionId: sub.id }, 'Failed payment recorded')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle payment failed')
    throw error
  }
}

async function handleChargeRefunded(charge: Stripe.Charge, fastify: FastifyInstance) {
  try {
    const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
    if (!paymentIntentId) return

    const [payment] = await db.select().from(subscriptionPayments)
      .where(eq(subscriptionPayments.stripePaymentIntentId, paymentIntentId)).limit(1)

    if (!payment) return

    await db.update(subscriptionPayments).set({
      status: 'refunded',
      refundedAt: new Date()
    }).where(eq(subscriptionPayments.id, payment.id))

    fastify.log.info({ paymentId: payment.id }, 'Refund recorded')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle charge refunded')
    throw error
  }
}

/**
 * Handle Connect account updates - marks onboarding complete when charges_enabled
 */
async function handleAccountUpdated(account: Stripe.Account, fastify: FastifyInstance) {
  try {
    if (account.charges_enabled && account.details_submitted) {
      await db.update(userPaymentConfig).set({
        stripeOnboardingComplete: true,
        updatedAt: new Date()
      }).where(eq(userPaymentConfig.stripeAccountId, account.id))

      fastify.log.info({ stripeAccountId: account.id }, 'Connect account onboarding complete')
    }
  } catch (error) {
    fastify.log.error(error, 'Failed to handle account updated')
  }
}

// ============================================================================
// SITE MEMBERSHIP (PLATFORM SUBSCRIPTION) WEBHOOK HANDLERS
// ============================================================================

async function handleSiteMembershipCheckout(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
  fastify: FastifyInstance
) {
  try {
    const userId = session.metadata?.bobbinry_user_id
    if (!userId) {
      fastify.log.warn({ sessionId: session.id }, 'Missing bobbinry_user_id in checkout metadata')
      return
    }

    const stripeSubscriptionId = typeof session.subscription === 'string'
      ? session.subscription
      : (session.subscription as any)?.id

    if (!stripeSubscriptionId) {
      fastify.log.warn({ sessionId: session.id }, 'No subscription ID in checkout session')
      return
    }

    // Fetch the subscription for period details
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId)
    const period = getSubscriptionPeriod(sub)

    // Upsert site membership
    await db
      .insert(siteMemberships)
      .values({
        userId,
        tier: 'supporter',
        status: 'active',
        stripeSubscriptionId,
        stripePriceId: sub.items.data[0]?.price?.id || null,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      })
      .onConflictDoUpdate({
        target: siteMemberships.userId,
        set: {
          tier: 'supporter',
          status: 'active',
          stripeSubscriptionId,
          stripePriceId: sub.items.data[0]?.price?.id || null,
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          updatedAt: new Date(),
        },
      })

    // Upsert supporter badge
    await db
      .insert(userBadges)
      .values({
        userId,
        badge: 'supporter',
        label: 'Supporter',
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [userBadges.userId, userBadges.badge],
        set: { isActive: true },
      })

    // Save Stripe customer ID on user if not already set
    const customerId = typeof session.customer === 'string'
      ? session.customer
      : (session.customer as any)?.id

    if (customerId) {
      await db
        .update(users)
        .set({ stripeCustomerId: customerId, updatedAt: new Date() })
        .where(eq(users.id, userId))
    }

    fastify.log.info({ userId }, 'Site membership activated via checkout')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle site membership checkout')
    throw error
  }
}

async function handleSiteMembershipUpdated(subscription: Stripe.Subscription, fastify: FastifyInstance) {
  try {
    const userId = subscription.metadata?.bobbinry_user_id
    if (!userId) return

    const period = getSubscriptionPeriod(subscription)
    await db
      .update(siteMemberships)
      .set({
        status: subscription.status === 'active' ? 'active' : subscription.status as string,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        updatedAt: new Date(),
      })
      .where(eq(siteMemberships.userId, userId))

    fastify.log.info({ userId, status: subscription.status }, 'Site membership updated')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle site membership updated')
    throw error
  }
}

async function handleSiteMembershipDeleted(subscription: Stripe.Subscription, fastify: FastifyInstance) {
  try {
    const userId = subscription.metadata?.bobbinry_user_id
    if (!userId) return

    // Skip if membership is admin-granted (no stripeSubscriptionId)
    const [existing] = await db
      .select({ stripeSubscriptionId: siteMemberships.stripeSubscriptionId })
      .from(siteMemberships)
      .where(eq(siteMemberships.userId, userId))
      .limit(1)
    if (existing && !existing.stripeSubscriptionId) {
      fastify.log.info({ userId }, 'Skipping Stripe deletion for admin-granted membership')
      return
    }

    // Set membership to expired
    await db
      .update(siteMemberships)
      .set({ tier: 'free', status: 'expired', updatedAt: new Date() })
      .where(eq(siteMemberships.userId, userId))

    // Deactivate supporter badge (only supporter, not others like owner)
    await db
      .update(userBadges)
      .set({ isActive: false })
      .where(
        and(
          eq(userBadges.userId, userId),
          eq(userBadges.badge, 'supporter')
        )
      )

    fastify.log.info({ userId }, 'Site membership canceled, supporter badge deactivated')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle site membership deleted')
    throw error
  }
}

async function handleSiteMembershipPaymentSucceeded(invoice: Stripe.Invoice, fastify: FastifyInstance) {
  try {
    const inv = invoice as any
    const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id
    if (!subId) return

    const [membership] = await db
      .select({ userId: siteMemberships.userId })
      .from(siteMemberships)
      .where(eq(siteMemberships.stripeSubscriptionId, subId))
      .limit(1)

    if (!membership) return

    // Ensure status is active and supporter badge is active
    await db
      .update(siteMemberships)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(siteMemberships.userId, membership.userId))

    await db
      .update(userBadges)
      .set({ isActive: true })
      .where(
        and(
          eq(userBadges.userId, membership.userId),
          eq(userBadges.badge, 'supporter')
        )
      )

    fastify.log.info({ userId: membership.userId }, 'Site membership payment succeeded')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle site membership payment succeeded')
    throw error
  }
}

async function handleSiteMembershipPaymentFailed(invoice: Stripe.Invoice, fastify: FastifyInstance) {
  try {
    const inv = invoice as any
    const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id
    if (!subId) return

    await db
      .update(siteMemberships)
      .set({ status: 'past_due', updatedAt: new Date() })
      .where(eq(siteMemberships.stripeSubscriptionId, subId))

    fastify.log.info({ stripeSubId: subId }, 'Site membership payment failed')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle site membership payment failed')
    throw error
  }
}

export default stripePlugin
