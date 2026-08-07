/**
 * Revision thinning job.
 *
 * The passes are raw SQL, so typecheck proves nothing about them — these tests
 * are the only thing standing between a typo in a window function and a job
 * that silently deletes the wrong rows (or none at all).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { entities, entityRevisions, siteMemberships } from '../../db/schema'
import { processRevisionThinning } from '../../jobs/revision-thinning'
import {
  createTestApp,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../test-helpers'

const DAY = 24 * 60 * 60 * 1000

describe('Revision thinning', () => {
  let app: any
  let userId: string
  let projectId: string
  let chapterId: string

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await cleanupAllTestData()
    const user = await createTestUser({ name: 'Thinning Tester' })
    userId = user.id
    const project = await createTestProject(userId, { name: 'Thinning Project' })
    projectId = project.id

    const [chapter] = await db.insert(entities).values({
      projectId, bobbinId: 'manuscript', collectionName: 'content', contentType: 'chapter',
      entityData: { title: 'Chapter', body: '<p>Words.</p>', word_count: 1 },
    }).returning()
    chapterId = chapter!.id
  })

  /** Seed a revision at a given age. */
  async function seed(opts: {
    daysAgo: number
    label?: string | null
    hash?: string
    bucketSuffix?: number
  }) {
    // Offset by the suffix so same-day rows land in *different* session
    // buckets — the unique index would (correctly) reject two rows sharing one.
    const at = new Date(Date.now() - opts.daysAgo * DAY + (opts.bucketSuffix ?? 0) * 20 * 60 * 1000)
    const label = opts.label ?? null
    const [row] = await db.insert(entityRevisions).values({
      projectId,
      entityId: chapterId,
      collection: 'content',
      contentType: 'chapter',
      snapshot: { body: `<p>v${opts.daysAgo}-${opts.bucketSuffix ?? 0}</p>` },
      contentHash: opts.hash ?? `hash-${opts.daysAgo}-${opts.bucketSuffix ?? 0}`,
      wordCount: 1,
      entityVersion: 1,
      entityVersionEnd: 2,
      label,
      actorKey: `user:${userId}`,
      // Labeled rows must have a null bucket (schema CHECK enforces the pairing).
      sessionBucket: label === null ? new Date(at.getTime() - (at.getTime() % 900_000)) : null,
      sessionStartedAt: at,
      capturedAt: at,
    }).returning()
    return row!
  }

  const remaining = () => db.select().from(entityRevisions).where(eq(entityRevisions.entityId, chapterId))

  async function makeSupporter(overrides: Partial<typeof siteMemberships.$inferInsert> = {}) {
    await db.insert(siteMemberships).values({
      userId,
      tier: 'supporter',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * DAY),
      ...overrides,
    })
  }

  it('keeps everything inside the 30-day window for a free user', async () => {
    for (let d = 0; d < 5; d++) await seed({ daysAgo: d, bucketSuffix: d })
    await processRevisionThinning({ force: true })
    expect(await remaining()).toHaveLength(5)
  })

  it('drops a free user\'s unlabeled rows past the window', async () => {
    await seed({ daysAgo: 1, bucketSuffix: 1 })
    await seed({ daysAgo: 45, bucketSuffix: 2 })
    await seed({ daysAgo: 60, bucketSuffix: 3 })

    await processRevisionThinning({ force: true })

    const rows = await remaining()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sessionStartedAt.getTime()).toBeGreaterThan(Date.now() - 2 * DAY)
  })

  it('never drops labeled checkpoints, however old', async () => {
    await seed({ daysAgo: 400, label: 'publish' })
    await seed({ daysAgo: 400, label: 'manual' })
    await seed({ daysAgo: 400, bucketSuffix: 9 })

    await processRevisionThinning({ force: true })

    const rows = await remaining()
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.label).sort()).toEqual(['manual', 'publish'])
  })

  it('keeps newest-per-day for a supporter', async () => {
    await makeSupporter()
    // Three rows on the same day, well past the keep-all window.
    for (let i = 0; i < 3; i++) await seed({ daysAgo: 45, bucketSuffix: i })
    // ...and one on a different day.
    await seed({ daysAgo: 46, bucketSuffix: 9 })

    await processRevisionThinning({ force: true })

    const rows = await remaining()
    expect(rows).toHaveLength(2)
  })

  it('gives a lapsed supporter a grace period before free-tier thinning', async () => {
    // Expired five days ago — inside the 30-day grace, so history stays deep.
    await makeSupporter({ status: 'canceled', currentPeriodEnd: new Date(Date.now() - 5 * DAY) })
    await seed({ daysAgo: 45, bucketSuffix: 1 })
    await seed({ daysAgo: 46, bucketSuffix: 2 })

    await processRevisionThinning({ force: true })
    expect(await remaining()).toHaveLength(2)
  })

  it('thins to free depth once the grace period has passed', async () => {
    await makeSupporter({ status: 'canceled', currentPeriodEnd: new Date(Date.now() - 90 * DAY) })
    await seed({ daysAgo: 45, bucketSuffix: 1 })
    await seed({ daysAgo: 46, bucketSuffix: 2 })

    await processRevisionThinning({ force: true })
    expect(await remaining()).toHaveLength(0)
  })

  it('treats an admin-granted membership (null period end) as an active supporter', async () => {
    await makeSupporter({ currentPeriodEnd: null })
    for (let i = 0; i < 3; i++) await seed({ daysAgo: 45, bucketSuffix: i })
    await processRevisionThinning({ force: true })
    // Supporter rules: one survives the day bucket, rather than all being dropped.
    expect(await remaining()).toHaveLength(1)
  })

  it('collapses adjacent duplicates', async () => {
    await seed({ daysAgo: 1, hash: 'same', bucketSuffix: 1 })
    await seed({ daysAgo: 0.5, hash: 'same', bucketSuffix: 2 })
    await seed({ daysAgo: 0.2, hash: 'different', bucketSuffix: 3 })

    await processRevisionThinning({ force: true })

    const rows = await remaining()
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.contentHash).sort()).toEqual(['different', 'same'])
  })

  it('claims the day so a second machine does no work', async () => {
    await seed({ daysAgo: 45, bucketSuffix: 1 })

    // First unforced call claims and runs.
    await processRevisionThinning()
    expect(await remaining()).toHaveLength(0)

    await seed({ daysAgo: 46, bucketSuffix: 2 })
    // Second call the same day must find the claim taken and do nothing.
    await processRevisionThinning()
    expect(await remaining()).toHaveLength(1)
  })
})
