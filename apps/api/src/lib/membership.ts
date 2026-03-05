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
    .select({ tier: siteMemberships.tier, status: siteMemberships.status })
    .from(siteMemberships)
    .where(eq(siteMemberships.userId, userId))
    .limit(1)

  if (membership && membership.tier === 'supporter' && membership.status === 'active') {
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
 * Get size limits for uploads, applying multiplier for supporters.
 */
export function getSizeLimits(tier: MembershipTier): Record<string, number> {
  const base: Record<string, number> = {
    cover: 10 * 1024 * 1024,   // 10 MB
    entity: 10 * 1024 * 1024,  // 10 MB
    editor: 10 * 1024 * 1024,  // 10 MB
    avatar: 5 * 1024 * 1024,   // 5 MB
    map: 50 * 1024 * 1024,     // 50 MB
  }

  if (tier === 'supporter') {
    for (const key of Object.keys(base)) {
      base[key] = base[key]! * UPLOAD_SIZE_MULTIPLIER
    }
  }

  return base
}
