/**
 * Public reader URL slugs for entities (chapters + codex entities).
 *
 * Wiki-style model: an entity's slug follows its title/name. Renaming a
 * published entity claims a new current slug and demotes the old one to an
 * alias (is_current = false) so old links 301 to the current URL. Authors
 * can pin a slug manually, which rename no longer moves. UUIDs always keep
 * resolving as a fallback.
 *
 * Namespace: per-project across ALL entities (chapters and codex entities
 * share the entity_slugs table). Chapter slugs occupy the
 * /read/:author/:project/<slug> path segment, so literal route segments are
 * reserved words.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/connection'
import { entitySlugs, projectCollectionMemberships } from '../db/schema'

/** Literal path segments under /read/:author/:project/ (plus insurance). */
export const RESERVED_PROJECT_CHILD_SLUGS = new Set([
  'entity', 'entities', 'collection', 'collections', 'chapters', 'toc',
  'codex', 'about', 'feed', 'feed.xml', 'sitemap.xml', 'opengraph-image',
  // static sibling of the /entities/:entityId API route
  'published-names'
])

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,148}[a-z0-9])?$/

const MAX_SLUG_LENGTH = 150

/** Turn a title/name into a URL slug. Falls back to `untitled` when the
 * input has no ascii-representable characters. */
export function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')
  return base || 'untitled'
}

function isUsableSlug(slug: string): boolean {
  return !RESERVED_PROJECT_CHILD_SLUGS.has(slug) && !UUID_RE.test(slug)
}

type SlugRow = typeof entitySlugs.$inferSelect

async function getCurrentRow(projectId: string, entityId: string): Promise<SlugRow | undefined> {
  const [row] = await db
    .select()
    .from(entitySlugs)
    .where(and(
      eq(entitySlugs.projectId, projectId),
      eq(entitySlugs.entityId, entityId),
      eq(entitySlugs.isCurrent, true)
    ))
    .limit(1)
  return row
}

/**
 * Claim `candidate` (or the first available suffixed variant) for an entity
 * and make it the entity's current slug. Handles the whole claim policy:
 * - reserved words and UUID-shaped candidates are skipped
 * - the entity's own alias row is promoted back to current
 * - another entity's ALIAS row is displaced (deleted) — wiki-redirect overwrite
 * - another entity's CURRENT row is never displaced → try `-2`, `-3`, …
 * The entity's previous current row (if any) is demoted to an alias.
 * Runs in a transaction; unique indexes + retry make races safe.
 */
async function claimSlug(
  projectId: string,
  entityId: string,
  base: string,
  opts: { pin?: boolean, exact?: boolean } = {}
): Promise<{ slug: string } | { error: 'taken' | 'reserved' }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let i = 1
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const candidate = i === 1 ? base : `${trimForSuffix(base, i)}-${i}`
      if (!isUsableSlug(candidate)) {
        if (opts.exact) return { error: 'reserved' }
        i++
        continue
      }

      const [existing] = await db
        .select()
        .from(entitySlugs)
        .where(and(
          eq(entitySlugs.projectId, projectId),
          eq(entitySlugs.slug, candidate)
        ))
        .limit(1)

      if (existing && existing.entityId !== entityId && existing.isCurrent) {
        if (opts.exact) return { error: 'taken' }
        i++
        continue
      }

      const claimed = await db.transaction(async (tx) => {
        if (existing && existing.entityId !== entityId && !existing.isCurrent) {
          // Displace another entity's alias (wiki-redirect overwrite).
          await tx.delete(entitySlugs).where(eq(entitySlugs.id, existing.id))
        }

        // Demote this entity's current slug in this project (a user-scoped
        // entity may hold current slugs in other projects' namespaces too).
        // Pinning is a property of the current slug — aliases drop it.
        await tx
          .update(entitySlugs)
          .set({ isCurrent: false, isPinned: false, updatedAt: new Date() })
          .where(and(
            eq(entitySlugs.projectId, projectId),
            eq(entitySlugs.entityId, entityId),
            eq(entitySlugs.isCurrent, true)
          ))

        if (existing && existing.entityId === entityId) {
          // Promote the entity's own row (current-again after demote, or an
          // old alias being reclaimed).
          await tx
            .update(entitySlugs)
            .set({ isCurrent: true, isPinned: opts.pin ?? existing.isPinned, updatedAt: new Date() })
            .where(eq(entitySlugs.id, existing.id))
          return true
        }

        const inserted = await tx
          .insert(entitySlugs)
          .values({
            projectId,
            entityId,
            slug: candidate,
            isCurrent: true,
            isPinned: opts.pin ?? false
          })
          .onConflictDoNothing()
          .returning({ id: entitySlugs.id })
        if (inserted.length === 0) {
          // Lost a race for this slug — roll back the demote and retry.
          throw new SlugRaceError()
        }
        return true
      }).catch((err) => {
        if (err instanceof SlugRaceError) return false
        throw err
      })

      if (claimed) return { slug: candidate }
      if (opts.exact) return { error: 'taken' }
      break // re-scan from the outer retry loop
    }
  }
  // Pathological contention — give up with a random suffix.
  const fallback = `${trimForSuffix(base, 8)}-${crypto.randomUUID().slice(0, 8)}`
  await db.insert(entitySlugs).values({
    projectId,
    entityId,
    slug: fallback,
    isCurrent: true,
    isPinned: opts.pin ?? false
  }).onConflictDoNothing()
  return { slug: fallback }
}

class SlugRaceError extends Error {}

/** Keep `base-N` within the length budget. */
function trimForSuffix(base: string, n: number): string {
  const suffixLen = String(n).length + 1
  return base.slice(0, MAX_SLUG_LENGTH - suffixLen).replace(/-+$/g, '')
}

