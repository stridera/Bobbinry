/**
 * Helpers shared by the public reader route modules: chapter ordering,
 * author resolution, annotation access, project visibility and owner preview.
 */

import { db } from '../../db/connection'
import { chapterPublications, entities, betaReaders, accessGrants, projects, projectPublishConfig, subscriptionTiers, userProfiles, users } from '../../db/schema'
import { eq, and, asc, sql, isNull, or } from 'drizzle-orm'
import { env } from '../../lib/env'
import { checkChaptersAccess, findActiveSubscription, type ViewSimulation } from '../../lib/chapter-access'
import { UUID_RE } from '../../lib/slugs'

// ============================================
// CHAPTER ORDERING
// ============================================

/** Manuscript order: the `order` field shared with the write-side editor. */
export const manuscriptOrderSql = sql`COALESCE((${entities.entityData}->>'order')::bigint, 0)`

/**
 * Build the ORDER BY clauses for published chapters for a given project.
 *
 * Reader order follows manuscript order by default. When an author turns off
 * "Use manuscript order" on the publishing page, the reader instead follows the
 * independent `publish_order`, with manuscript order as a stable tiebreak.
 */
export async function getChapterOrderClauses(projectId: string) {
  const [config] = await db
    .select({ useManuscriptOrder: projectPublishConfig.useManuscriptOrder })
    .from(projectPublishConfig)
    .where(eq(projectPublishConfig.projectId, projectId))
    .limit(1)
  // Default to manuscript order when no config row exists yet.
  const useManuscriptOrder = config?.useManuscriptOrder ?? true
  return useManuscriptOrder
    ? [manuscriptOrderSql]
    : [asc(entities.publishOrder), manuscriptOrderSql]
}

// ============================================
// AUTHOR RESOLUTION
// ============================================

export interface ResolvedAuthor {
  userId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  bio: string | null
  userName: string | null
}

/** Resolve a public author by username or user ID (3-step fallback). */
export async function resolveAuthor(identifier: string): Promise<ResolvedAuthor | null> {
  // 1. Try by username
  let [author] = await db
    .select({
      userId: userProfiles.userId,
      username: userProfiles.username,
      displayName: userProfiles.displayName,
      avatarUrl: userProfiles.avatarUrl,
      bio: userProfiles.bio,
      userName: users.name,
    })
    .from(userProfiles)
    .innerJoin(users, eq(users.id, userProfiles.userId))
    .where(eq(userProfiles.username, identifier))
    .limit(1)

  // 2. Try as a user ID. Only for UUID-shaped identifiers: Postgres rejects a
  // plain unknown username as invalid uuid input, which surfaced as a 500 on
  // anonymous traffic instead of the 404 below.
  if (!author && UUID_RE.test(identifier)) {
    [author] = await db
      .select({
        userId: userProfiles.userId,
        username: userProfiles.username,
        displayName: userProfiles.displayName,
        avatarUrl: userProfiles.avatarUrl,
        bio: userProfiles.bio,
        userName: users.name,
      })
      .from(userProfiles)
      .innerJoin(users, eq(users.id, userProfiles.userId))
      .where(eq(userProfiles.userId, identifier))
      .limit(1)
  }

  // 3. Last resort: users table directly (no profile created yet)
  if (!author && UUID_RE.test(identifier)) {
    const [user] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, identifier))
      .limit(1)
    if (user) {
      return { userId: user.id, username: null, displayName: null, avatarUrl: null, bio: null, userName: user.name }
    }
  }

  return author ?? null
}

// ============================================
// ACCESS CONTROL
// ============================================

/**
 * Check whether a user can leave annotations on a project's chapters.
 * Annotations must be enabled via projectPublishConfig (like comments/reactions),
 * then annotationAccess controls who can annotate.
 */
