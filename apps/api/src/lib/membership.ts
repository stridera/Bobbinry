/**
 * Membership & Badge Helpers
 *
 * Constants and utility functions for the supporter membership system.
 */

import { db } from '../db/connection'
import { siteMemberships, userBadges } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

// --- Tier Limits ---

export const FREE_PROJECT_LIMIT = 3
export const SUPPORTER_PROJECT_LIMIT = 25
export const UPLOAD_SIZE_MULTIPLIER = 2

export type MembershipTier = 'free' | 'supporter'

/**
 * Get a user's membership tier. No row = free.
 */
export async function getUserMembershipTier(userId: string): Promise<MembershipTier> {
  const [membership] = await db
    .select({
      tier: siteMemberships.tier,
      status: siteMemberships.status,
      currentPeriodEnd: siteMemberships.currentPeriodEnd,
    })
    .from(siteMemberships)
    .where(eq(siteMemberships.userId, userId))
    .limit(1)

  if (
    membership &&
    membership.tier === 'supporter' &&
    membership.status === 'active' &&
    // null currentPeriodEnd = admin-granted, never expires
    (!membership.currentPeriodEnd || membership.currentPeriodEnd > new Date())
  ) {
    return 'supporter'
  }

  return 'free'
}

/**
 * Get a user's active, non-expired badge names.
 */
export async function getUserBadges(userId: string): Promise<string[]> {
  const badges = await db
    .select({ badge: userBadges.badge })
    .from(userBadges)
    .where(and(
      eq(userBadges.userId, userId),
      eq(userBadges.isActive, true),
      sql`(${userBadges.expiresAt} IS NULL OR ${userBadges.expiresAt} > NOW())`
    ))

  return badges.map(b => b.badge)
}

/**
 * Get project limit for a given tier.
 */
export function getProjectLimit(tier: MembershipTier): number {
  return tier === 'supporter' ? SUPPORTER_PROJECT_LIMIT : FREE_PROJECT_LIMIT
}

/**
 * Revision-history retention, in days.
 *
 * Both tiers keep every restore point for the first 30 days — the "I broke it
 * this morning" case is a safety net, not a perk. Past that, free thins down to
 * labeled checkpoints while supporters keep one per day out to a year and one
 * per week beyond. Labeled checkpoints (publish / import / search-replace /
 * pre-restore / manual) are never thinned for either tier.
 */
export const REVISION_KEEP_ALL_DAYS = 30
export const SUPPORTER_REVISION_DAILY_DAYS = 365
export const FREE_REVISION_CAP = 100
export const SUPPORTER_REVISION_CAP = 1000
/** Labeled checkpoints are never thinned by age, but still need a ceiling —
 *  a publish loop or a scripted search-replace would otherwise grow one
 *  entity's history without bound. */
export const LABELED_REVISION_CAP = 50

/**
 * Grace period before a lapsed supporter's history is thinned to free-tier
 * depth. Without it, letting a subscription expire silently destroys a year of
 * restore points on the next nightly run.
 */
export const REVISION_DOWNGRADE_GRACE_DAYS = 30

/**
 * Get size limits for uploads, applying multiplier for supporters.
 */
export function getSizeLimits(tier: MembershipTier): Record<string, number> {
  const base: Record<string, number> = {
    cover: 10 * 1024 * 1024,   // 10 MB
    entity: 10 * 1024 * 1024,  // 10 MB
    editor: 10 * 1024 * 1024,  // 10 MB
    avatar: 5 * 1024 * 1024,   // 5 MB
    map: 50 * 1024 * 1024,     // 50 MB
    import: 25 * 1024 * 1024,  // 25 MB — manuscript import source (docx/epub/pdf/etc.)
  }

  if (tier === 'supporter') {
    for (const key of Object.keys(base)) {
      base[key] = base[key]! * UPLOAD_SIZE_MULTIPLIER
    }
  }

  return base
}
