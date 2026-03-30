import Stripe from 'stripe'

/**
 * Shared Stripe helpers — single source of truth for account creation,
 * onboarding links, and client instantiation.
 */

/** Single Stripe client factory. Returns null if STRIPE_SECRET_KEY is unset. */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key)
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
  } as Stripe.AccountCreateParams)
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
  } as Stripe.AccountLinkCreateParams)
}
