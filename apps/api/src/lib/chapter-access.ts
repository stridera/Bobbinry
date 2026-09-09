/**
 * Chapter access resolution for the public reader.
 *
 * One implementation of the beta-reader / access-grant / owner / subscription /
 * embargo rules. `checkChaptersAccess` is the batch form (3–4 queries for any
 * number of chapters); `checkChapterAccess` is a batch of one. Routes must not
 * re-implement these rules inline — three copies had already drifted apart on
 * grant expiry, author-wide beta grants and the owner shortcut.
 */
import { db } from '../db/connection'
import {
  chapterPublications,
  betaReaders,
  accessGrants,
  projects,
  subscriptions,
  subscriptionTiers,
} from '../db/schema'
import { eq, and, or, isNull, inArray, sql, desc } from 'drizzle-orm'

/**
 * Owner preview ("view as"): substitutes a simulated audience for the real
 * lookups. Only ever downgrades — non-owners cannot invoke it.
 */
export type ViewSimulation =
  | { kind: 'beta' }
  // Chapter embargo reads earlyAccessDays; the codex gates on tier level.
  | { kind: 'tier'; earlyAccessDays: number; tierLevel: number }

export interface AccessCheckResult {
  canAccess: boolean
  reason?: string
  embargoUntil?: Date
}

export interface ChapterAccessInput {
  chapterId: string
  publishedAt: Date | null
  publicReleaseDate: Date | null
}

const DAY_MS = 24 * 60 * 60 * 1000

export interface ActiveSubscription {
  tierLevel: number
  earlyAccessDays: number | null
}

/**
 * The one definition of "active subscriber": the caller's highest-tier
 * subscription to an author that is `active` and inside its paid period.
 * Chapter access, codex tier gating and annotation permissions all use this,
 * so a change to the lifecycle rule (grace periods, trialing, past_due) lands
 * everywhere at once.
 */
export async function findActiveSubscription(subscriberId: string, authorId: string): Promise<ActiveSubscription | null> {
  const [sub] = await db
    .select({ tierLevel: subscriptionTiers.tierLevel, earlyAccessDays: subscriptionTiers.earlyAccessDays })
    .from(subscriptions)
    .innerJoin(subscriptionTiers, eq(subscriptionTiers.id, subscriptions.tierId))
    .where(and(
      eq(subscriptions.subscriberId, subscriberId),
      eq(subscriptions.authorId, authorId),
      eq(subscriptions.status, 'active'),
      sql`${subscriptions.currentPeriodEnd} > NOW()`,
    ))
    .orderBy(desc(subscriptionTiers.tierLevel))
    .limit(1)
  return sub ?? null
}

/** Subscriber early-access window relative to the public publish date. */
function tierAccess(publishedAt: Date | null, earlyAccessDays: number | null, now: Date): AccessCheckResult {
  if (!publishedAt) return { canAccess: true } // published with no date: allow
  const accessDate = new Date(publishedAt.getTime() - (earlyAccessDays ?? 0) * DAY_MS)
  if (now >= accessDate) return { canAccess: true }
  return { canAccess: false, reason: 'Chapter not yet available for your tier', embargoUntil: accessDate }
}

/**
 * Resolve access for a set of *published* chapters in one project. Callers are
 * expected to have filtered to `isPublished` rows already (the batch endpoints
 * select from `chapter_publications`); use `checkChapterAccess` when you only
 * hold a chapter id.
 */
export async function checkChaptersAccess(
  chapters: ChapterAccessInput[],
  projectId: string,
  userId: string | undefined,
  defaultVisibility: string | undefined,
  simulate?: ViewSimulation,
): Promise<Map<string, AccessCheckResult>> {
  const results = new Map<string, AccessCheckResult>()
  if (chapters.length === 0) return results

  const now = new Date()
  const allowAll = () => {
    for (const ch of chapters) results.set(ch.chapterId, { canAccess: true })
    return results
  }

  const chapterGrants = new Set<string>()
  let subscription: { earlyAccessDays: number | null } | null = null

  if (simulate) {
    if (simulate.kind === 'beta') return allowAll()
    subscription = { earlyAccessDays: simulate.earlyAccessDays }
  } else if (userId) {
    // Owner: full access. Checked first so the remaining lookups are skipped.
    const [project] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    if (project?.ownerId === userId) return allowAll()

    // Beta reader for this project, or author-wide (NULL project).
    const [betaReader] = await db
      .select({ readerId: betaReaders.readerId })
      .from(betaReaders)
      .where(and(
        or(eq(betaReaders.projectId, projectId), isNull(betaReaders.projectId)),
        eq(betaReaders.readerId, userId),
        eq(betaReaders.isActive, true),
      ))
      .limit(1)
    if (betaReader) return allowAll()

    // Access grants: project-wide (NULL chapter) or per chapter; unexpired only.
    const grants = await db
      .select({ chapterId: accessGrants.chapterId })
      .from(accessGrants)
      .where(and(
        or(eq(accessGrants.projectId, projectId), isNull(accessGrants.projectId)),
        eq(accessGrants.grantedTo, userId),
        eq(accessGrants.isActive, true),
        or(isNull(accessGrants.expiresAt), sql`${accessGrants.expiresAt} > NOW()`),
        or(inArray(accessGrants.chapterId, chapters.map(c => c.chapterId)), isNull(accessGrants.chapterId)),
      ))
    for (const g of grants) {
      if (g.chapterId === null) return allowAll()
      chapterGrants.add(g.chapterId)
    }

    // Active subscription to the project's author.
    if (project) subscription = await findActiveSubscription(userId, project.ownerId)
  }

  for (const ch of chapters) {
    if (chapterGrants.has(ch.chapterId)) {
      results.set(ch.chapterId, { canAccess: true })
    } else if (subscription) {
      results.set(ch.chapterId, tierAccess(ch.publishedAt, subscription.earlyAccessDays, now))
    } else if (defaultVisibility === 'subscribers_only') {
      results.set(ch.chapterId, { canAccess: false, reason: 'Subscription required' })
    } else if (ch.publicReleaseDate && ch.publicReleaseDate > now) {
      results.set(ch.chapterId, { canAccess: false, reason: 'Chapter embargoed', embargoUntil: ch.publicReleaseDate })
    } else {
      results.set(ch.chapterId, { canAccess: true })
    }
  }

  return results
}

/** Access for a single chapter id within a project. */
export async function checkChapterAccess(
  chapterId: string,
  projectId: string,
  userId: string | undefined,
  defaultVisibility: string | undefined,
  simulate?: ViewSimulation,
): Promise<AccessCheckResult> {
  const [pub] = await db
    .select({
      isPublished: chapterPublications.isPublished,
      publishedAt: chapterPublications.publishedAt,
      publicReleaseDate: chapterPublications.publicReleaseDate,
    })
    .from(chapterPublications)
    .where(and(eq(chapterPublications.chapterId, chapterId), eq(chapterPublications.projectId, projectId)))
    .limit(1)

  if (!pub?.isPublished) return { canAccess: false, reason: 'Chapter not published' }

  const results = await checkChaptersAccess(
    [{ chapterId, publishedAt: pub.publishedAt, publicReleaseDate: pub.publicReleaseDate }],
    projectId, userId, defaultVisibility, simulate,
  )
  return results.get(chapterId) ?? { canAccess: false, reason: 'Chapter not published' }
}
