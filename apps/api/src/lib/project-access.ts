/**
 * Batch project access for one viewer, for list surfaces (feed, following).
 *
 * `canViewProject` and `checkChaptersAccess` answer for a single project; a
 * list of N projects would cost N round trips. This resolves the same rules —
 * owner, active beta reader (this project or author-wide from the same
 * author), access grant, active subscription — in a fixed four queries.
 */
import { db } from '../db/connection'
import { betaReaders, accessGrants, subscriptions, subscriptionTiers } from '../db/schema'
import { and, eq, or, isNull, inArray, sql, desc, asc } from 'drizzle-orm'
import { authorsAcceptingSubscriptions } from './author-subscriptions'
import { tierAccess } from './chapter-access'

export interface ProjectAccessInput {
  id: string
  ownerId: string
  /** public | unlisted | private (missing config reads as public). */
  projectVisibility: string | null
  /** public | subscribers_only (missing config reads as public). */
  defaultVisibility: string | null
}

/**
 * - ok: the viewer can open the project's chapters under the normal rules.
 * - subscribers_only: subscribers-only and the viewer is not one, but the
 *   author takes subscriptions — worth showing as a locked teaser.
 * - beta_only: private and the viewer has no access.
 * - hidden: subscribers-only but the author cannot take subscriptions, so the
 *   viewer has no way in. Never shown.
 */
export type ProjectAccessStatus = 'ok' | 'subscribers_only' | 'beta_only' | 'hidden'

export interface UpsellTier {
  id: string
  name: string
  priceMonthly: string | null
  earlyAccessDays: number
}

export interface ProjectAccess {
  status: ProjectAccessStatus
  /** Owner, active beta reader, or project-wide grantee: embargo does not apply. */
  privileged: boolean
  /** Early-access window of the viewer's active subscription to this author. */
  subscriberEarlyAccessDays: number | null
  /**
   * The viewer got in only through chapter-scoped grants on a private project:
   * those chapters, and nothing else, are theirs.
   */
  grantOnly: boolean
  /** Chapters opened by an active, unexpired chapter-scoped grant. */
  grantedChapterIds: string[]
  /** The author takes subscriptions. */
  acceptsSubscriptions: boolean
  /** The author's active tiers, cheapest first; empty unless the author takes subscriptions. */
  tiers: UpsellTier[]
}

/**
 * Cheapest active tier (`tiers` arrive cheapest first) that can read a chapter
 * published at `publishedAt` right now, by the same `tierAccess` rule the
 * reader uses.
 */
export function cheapestUnlockingTier(tiers: UpsellTier[], publishedAt: Date, now = new Date()): UpsellTier | null {
  for (const t of tiers) {
    if (tierAccess(publishedAt, t.earlyAccessDays, now).canAccess) return t
  }
  return null
}

