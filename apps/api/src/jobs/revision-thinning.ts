/**
 * Revision Thinning Job
 *
 * Every save inside a 15-minute window collapses onto one revision row, but an
 * actively-written novel still accumulates thousands of rows a year, each
 * holding a full chapter body. This job trims them to the retention policy.
 *
 * Runs daily rather than hourly: it is a heavy scan, and nothing about it is
 * time-sensitive. It claims the day through `cron_runs` because
 * startTriggerScheduler runs in-process on every API machine, so an unguarded
 * job would run once per machine.
 *
 * Four passes, in order:
 *   0. collapse adjacent duplicates (both tiers)
 *   1. free tier: drop unlabeled rows past the keep-all window
 *   2. supporter: keep newest-per-day to a year, newest-per-week beyond
 *   3. per-entity caps
 *
 * Every pass is batched. `statement_timeout` is 30s (db/connection.ts) and the
 * first production run can touch hundreds of thousands of rows; an unbatched
 * DELETE would abort partway and retry the same doomed statement every night.
 */

import { sql } from 'drizzle-orm'
import { db } from '../db/connection'
import { cronRuns } from '../db/schema'
import {
  FREE_REVISION_CAP,
  LABELED_REVISION_CAP,
  REVISION_DOWNGRADE_GRACE_DAYS,
  REVISION_KEEP_ALL_DAYS,
  SUPPORTER_REVISION_CAP,
  SUPPORTER_REVISION_DAILY_DAYS,
} from '../lib/membership'

const JOB_NAME = 'revision-thinning'

/** Rows deleted per statement. */
const BATCH_SIZE = 2_000

/** Ceiling per pass per run, so a backlog drains over several nights instead of
 *  monopolizing one. */
const MAX_PER_PASS = 50_000

/**
 * Resolve each entity's owner tier in SQL.
 *
 * Mirrors getUserMembershipTier's three edge cases exactly: no membership row
 * means free, a non-active status means free, and a null current_period_end
 * means admin-granted and never expiring.
 *
 * The LEFT JOIN chain matters — entities.project_id is nullable, so a plain
 * `JOIN projects` would silently exempt every user- and collection-scoped
 * entity from thinning and let those grow forever.
 *
 * The grace period keeps a lapsed supporter's history at supporter depth for a
 * further 30 days rather than destroying a year of restore points the night
 * their card fails.
 */
const POLICY_CTE = sql`
  policy AS (
    SELECT
      e.id AS entity_id,
      (
        sm.user_id IS NOT NULL
        AND sm.tier = 'supporter'
        AND (
          (sm.status = 'active' AND (sm.current_period_end IS NULL OR sm.current_period_end > now()))
          OR (sm.current_period_end IS NOT NULL
              AND sm.current_period_end > now() - make_interval(days => ${REVISION_DOWNGRADE_GRACE_DAYS}::int))
        )
      ) AS is_supporter
    FROM entities e
    LEFT JOIN projects p ON p.id = e.project_id
    LEFT JOIN project_collections pc ON pc.id = e.collection_id
    LEFT JOIN site_memberships sm ON sm.user_id = coalesce(p.owner_id, pc.user_id, e.user_id)
  )
`

/** Run one batched DELETE repeatedly until it stops finding work. */
async function runPass(name: string, statement: () => Promise<number>): Promise<number> {
  let total = 0
  while (total < MAX_PER_PASS) {
    const removed = await statement()
    total += removed
    if (removed < BATCH_SIZE) break
  }
  if (total >= MAX_PER_PASS) {
    console.log(`[revision-thinning] ${name} hit the ${MAX_PER_PASS} cap; remainder next run`)
  }
  return total
}

async function deleteCount(query: ReturnType<typeof sql>): Promise<number> {
  const rows = await db.execute(query)
  return (rows as unknown as unknown[]).length
}

/**
 * Pass 0 — collapse consecutive revisions with identical restorable content.
 *
 * A save that only reordered a chapter, or an editor that round-tripped the
 * same HTML, leaves a restore point identical to its predecessor. Restricted to
 * recent rows so this stays incremental.
 */
function collapseDuplicates() {
  return deleteCount(sql`
    WITH recent AS (
      SELECT id, content_hash, label, is_pinned,
             lag(content_hash) OVER (PARTITION BY entity_id ORDER BY session_started_at, id) AS prev_hash
      FROM entity_revisions
      WHERE session_started_at > now() - interval '2 days'
    ),
    doomed AS (
      SELECT id FROM recent
      WHERE label IS NULL AND is_pinned = false
        AND content_hash IS NOT DISTINCT FROM prev_hash
      LIMIT ${BATCH_SIZE}::int
    )
    DELETE FROM entity_revisions r USING doomed d WHERE d.id = r.id RETURNING r.id
  `)
}

