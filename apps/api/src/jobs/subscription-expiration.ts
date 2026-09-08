/**
 * Subscription Expiration Reconciliation
 *
 * Catches drift between local subscription state and Stripe:
 * - Subscriptions marked active locally but expired (missed cancellation webhook)
 * - Subscriptions marked past_due/canceled locally but active in Stripe (missed recovery webhook)
 * - Site memberships with expired periods still marked active
 *
 * Runs every 15 minutes via the trigger scheduler.
 */

import { db } from '../db/connection'
import { subscriptions, siteMemberships } from '../db/schema'
import { eq, and, lt, inArray, isNotNull } from 'drizzle-orm'
import { getStripe, getSubscriptionPeriod } from '../lib/stripe'
import { moduleLogger } from '../lib/logger'

const log = moduleLogger('subscription-expiration')

/** Map Stripe statuses to our local status values. */
function mapStripeStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case 'active': return 'active'
    case 'past_due': return 'past_due'
    case 'canceled': return 'canceled'
    default: return 'expired' // incomplete, incomplete_expired, unpaid, trialing, etc.
  }
}

export async function processSubscriptionExpiration(): Promise<void> {
  try {
    const now = new Date()

    await Promise.allSettled([
      reconcileAuthorSubscriptions(now),
      reconcileSiteMemberships(now),
    ])
  } catch (err) {
    log.error({ err }, 'Failed')
  }
}

async function reconcileAuthorSubscriptions(now: Date): Promise<void> {
  const stripe = getStripe()

  // 1. Active locally but period has passed
  const expired = await db
    .select({
      id: subscriptions.id,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(subscriptions)
    .where(and(
      eq(subscriptions.status, 'active'),
      isNotNull(subscriptions.stripeSubscriptionId),
      lt(subscriptions.currentPeriodEnd, now)
    ))
    // Free-tier subs (no stripeSubscriptionId) have no billing cycle to expire —
    // they remain active until explicitly canceled.

  await Promise.allSettled(expired.map(async (sub) => {
    try {
      if (!stripe) return

      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId!)
      const period = getSubscriptionPeriod(stripeSub)

      if (stripeSub.status === 'active') {
        await db.update(subscriptions).set({
          currentPeriodEnd: period.end,
          updatedAt: now,
        }).where(eq(subscriptions.id, sub.id))
      } else {
        await db.update(subscriptions).set({
          status: mapStripeStatus(stripeSub.status),
          updatedAt: now,
        }).where(eq(subscriptions.id, sub.id))
      }
    } catch (err) {
      log.error({ err }, `Failed to reconcile subscription ${sub.id}`)
    }
  }))

  // 2. Past-due or canceled locally but possibly recovered in Stripe
  if (stripe) {
    const stale = await db
      .select({
        id: subscriptions.id,
        stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      })
      .from(subscriptions)
      .where(and(
        inArray(subscriptions.status, ['past_due', 'canceled']),
        isNotNull(subscriptions.stripeSubscriptionId)
      ))

    await Promise.allSettled(stale.map(async (sub) => {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId!)
        if (stripeSub.status === 'active') {
          const period = getSubscriptionPeriod(stripeSub)

          await db.update(subscriptions).set({
            status: 'active',
            currentPeriodEnd: period.end,
            cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
            updatedAt: now,
          }).where(eq(subscriptions.id, sub.id))

          log.info(`Restored subscription ${sub.id} to active (Stripe recovered)`)
        }
      } catch (err) {
        log.error({ err }, `Failed to check stale subscription ${sub.id}`)
      }
    }))
  }

  if (expired.length > 0) {
    log.info(`Reconciled ${expired.length} expired author subscriptions`)
  }
}

async function reconcileSiteMemberships(now: Date): Promise<void> {
  const stripe = getStripe()

  // Active locally but period has passed (only check rows with a period end set — admin-granted have null)
  const expired = await db
    .select({
      userId: siteMemberships.userId,
      stripeSubscriptionId: siteMemberships.stripeSubscriptionId,
    })
    .from(siteMemberships)
    .where(and(
      eq(siteMemberships.status, 'active'),
      isNotNull(siteMemberships.currentPeriodEnd),
      lt(siteMemberships.currentPeriodEnd, now)
    ))

  await Promise.allSettled(expired.map(async (mem) => {
    try {
      if (mem.stripeSubscriptionId && stripe) {
        const stripeSub = await stripe.subscriptions.retrieve(mem.stripeSubscriptionId)
        const period = getSubscriptionPeriod(stripeSub)

        if (stripeSub.status === 'active') {
          await db.update(siteMemberships).set({
            currentPeriodEnd: period.end,
            updatedAt: now,
          }).where(eq(siteMemberships.userId, mem.userId))
        } else {
          await db.update(siteMemberships).set({
            tier: 'free',
            status: 'expired',
            updatedAt: now,
          }).where(eq(siteMemberships.userId, mem.userId))
        }
      } else if (mem.stripeSubscriptionId) {
        // Stripe-backed, but our client is not configured, so we cannot tell
        // whether it renewed. Leave it alone — downgrading a paying member
        // because of our own missing configuration is not recoverable from
        // here, and it is what reconcileAuthorSubscriptions already does.
        log.warn(
          { userId: mem.userId },
          'Skipping expired site membership: Stripe is not configured, cannot verify renewal'
        )
      } else {
        // No Stripe subscription behind it (admin-granted, comped): nothing
        // can renew it, so the period end is authoritative.
        await db.update(siteMemberships).set({
          tier: 'free',
          status: 'expired',
          updatedAt: now,
        }).where(eq(siteMemberships.userId, mem.userId))
      }
    } catch (err) {
      log.error({ err }, `Failed to reconcile membership for user ${mem.userId}`)
    }
  }))

  if (expired.length > 0) {
    log.info(`Reconciled ${expired.length} expired site memberships`)
  }
}
