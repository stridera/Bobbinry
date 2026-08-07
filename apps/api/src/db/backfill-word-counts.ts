/**
 * One-off backfill: recompute `entity_data.word_count` for every content entity
 * using the unified tokenizer in lib/text.ts.
 *
 * Why this has to be a single sweep rather than letting counts drift: the old
 * per-route tokenizers double-counted inline-formatted part-words
 * (`<em>in</em>line` = 2) and split entity-escaped contractions (`don&#39;t`
 * = 2). Correcting them shifts numbers slightly. If that happened lazily —
 * chapter by chapter, whenever an author next happened to save — project totals
 * on the dashboard would creep for weeks with no visible cause. One pass, one
 * announced shift.
 *
 * Three deliberate omissions, all load-bearing:
 *  - `version` is NOT bumped. This is not an authored edit and must not 409 an
 *    open editor.
 *  - `updated_at` (row and blob) is NOT touched. Sorting by "recently edited"
 *    must not reshuffle the entire manuscript.
 *  - No `entity_changes` events are recorded. A feed event per chapter would
 *    tell every sync bot that the author rewrote their whole book overnight.
 *
 * Idempotent: rows whose stored count already matches are skipped, so a second
 * run reports 0 updated.
 *
 * Run from apps/api:
 *   DATABASE_URL="postgres://strider@localhost:5432/bobbins_dev" npx tsx src/db/backfill-word-counts.ts
 *   ... --dry-run    report the drift without writing
 */

import { db } from './connection'
import { entities } from './schema'
import { eq, sql } from 'drizzle-orm'
import { countWordsFromHtml } from '../lib/text'

const BATCH_SIZE = 500

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const rows = await db
    .select({
      id: entities.id,
      projectId: entities.projectId,
      entityData: entities.entityData,
    })
    .from(entities)
    // Archived rows included on purpose: they can be unarchived, and a stale
    // count would then surface as unexplained drift months later.
    .where(eq(entities.collectionName, 'content'))

  console.log(`scanning ${rows.length} content entities${dryRun ? ' (dry run)' : ''}`)

  const pending: Array<{ id: string; count: number }> = []
  const perProject = new Map<string, { before: number; after: number }>()
  let unchanged = 0
  let netDelta = 0

  for (const row of rows) {
    const data = (row.entityData ?? {}) as Record<string, unknown>
    const body = typeof data['body'] === 'string' ? (data['body'] as string) : ''
    const next = countWordsFromHtml(body)

    const rawStored = data['word_count']
    const stored = typeof rawStored === 'number'
      ? rawStored
      : rawStored === undefined || rawStored === null
        ? null
        : parseInt(String(rawStored), 10)

    const key = row.projectId ?? '(unscoped)'
    const totals = perProject.get(key) ?? { before: 0, after: 0 }
    totals.before += Number.isFinite(stored) && stored !== null ? stored : 0
    totals.after += next
    perProject.set(key, totals)

    if (stored === next) { unchanged++; continue }
    netDelta += next - (Number.isFinite(stored) && stored !== null ? stored : 0)
    pending.push({ id: row.id, count: next })
  }

  console.log(`  unchanged: ${unchanged}`)
  console.log(`  to update: ${pending.length}  (net ${netDelta >= 0 ? '+' : ''}${netDelta} words)`)

  const drifted = [...perProject.entries()].filter(([, t]) => t.before !== t.after)
  if (drifted.length > 0) {
    console.log('\nper-project totals:')
    for (const [projectId, t] of drifted) {
      const d = t.after - t.before
      console.log(`  ${projectId}  ${t.before} -> ${t.after}  (${d >= 0 ? '+' : ''}${d})`)
    }
  }

  if (dryRun || pending.length === 0) {
    console.log(dryRun ? '\ndry run — nothing written' : '\nnothing to do')
    process.exit(0)
  }

  // jsonb_set on the single key, so a concurrent save that changed some other
  // field is not clobbered by a whole-blob rewrite. No version bump, no
  // updated_at touch — see the header.
  let written = 0
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE)
    await db.transaction(async (tx) => {
      for (const { id, count } of batch) {
        await tx
          .update(entities)
          .set({
            entityData: sql`jsonb_set(${entities.entityData}, '{word_count}', ${JSON.stringify(count)}::jsonb, true)`,
          })
          .where(eq(entities.id, id))
      }
    })
    written += batch.length
    console.log(`  wrote ${written}/${pending.length}`)
  }

  console.log(`\ndone — recomputed ${written} word counts`)
  process.exit(0)
}

main().catch((err) => {
  console.error('backfill failed:', err)
  process.exit(1)
})