/** Pass 1 — free tier keeps only labeled checkpoints past the keep-all window. */
function thinFreeTier() {
  return deleteCount(sql`
    WITH ${POLICY_CTE},
    doomed AS (
      SELECT r.id
      FROM entity_revisions r
      JOIN policy p ON p.entity_id = r.entity_id
      WHERE NOT p.is_supporter
        AND r.label IS NULL
        AND r.is_pinned = false
        AND r.session_started_at < now() - make_interval(days => ${REVISION_KEEP_ALL_DAYS}::int)
      LIMIT ${BATCH_SIZE}::int
    )
    DELETE FROM entity_revisions r USING doomed d WHERE d.id = r.id RETURNING r.id
  `)
}

/**
 * Pass 2 — supporters keep the newest revision per day out to a year, then the
 * newest per week. One statement; the bucket expression switches on age.
 */
function thinSupporterTier() {
  return deleteCount(sql`
    WITH ${POLICY_CTE},
    candidates AS (
      SELECT r.id, r.entity_id, r.session_started_at,
             CASE WHEN r.session_started_at >= now() - make_interval(days => ${SUPPORTER_REVISION_DAILY_DAYS}::int)
                  THEN date_trunc('day', r.session_started_at)
                  ELSE date_trunc('week', r.session_started_at)
             END AS bucket
      FROM entity_revisions r
      JOIN policy p ON p.entity_id = r.entity_id AND p.is_supporter
      WHERE r.label IS NULL
        AND r.is_pinned = false
        AND r.session_started_at < now() - make_interval(days => ${REVISION_KEEP_ALL_DAYS}::int)
    ),
    ranked AS (
      SELECT id, row_number() OVER (
               PARTITION BY entity_id, bucket
               ORDER BY session_started_at DESC, id DESC
             ) AS rn
      FROM candidates
    ),
    doomed AS (SELECT id FROM ranked WHERE rn > 1 LIMIT ${BATCH_SIZE}::int)
    DELETE FROM entity_revisions r USING doomed d WHERE d.id = r.id RETURNING r.id
  `)
}

/**
 * Pass 3 — per-entity caps.
 *
 * Unlabeled and labeled rows are capped separately. Counting them together
 * would let a burst of publishes evict genuine autosave restore points; capping
 * only unlabeled rows would let a scripted publish loop grow an entity's
 * history without bound, since labeled rows are never thinned by age.
 */
function capUnlabeled() {
  return deleteCount(sql`
    WITH ${POLICY_CTE},
    ranked AS (
      SELECT r.id,
             row_number() OVER (PARTITION BY r.entity_id
                                ORDER BY r.session_started_at DESC, r.id DESC) AS rn,
             CASE WHEN p.is_supporter THEN ${SUPPORTER_REVISION_CAP}::int ELSE ${FREE_REVISION_CAP}::int END AS cap
      FROM entity_revisions r
      JOIN policy p ON p.entity_id = r.entity_id
      WHERE r.label IS NULL AND r.is_pinned = false
    ),
    doomed AS (SELECT id FROM ranked WHERE rn > cap LIMIT ${BATCH_SIZE}::int)
    DELETE FROM entity_revisions r USING doomed d WHERE d.id = r.id RETURNING r.id
  `)
}

function capLabeled() {
  return deleteCount(sql`
    WITH ranked AS (
      SELECT id,
             row_number() OVER (PARTITION BY entity_id
                                ORDER BY session_started_at DESC, id DESC) AS rn
      FROM entity_revisions
      WHERE label IS NOT NULL AND is_pinned = false
    ),
    doomed AS (SELECT id FROM ranked WHERE rn > ${LABELED_REVISION_CAP}::int LIMIT ${BATCH_SIZE}::int)
    DELETE FROM entity_revisions r USING doomed d WHERE d.id = r.id RETURNING r.id
  `)
}

/** Claim today's run so only one machine does the work. */
async function claimRun(now: Date): Promise<boolean> {
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const claimed = await db
    .insert(cronRuns)
    .values({
      jobName: JOB_NAME,
      lastRunAt: now,
      lastStatus: 'success',
      lastError: null,
      forced: false,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: cronRuns.jobName,
      set: { lastRunAt: now, lastStatus: 'success', lastError: null, updatedAt: now },
      setWhere: sql`${cronRuns.lastRunAt} < ${startOfDay.toISOString()}`,
    })
    .returning({ jobName: cronRuns.jobName })
  return claimed.length > 0
}

export async function processRevisionThinning(options?: { force?: boolean }): Promise<void> {
  try {
    if (!options?.force && !(await claimRun(new Date()))) return

    const duplicates = await runPass('duplicates', collapseDuplicates)
    const free = await runPass('free-tier', thinFreeTier)
    const supporter = await runPass('supporter-tier', thinSupporterTier)
    const capped = await runPass('caps', capUnlabeled)
    const cappedLabeled = await runPass('labeled-caps', capLabeled)

    const total = duplicates + free + supporter + capped + cappedLabeled
    if (total > 0) {
      console.log(
        `[revision-thinning] Removed ${total} revisions ` +
        `(duplicates ${duplicates}, free ${free}, supporter ${supporter}, ` +
        `caps ${capped}, labeled caps ${cappedLabeled})`
      )
    }
  } catch (err) {
    console.error('[revision-thinning] Failed:', err)
  }
}
