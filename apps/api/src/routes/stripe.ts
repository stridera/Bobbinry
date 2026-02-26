import { FastifyPluginAsync, FastifyInstance } from 'fastify'
import Stripe from 'stripe'
import { db } from '../db/connection'
import {
  subscriptions,
  subscriptionPayments,
  subscriptionTiers,
  userPaymentConfig,
  users
} from '../db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth, requireSelf } from '../middleware/auth'

function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

const PLATFORM_FEE_PERCENT = parseInt(process.env.PLATFORM_FEE_PERCENT || '5', 10)

// Initialize Stripe - will be null if no secret key configured
function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2025-01-27.acacia' as any })
}

const stripePlugin: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // PAYMENT CONFIG ROUTES (preserved from original)
  // ============================================================================

  fastify.get<{
    Params: { userId: string }
  }>('/users/:userId/payment-config', async (request, reply) => {
    try {
      const { userId } = request.params
      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

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

      const sanitized = {
        ...config[0],
        patreonAccessToken: config[0]!.patreonAccessToken ? '***REDACTED***' : null,
        patreonRefreshToken: config[0]!.patreonRefreshToken ? '***REDACTED***' : null
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
    preHandler: requireAuth
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
    preHandler: requireAuth
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
        // Get user info for pre-filling
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)

        // Create Express account
        const account = await stripe.accounts.create({
          type: 'express',
          ...(user?.email ? { email: user.email } : {}),
          metadata: { bobbinry_user_id: userId },
          capabilities: {
            transfers: { requested: true }
          }
        } as Stripe.AccountCreateParams)
        stripeAccountId = account.id

        // Save account ID
        await db.insert(userPaymentConfig).values({
          userId,
          stripeAccountId: account.id,
          stripeOnboardingComplete: false,
          paymentProvider: 'stripe'
        }).onConflictDoUpdate({
          target: userPaymentConfig.userId,
          set: {
            stripeAccountId: account.id,
            updatedAt: new Date()
          }
        })
      }

      // Create Account Link for onboarding
      const baseUrl = process.env.WEB_ORIGIN || 'http://localhost:3100'
      const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        return_url: returnUrl || `${baseUrl}/settings/monetization?stripe=complete`,
        refresh_url: refreshUrl || `${baseUrl}/settings/monetization?stripe=refresh`,
        type: 'account_onboarding'
      })

      return reply.status(200).send({ url: accountLink.url })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to initiate Stripe Connect' })
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
    }
  }>('/subscribe/checkout', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { subscriberId, authorId, tierId, billingPeriod = 'monthly' } = request.body
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
        payment_intent_data: {
          application_fee_amount: Math.round(price * PLATFORM_FEE_PERCENT / 100),
          transfer_data: {
            destination: authorConfig.stripeAccountId
          }
        } as any,
        subscription_data: {
          metadata: {
            bobbinry_subscriber_id: subscriberId,
            bobbinry_author_id: authorId,
            bobbinry_tier_id: tierId
          },
          application_fee_percent: PLATFORM_FEE_PERCENT
        },
        metadata: {
          bobbinry_subscriber_id: subscriberId,
          bobbinry_author_id: authorId,
          bobbinry_tier_id: tierId
        },
        success_url: `${baseUrl}/u/{CHECKOUT_SESSION_ID}?subscribed=true`,
        cancel_url: `${baseUrl}/u/{CHECKOUT_SESSION_ID}?subscribed=false`
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
    Body: { userId: string }
  }>('/subscribe/portal-session', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { userId } = request.body
      if (!requireSelf(request, reply, userId)) return

      const stripe = getStripe()
      if (!stripe) return reply.status(503).send({ error: 'Stripe not configured' })

      // Find user's Stripe customer ID from their subscription
      const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.subscriberId, userId)).limit(1)
      if (!sub?.stripeSubscriptionId) {
        return reply.status(400).send({ error: 'No active subscription found' })
      }

      // Get customer from subscription
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
      const customerId = stripeSub.customer as string

      const baseUrl = process.env.WEB_ORIGIN || 'http://localhost:3100'
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${baseUrl}/library`
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
        // Verify webhook signature in production
        event = stripe.webhooks.constructEvent(
          request.rawBody as string,
          signature,
          webhookSecret
        )
      } else {
        // Development: trust the payload
        event = request.body as Stripe.Event
      }

      fastify.log.info({ eventType: event.type }, 'Stripe webhook received')

      switch (event.type) {
        case 'customer.subscription.created':
          await handleSubscriptionCreated(event.data.object as Stripe.Subscription, fastify)
          break
        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, fastify)
          break
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, fastify)
          break
        case 'invoice.payment_succeeded':
          await handlePaymentSucceeded(event.data.object as Stripe.Invoice, fastify)
          break
        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object as Stripe.Invoice, fastify)
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

    const sub = subscription as any
    await db.insert(subscriptions).values({
      subscriberId,
      authorId,
      tierId,
      status: subscription.status as string,
      currentPeriodStart: new Date((sub.current_period_start ?? 0) * 1000),
      currentPeriodEnd: new Date((sub.current_period_end ?? 0) * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      stripeSubscriptionId: subscription.id
    })

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

    const subData = subscription as any
    await db.update(subscriptions).set({
      status: subscription.status as string,
      currentPeriodEnd: new Date((subData.current_period_end ?? 0) * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      updatedAt: new Date()
    }).where(eq(subscriptions.id, sub.id))

    fastify.log.info({ subscriptionId: sub.id, status: subscription.status }, 'Subscription updated')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle subscription updated')
    throw error
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription, fastify: FastifyInstance) {
  try {
    await db.update(subscriptions).set({
      status: 'canceled',
      updatedAt: new Date()
    }).where(eq(subscriptions.stripeSubscriptionId, subscription.id))

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

export default stripePlugin