export async function resolveProjectAccess(
  viewerId: string,
  projectList: ProjectAccessInput[],
): Promise<Map<string, ProjectAccess>> {
  const out = new Map<string, ProjectAccess>()
  if (projectList.length === 0) return out

  const projectIds = projectList.map(p => p.id)
  const ownerIds = [...new Set(projectList.map(p => p.ownerId))]

  const [betaRows, grantRows, subRows, accepting] = await Promise.all([
    db
      .select({ authorId: betaReaders.authorId, projectId: betaReaders.projectId })
      .from(betaReaders)
      .where(and(
        eq(betaReaders.readerId, viewerId),
        eq(betaReaders.isActive, true),
        inArray(betaReaders.authorId, ownerIds),
        or(isNull(betaReaders.projectId), inArray(betaReaders.projectId, projectIds)),
      )),
    db
      .select({
        authorId: accessGrants.authorId,
        projectId: accessGrants.projectId,
        chapterId: accessGrants.chapterId,
        expiresAt: accessGrants.expiresAt,
      })
      .from(accessGrants)
      .where(and(
        eq(accessGrants.grantedTo, viewerId),
        eq(accessGrants.isActive, true),
        or(isNull(accessGrants.expiresAt), sql`${accessGrants.expiresAt} > NOW()`),
        inArray(accessGrants.authorId, ownerIds),
        or(isNull(accessGrants.projectId), inArray(accessGrants.projectId, projectIds)),
      )),
    db
      .select({ authorId: subscriptions.authorId, earlyAccessDays: subscriptionTiers.earlyAccessDays })
      .from(subscriptions)
      .innerJoin(subscriptionTiers, eq(subscriptionTiers.id, subscriptions.tierId))
      .where(and(
        eq(subscriptions.subscriberId, viewerId),
        inArray(subscriptions.authorId, ownerIds),
        eq(subscriptions.status, 'active'),
        sql`${subscriptions.currentPeriodEnd} > NOW()`,
      ))
      .orderBy(desc(subscriptionTiers.tierLevel)),
    authorsAcceptingSubscriptions(ownerIds),
  ])

  const tierRows = accepting.size === 0 ? [] : await db
    .select({
      authorId: subscriptionTiers.authorId,
      id: subscriptionTiers.id,
      name: subscriptionTiers.name,
      priceMonthly: subscriptionTiers.priceMonthly,
      earlyAccessDays: subscriptionTiers.earlyAccessDays,
    })
    .from(subscriptionTiers)
    .where(and(inArray(subscriptionTiers.authorId, [...accepting]), eq(subscriptionTiers.isActive, true)))
    .orderBy(sql`${subscriptionTiers.priceMonthly} ASC NULLS FIRST`, asc(subscriptionTiers.tierLevel))
  const tiersByAuthor = new Map<string, UpsellTier[]>()
  for (const t of tierRows) {
    const list = tiersByAuthor.get(t.authorId) ?? []
    list.push({ id: t.id, name: t.name, priceMonthly: t.priceMonthly, earlyAccessDays: t.earlyAccessDays })
    tiersByAuthor.set(t.authorId, list)
  }

  // Highest tier wins (rows arrive ordered by tier level, descending).
  const subByAuthor = new Map<string, number>()
  for (const s of subRows) if (!subByAuthor.has(s.authorId)) subByAuthor.set(s.authorId, s.earlyAccessDays ?? 0)

  for (const p of projectList) {
    const isOwner = p.ownerId === viewerId
    const isBeta = betaRows.some(b => b.authorId === p.ownerId && (b.projectId === null || b.projectId === p.id))
    const ownGrants = grantRows.filter(g =>
      g.projectId === p.id || (g.projectId === null && g.authorId === p.ownerId))
    // Private gate matches canViewProject: any active, unexpired grant admits.
    const hasAnyGrant = ownGrants.length > 0
    // Project-wide grant: opens every chapter.
    const hasWideGrant = ownGrants.some(g => g.chapterId === null)
    const grantedChapterIds = ownGrants.flatMap(g => (g.chapterId ? [g.chapterId] : []))
    const privileged = isOwner || isBeta || hasWideGrant
    const earlyDays = subByAuthor.get(p.ownerId) ?? null

    let status: ProjectAccessStatus = 'ok'
    if ((p.projectVisibility ?? 'public') === 'private' && !(isOwner || isBeta || hasAnyGrant)) {
      status = 'beta_only'
    } else if (p.defaultVisibility === 'subscribers_only' && !privileged && earlyDays === null) {
      status = accepting.has(p.ownerId) ? 'subscribers_only' : 'hidden'
    }
    const grantOnly = (p.projectVisibility ?? 'public') === 'private' && !isOwner && !isBeta && !hasWideGrant
    out.set(p.id, {
      status,
      privileged,
      subscriberEarlyAccessDays: earlyDays,
      grantOnly,
      grantedChapterIds,
      acceptsSubscriptions: accepting.has(p.ownerId),
      tiers: tiersByAuthor.get(p.ownerId) ?? [],
    })
  }
  return out
}