/**
 * Make sure a published entity has a current slug; returns it. No-op when
 * one already exists (renames go through renameSlug instead).
 */
export async function ensureCurrentSlug(
  projectId: string,
  entityId: string,
  name: string | null | undefined
): Promise<string | null> {
  const current = await getCurrentRow(projectId, entityId)
  if (current) return current.slug
  const result = await claimSlug(projectId, entityId, slugifyName(name ?? ''))
  return 'slug' in result ? result.slug : null
}

/**
 * Move a published entity's slug after a rename. The old current slug
 * becomes an alias. Pinned slugs don't move. Reclaims the entity's own old
 * alias when the rename returns to a previous title.
 */
export async function renameSlug(
  projectId: string,
  entityId: string,
  newName: string | null | undefined
): Promise<string | null> {
  const current = await getCurrentRow(projectId, entityId)
  if (!current) return ensureCurrentSlug(projectId, entityId, newName)
  if (current.isPinned) return current.slug

  const base = slugifyName(newName ?? '')
  if (current.slug === base) return current.slug

  const result = await claimSlug(projectId, entityId, base)
  return 'slug' in result ? result.slug : current.slug
}

/**
 * Author-requested slug override. Exact match only — no auto-suffixing.
 * Pinned by default so later renames don't move it.
 */
export async function claimSlugManually(
  projectId: string,
  entityId: string,
  requestedSlug: string,
  pin = true
): Promise<{ slug: string } | { error: 'invalid' | 'taken' | 'reserved' }> {
  const slug = requestedSlug.trim().toLowerCase()
  if (!SLUG_RE.test(slug)) return { error: 'invalid' }
  if (!isUsableSlug(slug)) return { error: 'reserved' }
  return claimSlug(projectId, entityId, slug, { pin, exact: true })
}

/** Unpin an entity's current slug so renames move it again. */
export async function unpinSlug(projectId: string, entityId: string): Promise<void> {
  await db
    .update(entitySlugs)
    .set({ isPinned: false, updatedAt: new Date() })
    .where(and(
      eq(entitySlugs.projectId, projectId),
      eq(entitySlugs.entityId, entityId),
      eq(entitySlugs.isCurrent, true)
    ))
}

export interface ResolvedSlug {
  entityId: string
  /** The entity's current slug, or null if it has none. */
  currentSlug: string | null
  /** True when the requested param IS the current slug (no redirect needed). */
  requestedIsCurrent: boolean
}

/**
 * Resolve a URL param that may be a slug, an alias, or a raw UUID.
 * Returns null only for unknown slugs — UUID params resolve unconditionally
 * (existence is the caller's query to make).
 */
export async function resolveSlug(projectId: string, slugOrId: string): Promise<ResolvedSlug | null> {
  if (UUID_RE.test(slugOrId)) {
    const [row] = await db
      .select({ slug: entitySlugs.slug })
      .from(entitySlugs)
      .where(and(
        eq(entitySlugs.projectId, projectId),
        eq(entitySlugs.entityId, slugOrId),
        eq(entitySlugs.isCurrent, true)
      ))
      .limit(1)
    return { entityId: slugOrId, currentSlug: row?.slug ?? null, requestedIsCurrent: false }
  }

  const [row] = await db
    .select()
    .from(entitySlugs)
    .where(and(
      eq(entitySlugs.projectId, projectId),
      eq(entitySlugs.slug, slugOrId)
    ))
    .limit(1)
  if (!row) return null
  if (row.isCurrent) {
    return { entityId: row.entityId, currentSlug: row.slug, requestedIsCurrent: true }
  }
  const current = await getCurrentRow(projectId, row.entityId)
  return { entityId: row.entityId, currentSlug: current?.slug ?? null, requestedIsCurrent: false }
}

/** Batch: current slugs for a set of entity ids (TOC, prev/next, lists). */
export async function getSlugsForEntities(
  projectId: string,
  entityIds: string[]
): Promise<Map<string, string>> {
  if (entityIds.length === 0) return new Map()
  const rows = await db
    .select({ entityId: entitySlugs.entityId, slug: entitySlugs.slug })
    .from(entitySlugs)
    .where(and(
      eq(entitySlugs.projectId, projectId),
      inArray(entitySlugs.entityId, entityIds),
      eq(entitySlugs.isCurrent, true)
    ))
  return new Map(rows.map((r) => [r.entityId, r.slug]))
}

/**
 * Projects whose reader namespace an entity's slug should live in.
 * Project-scoped entities → their own project; collection-scoped entities
 * are visible in every member project of the collection. User/global-scoped
 * entities return [] (rare — they resolve by UUID until published again).
 */
export async function resolveSlugProjects(entity: {
  projectId: string | null
  collectionId: string | null
}): Promise<string[]> {
  if (entity.projectId) return [entity.projectId]
  if (entity.collectionId) {
    const rows = await db
      .select({ projectId: projectCollectionMemberships.projectId })
      .from(projectCollectionMemberships)
      .where(eq(projectCollectionMemberships.collectionId, entity.collectionId))
    return rows.map((r) => r.projectId)
  }
  return []
}

/** All alias slugs (non-current) for an entity — for the settings UI. */
export async function getSlugAliases(projectId: string, entityId: string): Promise<string[]> {
  const rows = await db
    .select({ slug: entitySlugs.slug })
    .from(entitySlugs)
    .where(and(
      eq(entitySlugs.projectId, projectId),
      eq(entitySlugs.entityId, entityId),
      eq(entitySlugs.isCurrent, false)
    ))
  return rows.map((r) => r.slug)
}