export async function canUserAnnotate(
  userId: string,
  projectId: string
): Promise<boolean> {
  const [config] = await db
    .select({
      enableAnnotations: projectPublishConfig.enableAnnotations,
      annotationAccess: projectPublishConfig.annotationAccess
    })
    .from(projectPublishConfig)
    .where(eq(projectPublishConfig.projectId, projectId))
    .limit(1)

  if (!config || !config.enableAnnotations) return false

  const access = config.annotationAccess ?? 'beta_only'

  if (access === 'all_authenticated') return true

  // Check beta reader status
  const [betaReader] = await db
    .select({ id: betaReaders.id })
    .from(betaReaders)
    .where(and(
      or(eq(betaReaders.projectId, projectId), isNull(betaReaders.projectId)),
      eq(betaReaders.readerId, userId),
      eq(betaReaders.isActive, true)
    ))
    .limit(1)

  if (betaReader) return true

  if (access === 'subscribers') {
    // Check active subscription to the project owner
    const [project] = await db
      .select({ ownerId: projects.ownerId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    if (project && await findActiveSubscription(userId, project.ownerId)) return true
  }

  return false
}

// ============================================
// PROJECT VISIBILITY & AUTHOR PREVIEW
// ============================================

/**
 * Owner-only "view as" preview. `visitor` is handled upstream by dropping the
 * userId; `beta` and `tier` replace the real beta/grant/subscription lookups
 * in the access checks. Only ever downgrades — non-owners can't invoke it.
 */
export interface EffectiveViewer {
  userId?: string | undefined
  simulate?: ViewSimulation
}

/**
 * Resolve the effective viewer for reader endpoints from the session user and
 * an optional ?viewAs= query param (visitor | beta | tier:<tierId>). The param
 * is honored only when the session user owns the project; otherwise it is
 * silently ignored.
 */
export async function resolveViewAs(
  projectId: string,
  userId: string | undefined,
  viewAsRaw: string | undefined
): Promise<EffectiveViewer> {
  if (!viewAsRaw || !userId) return { userId }

  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!project || project.ownerId !== userId) return { userId }

  if (viewAsRaw === 'visitor') return {}
  if (viewAsRaw === 'beta') return { userId, simulate: { kind: 'beta' } }
  if (viewAsRaw.startsWith('tier:')) {
    const tierId = viewAsRaw.slice('tier:'.length)
    if (UUID_RE.test(tierId)) {
      const [tier] = await db
        .select({ earlyAccessDays: subscriptionTiers.earlyAccessDays })
        .from(subscriptionTiers)
        .where(and(
          eq(subscriptionTiers.id, tierId),
          eq(subscriptionTiers.authorId, userId)
        ))
        .limit(1)
      if (tier) {
        return { userId, simulate: { kind: 'tier', earlyAccessDays: tier.earlyAccessDays ?? 0 } }
      }
    }
  }
  return { userId }
}

/**
 * Whether a viewer may see a project at all. Public and unlisted projects are
 * open to everyone (unlisted just isn't discoverable); private projects admit
 * only the owner, active beta readers, and active access grantees.
 */
export async function canViewProject(
  projectId: string,
  userId: string | undefined,
  simulate?: ViewSimulation
): Promise<boolean> {
  const [config] = await db
    .select({ projectVisibility: projectPublishConfig.projectVisibility })
    .from(projectPublishConfig)
    .where(eq(projectPublishConfig.projectId, projectId))
    .limit(1)

  if ((config?.projectVisibility ?? 'public') !== 'private') return true
  if (!userId) return false

  // Owner previewing as another audience: only a beta reader would get in.
  if (simulate) return simulate.kind === 'beta'

  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  if (project?.ownerId === userId) return true

  const [betaReader] = await db
    .select({ id: betaReaders.id })
    .from(betaReaders)
    .where(and(
      or(eq(betaReaders.projectId, projectId), isNull(betaReaders.projectId)),
      eq(betaReaders.readerId, userId),
      eq(betaReaders.isActive, true)
    ))
    .limit(1)
  if (betaReader) return true

  const [grant] = await db
    .select({ id: accessGrants.id })
    .from(accessGrants)
    .where(and(
      or(eq(accessGrants.projectId, projectId), isNull(accessGrants.projectId)),
      eq(accessGrants.grantedTo, userId),
      eq(accessGrants.isActive, true)
    ))
    .limit(1)
  return !!grant
}

export interface ReadableChapter {
  projectId: string
  enableComments: boolean | null
  enableReactions: boolean | null
}

/**
 * Whether the caller may read a public chapter at all: the project must be
 * visible to them and the chapter must pass the full access rules in
 * lib/chapter-access (published, not embargoed, subscribers-only, tier early
 * access). Comment and reaction reads, interaction writes and view tracking
 * all gate on this, so nothing leaks from — or can be pushed onto — a chapter
 * the reader could not open. `projectId`, when given, must match the row.
 */
export async function resolveReadableChapter(
  chapterId: string,
  userId: string | undefined,
  projectId?: string,
): Promise<ReadableChapter | null> {
  const [row] = await db
    .select({
      projectId: chapterPublications.projectId,
      isPublished: chapterPublications.isPublished,
      publishedAt: chapterPublications.publishedAt,
      publicReleaseDate: chapterPublications.publicReleaseDate,
      defaultVisibility: projectPublishConfig.defaultVisibility,
      enableComments: projectPublishConfig.enableComments,
      enableReactions: projectPublishConfig.enableReactions,
    })
    .from(chapterPublications)
    .leftJoin(projectPublishConfig, eq(projectPublishConfig.projectId, chapterPublications.projectId))
    .where(projectId
      ? and(eq(chapterPublications.chapterId, chapterId), eq(chapterPublications.projectId, projectId))
      : eq(chapterPublications.chapterId, chapterId))
    .limit(1)

  if (!row?.isPublished) return null
  if (!(await canViewProject(row.projectId, userId))) return null

  const access = await checkChaptersAccess(
    [{ chapterId, publishedAt: row.publishedAt, publicReleaseDate: row.publicReleaseDate }],
    row.projectId, userId, row.defaultVisibility ?? 'public',
  )
  if (!access.get(chapterId)?.canAccess) return null

  return { projectId: row.projectId, enableComments: row.enableComments, enableReactions: row.enableReactions }
}

/**
 * Gate for reader interactions on a public chapter: the caller must be able
 * to read it, and the author must not have switched the feature off.
 */
export async function checkInteractionAllowed(
  chapterId: string,
  userId: string | undefined,
  feature: 'comments' | 'reactions'
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  const readable = await resolveReadableChapter(chapterId, userId)
  if (!readable) return { ok: false, status: 404, error: 'Chapter not found' }
  const enabled = feature === 'comments' ? readable.enableComments : readable.enableReactions
  if (enabled === false) {
    return { ok: false, status: 403, error: `${feature === 'comments' ? 'Comments' : 'Reactions'} are disabled for this project` }
  }
  return { ok: true }
}

/** Look up the projectId a published chapter belongs to (for chapter-scoped routes). */

export async function getChapterProjectId(chapterId: string): Promise<string | null> {
  const [row] = await db
    .select({ projectId: chapterPublications.projectId })
    .from(chapterPublications)
    .where(eq(chapterPublications.chapterId, chapterId))
    .limit(1)
  return row?.projectId ?? null
}

/**
 * Pretty reader base URL (`<origin>/read/<author>/<shortUrl>`) for a project,
 * or null when the project has no claimed short URL — callers fall back to
 * the legacy /projects/<uuid> form.
 */
export async function getReaderProjectBase(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({
      shortUrl: projects.shortUrl,
      ownerId: projects.ownerId,
      username: userProfiles.username
    })
    .from(projects)
    .leftJoin(userProfiles, eq(userProfiles.userId, projects.ownerId))
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!row?.shortUrl) return null
  return `${env.WEB_ORIGIN}/read/${row.username || row.ownerId}/${row.shortUrl}`
}
