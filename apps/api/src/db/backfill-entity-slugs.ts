/**
 * One-off backfill: give every already-published chapter, codex entity, and
 * collection a reader-URL slug. Idempotent — entities that already have a
 * current slug are skipped (ensureCurrentSlug is a no-op for them).
 *
 * Run from apps/api:
 *   DATABASE_URL="postgres://strider@localhost:5432/bobbins_dev" npx tsx src/db/backfill-entity-slugs.ts
 */

import { db } from './connection'
import { entities, chapterPublications, projectCollections } from './schema'
import { eq, and, isNull, notInArray } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import { ensureCurrentSlug, resolveSlugProjects, slugifyName } from '../lib/slugs'
import { extractTitle } from '../lib/entity-changes'

async function main() {
  // 1) Chapters: every publication row (published or scheduled) gets a slug.
  const chapters = await db
    .select({
      projectId: chapterPublications.projectId,
      chapterId: chapterPublications.chapterId,
      entityData: entities.entityData,
    })
    .from(chapterPublications)
    .innerJoin(entities, eq(entities.id, chapterPublications.chapterId))

  let chapterCount = 0
  for (const ch of chapters) {
    if (!ch.projectId) continue
    const slug = await ensureCurrentSlug(ch.projectId, ch.chapterId, extractTitle(ch.entityData as Record<string, unknown>))
    if (slug) chapterCount++
  }
  console.log(`chapters: ${chapterCount}/${chapters.length} have slugs`)

  // 2) Codex entities: published, non-content, non-type-definition rows.
  //    Project-scoped rows slug into their own project; collection-scoped
  //    rows into every member project (that's where the reader shows them).
  const codexEntities = await db
    .select({
      id: entities.id,
      projectId: entities.projectId,
      collectionId: entities.collectionId,
      entityData: entities.entityData,
    })
    .from(entities)
    .where(and(
      eq(entities.isPublished, true),
      notInArray(entities.collectionName, ['content', 'entity_type_definitions'])
    ))

  let entityCount = 0
  for (const e of codexEntities) {
    const name = extractTitle(e.entityData as Record<string, unknown>)
    const slugProjects = await resolveSlugProjects(e)
    let got = false
    for (const pid of slugProjects) {
      const slug = await ensureCurrentSlug(pid, e.id, name)
      if (slug) got = true
    }
    if (got) entityCount++
  }
  console.log(`codex entities: ${entityCount}/${codexEntities.length} have slugs`)

  // 3) Collections without a claimed short URL get a name-derived one
  //    (globally unique, random suffix on collision — matches collections.ts).
  const bareCollections = await db
    .select({ id: projectCollections.id, name: projectCollections.name })
    .from(projectCollections)
    .where(and(isNull(projectCollections.shortUrl), isNull(projectCollections.deletedAt)))

  let collectionCount = 0
  for (const coll of bareCollections) {
    const base = slugifyName(coll.name)
    let claimed: string | null = null
    for (let i = 1; i <= 5 && !claimed; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`
      const [taken] = await db
        .select({ id: projectCollections.id })
        .from(projectCollections)
        .where(eq(projectCollections.shortUrl, candidate))
        .limit(1)
      if (!taken) claimed = candidate
    }
    if (!claimed) claimed = `${base}-${randomBytes(4).toString('hex')}`
    await db
      .update(projectCollections)
      .set({ shortUrl: claimed, updatedAt: new Date() })
      .where(eq(projectCollections.id, coll.id))
    collectionCount++
  }
  console.log(`collections: assigned short URLs to ${collectionCount} (of ${bareCollections.length} without one)`)

  process.exit(0)
}

main().catch((err) => {
  console.error('backfill failed:', err)
  process.exit(1)
})
