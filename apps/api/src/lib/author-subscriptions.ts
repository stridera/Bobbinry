/**
 * Whether an author can actually take subscriptions.
 *
 * "Accepts subscriptions" is the one rule gating subscribers-only projects:
 * the author has finished Stripe onboarding AND has at least one active tier.
 * A subscribers-only project whose author fails this rule would be a paywall
 * nobody can pay at, so it is rejected on write, hidden from explore and the
 * feed, and migrated to beta-readers-only (see the data migration).
 *
 * Three forms, one rule:
 *  - `authorAcceptsSubscriptions`  — a single author.
 *  - `authorsAcceptingSubscriptions` — a batch, one query for any number of authors.
 *  - `acceptsSubscriptionsSql`     — an EXISTS fragment for list queries.
 */
import { db } from '../db/connection'
import { userPaymentConfig, subscriptionTiers, projectPublishConfig, projects, notifications, users } from '../db/schema'
import { sendSubscribersDowngradedEmail, sendStripePaymentsPausedEmail } from './email'
import { moduleLogger } from './logger'

const log = moduleLogger('author-subscriptions')
import { and, eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm'

/** Stripe onboarding finished: the author can receive payouts. */
export function stripePayoutsReady(
  config: { stripeAccountId: string | null; stripeOnboardingComplete: boolean } | null | undefined,
): boolean {
  return !!(config?.stripeAccountId && config.stripeOnboardingComplete)
}

/** The subset of `authorIds` that accept subscriptions. */
export async function authorsAcceptingSubscriptions(authorIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(authorIds)]
  if (unique.length === 0) return new Set()

  const rows = await db
    .selectDistinct({ authorId: userPaymentConfig.userId })
    .from(userPaymentConfig)
    .innerJoin(subscriptionTiers, and(
      eq(subscriptionTiers.authorId, userPaymentConfig.userId),
      eq(subscriptionTiers.isActive, true),
    ))
    .where(and(
      inArray(userPaymentConfig.userId, unique),
      sql`${userPaymentConfig.stripeAccountId} IS NOT NULL AND ${userPaymentConfig.stripeAccountId} <> ''`,
      eq(userPaymentConfig.stripeOnboardingComplete, true),
    ))
  return new Set(rows.map(r => r.authorId))
}

export async function authorAcceptsSubscriptions(authorId: string): Promise<boolean> {
  return (await authorsAcceptingSubscriptions([authorId])).has(authorId)
}

