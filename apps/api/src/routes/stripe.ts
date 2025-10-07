import { FastifyPluginAsync, FastifyInstance } from 'fastify'
import type { StripeWebhookEvent, StripeSubscription, StripeInvoice, StripeCharge } from '../types/stripe'
import { db } from '../db/connection'
import {
  subscriptions,
  subscriptionPayments,
  userPaymentConfig,
  users
} from '../db/schema'
import { eq } from 'drizzle-orm'

// Helper to validate UUID
function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

const stripePlugin: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // STRIPE CONNECT ROUTES
  // ============================================================================

  // Get payment configuration for a user
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
        // Return defaults
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

      // Don't expose sensitive tokens
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

  // Update payment configuration (Stripe Connect)
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
  }>('/users/:userId/payment-config', async (request, reply) => {
    try {
      const { userId } = request.params
      const configData = request.body

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      // Verify user exists
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)

      if (user.length === 0) {
        return reply.status(404).send({ error: 'User not found' })
      }

      // Check if config exists
      const existing = await db
        .select()
        .from(userPaymentConfig)
        .where(eq(userPaymentConfig.userId, userId))
        .limit(1)

      if (existing.length > 0) {
        // Update
        const [updated] = await db
          .update(userPaymentConfig)
          .set({
            ...configData,
            updatedAt: new Date()
          })
          .where(eq(userPaymentConfig.userId, userId))
          .returning()

        if (!updated) {
          return reply.status(500).send({ error: 'Failed to update payment config' })
        }

        // Sanitize response
        const sanitized = {
          ...updated,
          patreonAccessToken: updated.patreonAccessToken ? '***REDACTED***' : null,
          patreonRefreshToken: updated.patreonRefreshToken ? '***REDACTED***' : null
        }

        return reply.status(200).send({ paymentConfig: sanitized })
      } else {
        // Create
        const [created] = await db
          .insert(userPaymentConfig)
          .values({
            userId,
            ...configData
          })
          .returning()

        if (!created) {
          return reply.status(500).send({ error: 'Failed to create payment config' })
        }

        const sanitized = {
          ...created,
          patreonAccessToken: created.patreonAccessToken ? '***REDACTED***' : null,
          patreonRefreshToken: created.patreonRefreshToken ? '***REDACTED***' : null
        }

        return reply.status(201).send({ paymentConfig: sanitized })
      }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update payment configuration' })
    }
  })

  // Initiate Stripe Connect OAuth flow
  fastify.post<{
    Params: { userId: string }
    Body: {
      returnUrl?: string
      refreshUrl?: string
    }
  }>('/users/:userId/stripe/connect', async (request, reply) => {
    try {
      const { userId } = request.params
      // const { returnUrl } = request.body // TODO: Use for redirect after OAuth

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID format' })
      }

      // TODO: Initialize Stripe Connect OAuth
      // This is a placeholder response
      const oauthUrl = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${process.env.STRIPE_CLIENT_ID}&scope=read_write&state=${userId}`

      return reply.status(200).send({
        oauthUrl,
        message: 'Stripe integration pending - this is a placeholder',
        note: 'Redirect user to oauthUrl to complete Stripe Connect onboarding'
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to initiate Stripe Connect' })
    }
  })

  // Handle Stripe Connect OAuth callback
  fastify.get<{
    Querystring: {
      code?: string
      state?: string // userId
      error?: string
    }
  }>('/stripe/connect/callback', async (request, reply) => {
    try {
      const { code, state, error } = request.query

      if (error) {
        return reply.status(400).send({ error: `Stripe Connect error: ${error}` })
      }

      if (!code || !state) {
        return reply.status(400).send({ error: 'Missing code or state parameter' })
      }

      const userId = state

      if (!isValidUUID(userId)) {
        return reply.status(400).send({ error: 'Invalid user ID in state' })
      }

      // TODO: Exchange code for Stripe account ID
      // For now, just save a placeholder
      await db
        .insert(userPaymentConfig)
        .values({
          userId,
          stripeAccountId: `acct_placeholder_${code}`,
          stripeOnboardingComplete: false,
          paymentProvider: 'stripe'
        })
        .onConflictDoUpdate({
          target: userPaymentConfig.userId,
          set: {
            stripeAccountId: `acct_placeholder_${code}`,
            updatedAt: new Date()
          }
        })

      return reply.status(200).send({
        success: true,
        message: 'Stripe Connect started',
        note: 'Full Stripe integration pending'
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to handle Stripe callback' })
    }
  })

  // ============================================================================
  // STRIPE WEBHOOK HANDLER
  // ============================================================================

  // Stripe webhook endpoint
  fastify.post<{
    Body: {
      type: string
      data: {
        object: any
      }
      [key: string]: any
    }
  }>('/stripe/webhook', async (request, reply) => {
    // TODO: Add rawBody handling for signature verification
    try {
      // const signature = request.headers['stripe-signature'] as string
      const event = request.body

      // TODO: Verify webhook signature
      // const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
      // if (!signature || !webhookSecret) {
      //   return reply.status(400).send({ error: 'Missing signature or secret' })
      // }

      fastify.log.info({ eventType: event.type }, 'Stripe webhook received')

      // Handle different event types
      switch (event.type) {
        case 'customer.subscription.created':
          await handleSubscriptionCreated(event.data.object, fastify)
          break

        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object, fastify)
          break

        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object, fastify)
          break

        case 'invoice.payment_succeeded':
          await handlePaymentSucceeded(event.data.object, fastify)
          break

        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object, fastify)
          break

        case 'charge.refunded':
          await handleChargeRefunded(event.data.object, fastify)
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

async function handleSubscriptionCreated(subscription: StripeSubscription, fastify: FastifyInstance) {
  try {
    fastify.log.info({ subscriptionId: subscription.id }, 'Processing subscription created')

    // TODO: Map Stripe subscription to our database
    // Look up customer metadata to find userId, tierId, etc.
    // Create subscription record

    // Placeholder logging
    fastify.log.info('Subscription created webhook handled (placeholder)')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle subscription created')
    throw error
  }
}

async function handleSubscriptionUpdated(subscription: StripeSubscription, fastify: FastifyInstance) {
  try {
    fastify.log.info({ subscriptionId: subscription.id }, 'Processing subscription updated')

    const stripeSubId = subscription.id

    // Find our subscription record
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
      .limit(1)

    if (!sub) {
      fastify.log.warn({ stripeSubId }, 'Subscription not found in database')
      return
    }

    // Update status
    const status = subscription.status // active, past_due, canceled, etc.
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000)

    await db
      .update(subscriptions)
      .set({
        status,
        currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, sub.id))

    fastify.log.info({ subscriptionId: sub.id, status }, 'Subscription updated')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle subscription updated')
    throw error
  }
}

async function handleSubscriptionDeleted(subscription: StripeSubscription, fastify: FastifyInstance) {
  try {
    fastify.log.info({ subscriptionId: subscription.id }, 'Processing subscription deleted')

    const stripeSubId = subscription.id

    await db
      .update(subscriptions)
      .set({
        status: 'canceled',
        updatedAt: new Date()
      })
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))

    fastify.log.info('Subscription deleted')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle subscription deleted')
    throw error
  }
}

async function handlePaymentSucceeded(invoice: StripeInvoice, fastify: FastifyInstance) {
  try {
    fastify.log.info({ invoiceId: invoice.id }, 'Processing payment succeeded')

    const stripeSubId = invoice.subscription
    const amount = invoice.amount_paid
    const currency = invoice.currency

    // Find subscription
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
      .limit(1)

    if (!sub) {
      fastify.log.warn({ stripeSubId }, 'Subscription not found for payment')
      return
    }

    // Record payment
    await db
      .insert(subscriptionPayments)
      .values({
        subscriptionId: sub.id,
        amount: (amount / 100).toFixed(2), // Convert cents to dollars
        currency: currency.toUpperCase(),
        status: 'succeeded',
        stripePaymentIntentId: invoice.payment_intent,
        paidAt: new Date()
      })

    fastify.log.info({ subscriptionId: sub.id, amount }, 'Payment recorded')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle payment succeeded')
    throw error
  }
}

async function handlePaymentFailed(invoice: StripeInvoice, fastify: FastifyInstance) {
  try {
    fastify.log.info({ invoiceId: invoice.id }, 'Processing payment failed')

    const stripeSubId = invoice.subscription
    const amount = invoice.amount_due
    const currency = invoice.currency

    // Find subscription
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
      .limit(1)

    if (!sub) {
      fastify.log.warn({ stripeSubId }, 'Subscription not found for failed payment')
      return
    }

    // Update subscription status
    await db
      .update(subscriptions)
      .set({
        status: 'past_due',
        updatedAt: new Date()
      })
      .where(eq(subscriptions.id, sub.id))

    // Record failed payment
    await db
      .insert(subscriptionPayments)
      .values({
        subscriptionId: sub.id,
        amount: (amount / 100).toFixed(2),
        currency: currency.toUpperCase(),
        status: 'failed',
        stripePaymentIntentId: invoice.payment_intent,
        failureReason: invoice.last_payment_error?.message || 'Payment failed'
      })

    fastify.log.info({ subscriptionId: sub.id }, 'Failed payment recorded')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle payment failed')
    throw error
  }
}

async function handleChargeRefunded(charge: StripeCharge, fastify: FastifyInstance) {
  try {
    fastify.log.info({ chargeId: charge.id }, 'Processing charge refunded')

    const paymentIntentId = charge.payment_intent

    // Find payment record
    const [payment] = await db
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.stripePaymentIntentId, paymentIntentId))
      .limit(1)

    if (!payment) {
      fastify.log.warn({ paymentIntentId }, 'Payment not found for refund')
      return
    }

    // Update payment status
    await db
      .update(subscriptionPayments)
      .set({
        status: 'refunded',
        refundedAt: new Date()
      })
      .where(eq(subscriptionPayments.id, payment.id))

    fastify.log.info({ paymentId: payment.id }, 'Refund recorded')
  } catch (error) {
    fastify.log.error(error, 'Failed to handle charge refunded')
    throw error
  }
}

export default stripePlugin
