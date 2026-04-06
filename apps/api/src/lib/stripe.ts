import StripeSDK from 'stripe'
// Stripe v22's CJS types don't re-export sub-types (Account, Event, etc.)
// into the StripeConstructor namespace. Import the full type from the core module.
import type { Stripe } from 'stripe/cjs/stripe.core.js'

/**
 * Shared Stripe helpers — single source of truth for account creation,
 * onboarding links, and client instantiation.
 */

/** Single Stripe client factory. Returns null if STRIPE_SECRET_KEY is unset. */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  // StripeSDK's CJS types declare a plain function instead of a class,
  // but at runtime it is constructable. Cast to get proper typing.
  const StripeClient = StripeSDK as unknown as new (key: string) => Stripe
  return new StripeClient(key)
}

/** Extract period dates from a Stripe subscription's first item. */
export function getSubscriptionPeriod(sub: Stripe.Subscription): { start: Date; end: Date } {
  const item = sub.items?.data?.[0]
  const periodStart = item?.current_period_start
  const periodEnd = item?.current_period_end
  return {
    start: periodStart ? new Date(periodStart * 1000) : new Date(),
    end: periodEnd ? new Date(periodEnd * 1000) : new Date(),
  }
}

/** Split a display name into first/last for Stripe prefill. */
export function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) {
    return { firstName: parts[0]!, lastName: '' }
  }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1]!,
  }
}

interface CreateExpressAccountOpts {
  user: { id: string; email: string; name?: string | null }
  profile?: {
    displayName?: string | null
    username?: string | null
    websiteUrl?: string | null
    bio?: string | null
  } | null | undefined
}

/**
 * Create a Stripe Express connected account with full prefill.
 * Express accounts: Stripe hosts onboarding + payout dashboard.
 */
export async function createExpressAccount(
  stripe: Stripe,
  { user, profile }: CreateExpressAccountOpts
): Promise<Stripe.Account> {
  const nameSource = profile?.displayName || user.name || ''
  const { firstName, lastName } = splitName(nameSource)

  const profileUrl = profile?.websiteUrl
    || (profile?.username ? `https://bobbinry.com/${profile.username}` : undefined)

  return stripe.accounts.create({
    type: 'express',
    email: user.email,
    metadata: { bobbinry_user_id: user.id },
    capabilities: { transfers: { requested: true } },
    business_type: 'individual',
    ...(firstName ? {
      individual: {
        first_name: firstName,
        ...(lastName ? { last_name: lastName } : {}),
        email: user.email,
      },
    } : {}),
    business_profile: {
      ...(profileUrl ? { url: profileUrl } : {}),
      ...(profile?.bio ? { product_description: profile.bio } : {}),
    },
  })
}

/**
 * Create an Account Link for Express onboarding.
 * Uses collection_options to only collect currently_due fields upfront
 * and omit future_requirements, reducing onboarding friction.
 */
export async function createOnboardingLink(
  stripe: Stripe,
  accountId: string,
  returnUrl: string,
  refreshUrl: string
): Promise<Stripe.AccountLink> {
  return stripe.accountLinks.create({
    account: accountId,
    return_url: returnUrl,
    refresh_url: refreshUrl,
    type: 'account_onboarding',
    collection_options: {
      fields: 'currently_due',
      future_requirements: 'omit',
    },
  })
}