/** `EXISTS (...)` — true when the author in `authorIdColumn` accepts subscriptions. */
export function acceptsSubscriptionsSql(authorIdColumn: AnyColumn): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${userPaymentConfig}
    WHERE ${userPaymentConfig.userId} = ${authorIdColumn}
      AND ${userPaymentConfig.stripeAccountId} IS NOT NULL
      AND ${userPaymentConfig.stripeAccountId} <> ''
      AND ${userPaymentConfig.stripeOnboardingComplete} = true
      AND EXISTS (
        SELECT 1 FROM ${subscriptionTiers}
        WHERE ${subscriptionTiers.authorId} = ${userPaymentConfig.userId}
          AND ${subscriptionTiers.isActive} = true
      )
  )`
}

/**
 * Explore/listing guard: a subscribers-only project is only listable while its
 * author can actually take subscriptions.
 */
export function listableForAuthor(defaultVisibilityColumn: AnyColumn, authorIdColumn: AnyColumn): SQL {
  return sql`(${defaultVisibilityColumn} <> 'subscribers_only' OR ${acceptsSubscriptionsSql(authorIdColumn)})`
}

/**
 * Keep subscribers-only projects honest: when an author stops being able to
 * take subscriptions (last active tier deactivated or deleted, Stripe
 * disconnected), move their subscribers-only projects to "beta readers only".
 * Same transformation as migration 0051, scoped to one author. A no-op while
 * the author still accepts subscriptions.
 *
 * When at least one project moves, the author gets one in-app notification
 * (which also marks those projects as auto-downgraded for the dashboard
 * banner, see `autoDowngradedProjectIds`) and one email listing them.
 */
export async function downgradeUnpayableSubscriberProjects(
  authorId: string,
): Promise<Array<{ id: string; name: string }>> {
  if (await authorAcceptsSubscriptions(authorId)) return []

  const moved = await db.execute(sql`
    UPDATE ${projectPublishConfig} AS c
    SET project_visibility = 'private', default_visibility = 'public', updated_at = NOW()
    FROM ${projects} AS p
    WHERE p.id = c.project_id
      AND p.owner_id = ${authorId}
      AND c.default_visibility = 'subscribers_only'
    RETURNING c.project_id AS id, p.name AS name
  `) as unknown as Array<{ id: string; name: string }>
  const list = moved.map(r => ({ id: r.id, name: r.name }))
  if (list.length === 0) return list

  try {
    const [config] = await db
      .select({ stripeAccountId: userPaymentConfig.stripeAccountId, done: userPaymentConfig.stripeOnboardingComplete })
      .from(userPaymentConfig)
      .where(eq(userPaymentConfig.userId, authorId))
      .limit(1)
    const reason = stripePayoutsReady(config ? { stripeAccountId: config.stripeAccountId, stripeOnboardingComplete: config.done } : null)
      ? 'no_active_tiers' as const
      : 'no_stripe' as const
    const names = list.map(p => p.name)

    await db.insert(notifications).values({
      recipientId: authorId,
      type: 'subscribers_downgraded',
      title: list.length === 1
        ? `"${names[0]}" moved to Beta readers only`
        : `${list.length} projects moved to Beta readers only`,
      body: (reason === 'no_stripe'
        ? 'Stripe is no longer connected, so subscribers-only access was turned off.'
        : 'You have no active subscription tier, so subscribers-only access was turned off.')
        + ' Existing beta readers keep access. Fix monetization, then switch back to Subscribers in each project\'s publish dashboard.',
      metadata: { projectIds: list.map(p => p.id), url: '/settings/monetization' },
    })

    const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, authorId)).limit(1)
    if (owner) await sendSubscribersDowngradedEmail(owner.email, names, reason)
  } catch (err) {
    // The downgrade already happened; a failed notice must not fail the request.
    log.error({ err: (err as Error).message, authorId }, 'Failed to notify author of automatic access downgrade')
  }
  return list
}

/**
 * Which of an author's projects were moved to beta-only by
 * `downgradeUnpayableSubscriberProjects` (read back from its notification, so
 * no extra column is needed).
 */
export async function wasAutoDowngraded(authorId: string, projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(
      eq(notifications.recipientId, authorId),
      eq(notifications.type, 'subscribers_downgraded'),
      sql`${notifications.metadata} -> 'projectIds' @> to_jsonb(${projectId}::text)`,
    ))
    .limit(1)
  return !!row
}

/**
 * Stripe paused charges on the author's account. Projects are deliberately left
 * subscribers-only (existing subscribers keep access; payments may come back),
 * so this only tells the author: one in-app notification and one email. The
 * caller guarantees this runs once, on the true -> false transition.
 */
export async function notifyStripePaymentsPaused(authorId: string): Promise<void> {
  try {
    await db.insert(notifications).values({
      recipientId: authorId,
      type: 'stripe_payments_paused',
      title: 'Stripe has paused payments on your account',
      body: 'New readers can\'t subscribe until this is resolved. Existing subscribers keep access and your projects stay subscribers-only.',
      metadata: { url: '/settings/monetization' },
    })
    const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, authorId)).limit(1)
    if (owner) await sendStripePaymentsPausedEmail(owner.email)
  } catch (err) {
    log.error({ err: (err as Error).message, authorId }, 'Failed to notify author that Stripe paused payments')
  }
}
