/**
 * Release schedule + unattended job coverage.
 *
 * release-schedule.ts computes when a chapter goes public — its cadence maths
 * run with nobody watching, so a bug there silently mis-schedules chapters.
 * subscription-expiration.ts and tier-dispatch.ts run on a timer with no
 * human in the loop either; assertions here exist to catch silent breakage
 * rather than to document intended behavior for a UI.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import {
  entities,
  projectPublishConfig,
  chapterPublications,
  subscriptions,
  subscriptionTiers,
  siteMemberships,
  embargoSchedules,
  userBobbinsInstalled,
} from '../../db/schema'
import {
  addDays,
  getProjectReleaseSchedule,
  getNextAvailableReleaseSlot,
  getProjectMaxEarlyAccessDays,
  upsertScheduledChapterPublication,
  shiftFollowingScheduledChaptersUp,
  reorderScheduleByEntityOrder,
  shouldAutoPublishAsGapFill,
} from '../../lib/release-schedule'
import { processSubscriptionExpiration } from '../../jobs/subscription-expiration'
import { getStripe } from '../../lib/stripe'
import {
  processEmbargoReleases,
  initTierDispatch,
  registerAutomationHandler,
} from '../../jobs/tier-dispatch'
import { serverEventBus, contentAvailable } from '../../lib/event-bus'
import {
  createTestApp,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../test-helpers'

jest.mock('../../lib/stripe', () => {
  const actual = jest.requireActual('../../lib/stripe')
  return {
    ...actual,
    getStripe: jest.fn(actual.getStripe),
  }
})

const mockGetStripe = getStripe as unknown as jest.Mock
const DAY_MS = 24 * 60 * 60 * 1000

describe('release-schedule + subscription-expiration + tier-dispatch', () => {
  let app: any
  let userId: string
  let projectId: string

  beforeAll(async () => {
    app = await createTestApp()
  })
  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await cleanupAllTestData()
    const user = await createTestUser({ name: 'Release Tester' })
    userId = user.id
    const project = await createTestProject(userId, { name: 'Release Project' })
    projectId = project.id
  })

  // ==========================================================================
  // release-schedule.ts — pure/near-pure cadence maths
  // ==========================================================================

  describe('addDays', () => {
    it('advances the local calendar date by the given number of days', () => {
      // January avoids US DST transitions (which land in March/November),
      // so local-time arithmetic behaves like plain day addition.
      const start = new Date(2026, 0, 10) // local Jan 10 2026
      const result = addDays(start, 5)
      expect(result.getFullYear()).toBe(2026)
      expect(result.getMonth()).toBe(0)
      expect(result.getDate()).toBe(15)
    })

    it('rolls over a month boundary', () => {
      const start = new Date(2026, 0, 30)
      const result = addDays(start, 3)
      expect(result.getMonth()).toBe(1) // February
      expect(result.getDate()).toBe(2)
    })
  })

  async function setPublishConfig(overrides: Partial<typeof projectPublishConfig.$inferInsert> = {}) {
    await db.insert(projectPublishConfig).values({
      projectId,
      autoReleaseEnabled: true,
      releaseFrequency: 'daily',
      releaseTime: '09:00',
      ...overrides,
    })
  }

  async function seedChapter(overrides: Partial<typeof entities.$inferInsert> = {}) {
    const [chapter] = await db.insert(entities).values({
      projectId,
      bobbinId: 'manuscript',
      collectionName: 'content',
      contentType: 'chapter',
      entityData: { title: 'Chapter', body: '<p>Words.</p>' },
      ...overrides,
    }).returning()
    return chapter!
  }

  describe('getProjectReleaseSchedule', () => {
    it('returns null when the project has no publish config row', async () => {
      const schedule = await getProjectReleaseSchedule(projectId)
      expect(schedule).toBeNull()
    })

    it('normalizes multiple release days and defaults a missing release time', async () => {
      await setPublishConfig({ releaseFrequency: 'weekly', releaseDay: 'Mon, Thu, mon', releaseTime: null })
      const schedule = await getProjectReleaseSchedule(projectId)
      expect(schedule).toEqual({
        autoReleaseEnabled: true,
        releaseFrequency: 'weekly',
        releaseDays: [1, 4], // deduped + sorted, Monday=1, Thursday=4
        releaseTime: '12:00', // DEFAULT_RELEASE_TIME
      })
    })
  })

  describe('getNextAvailableReleaseSlot — cadence', () => {
    it('returns null when auto-release is disabled', async () => {
      await setPublishConfig({ autoReleaseEnabled: false })
      const slot = await getNextAvailableReleaseSlot(projectId)
      expect(slot).toBeNull()
    })

    it('returns null when frequency is manual', async () => {
      await setPublishConfig({ releaseFrequency: 'manual' })
      const slot = await getNextAvailableReleaseSlot(projectId)
      expect(slot).toBeNull()
    })

    it('daily: after release time today, next slot is tomorrow at the release time', async () => {
      await setPublishConfig({ releaseFrequency: 'daily', releaseTime: '09:00' })
      const after = new Date('2026-01-05T10:00:00.000Z') // past 9am UTC
      const slot = await getNextAvailableReleaseSlot(projectId, { after })
      expect(slot!.toISOString()).toBe('2026-01-06T09:00:00.000Z')
    })

    it('daily: before release time today, next slot is later today', async () => {
      await setPublishConfig({ releaseFrequency: 'daily', releaseTime: '09:00' })
      const after = new Date('2026-01-05T02:00:00.000Z') // before 9am UTC
      const slot = await getNextAvailableReleaseSlot(projectId, { after })
      expect(slot!.toISOString()).toBe('2026-01-05T09:00:00.000Z')
    })

    it('weekly with multiple release days picks the nearest upcoming day', async () => {
      // 2026-01-05 is a Monday (UTC). Release days Wed(3) + Fri(5); nearest
      // upcoming from a Monday morning "after" is Wednesday.
      await setPublishConfig({ releaseFrequency: 'weekly', releaseDay: 'wed,fri', releaseTime: '09:00' })
      const after = new Date('2026-01-05T00:00:00.000Z') // Monday
      const slot = await getNextAvailableReleaseSlot(projectId, { after })
      expect(slot!.toISOString()).toBe('2026-01-07T09:00:00.000Z') // Wednesday
      expect(slot!.getUTCDay()).toBe(3)
    })

    it('weekly: consecutive slots land exactly 7 days apart', async () => {
      await setPublishConfig({ releaseFrequency: 'weekly', releaseDay: 'mon', releaseTime: '09:00' })
      const after = new Date('2026-01-01T00:00:00.000Z')
      const first = await getNextAvailableReleaseSlot(projectId, { after })
      const second = await getNextAvailableReleaseSlot(projectId, { after: new Date(first!.getTime() + 1) })
      expect(second!.getTime() - first!.getTime()).toBe(7 * DAY_MS)
    })

    it('biweekly: consecutive slots land exactly 14 days apart, not 7', async () => {
      await setPublishConfig({ releaseFrequency: 'biweekly', releaseDay: 'mon', releaseTime: '09:00' })
      const after = new Date('2026-01-01T00:00:00.000Z')
      const first = await getNextAvailableReleaseSlot(projectId, { after })
      expect(first!.getUTCDay()).toBe(1) // still a Monday
      const second = await getNextAvailableReleaseSlot(projectId, { after: new Date(first!.getTime() + 1) })
      expect(second!.getTime() - first!.getTime()).toBe(14 * DAY_MS)
    })

    it('biweekly: every selected day of an "on" week fires, then a whole week is skipped', async () => {
      // The week index used to be anchored to the Unix epoch, a Thursday, so
      // the boundary cut the middle of the author's week: Mon and Fri landed
      // in opposite parities and the schedule released once a week,
      // alternating the day, instead of twice every other week.
      await setPublishConfig({ releaseFrequency: 'biweekly', releaseDay: 'mon,fri', releaseTime: '09:00' })
      // Sunday before an "on" week, so the first slot is that week's Monday
      // rather than whichever day the search happens to land on mid-week.
      const after = new Date('2026-01-11T00:00:00.000Z')

      const slots: Date[] = []
      let cursor = after
      for (let i = 0; i < 4; i++) {
        const slot = await getNextAvailableReleaseSlot(projectId, { after: cursor })
        slots.push(slot!)
        cursor = new Date(slot!.getTime() + 1)
      }

      // Two releases in one week (Mon then Fri, four days apart)...
      expect(slots[0]!.getUTCDay()).toBe(1)
      expect(slots[1]!.getUTCDay()).toBe(5)
      expect(slots[1]!.getTime() - slots[0]!.getTime()).toBe(4 * DAY_MS)

      // ...then the next pair is a fortnight on from the first, not a week.
      expect(slots[2]!.getUTCDay()).toBe(1)
      expect(slots[2]!.getTime() - slots[0]!.getTime()).toBe(14 * DAY_MS)
      expect(slots[3]!.getTime() - slots[1]!.getTime()).toBe(14 * DAY_MS)
    })

    // The publisher UI labels this frequency "Monthly (1st)" and hides the
    // day picker for it, so ignoring releaseDay here is the contract.
    it('monthly: next slot is the 1st of the following month, regardless of releaseDay', async () => {
      await setPublishConfig({ releaseFrequency: 'monthly', releaseDay: 'fri', releaseTime: '09:00' })
      const after = new Date('2026-01-15T00:00:00.000Z')
      const slot = await getNextAvailableReleaseSlot(projectId, { after })
      expect(slot!.toISOString()).toBe('2026-02-01T09:00:00.000Z')
    })

    it('applies the configured release time (non-default)', async () => {
      await setPublishConfig({ releaseFrequency: 'daily', releaseTime: '23:45' })
      const after = new Date('2026-01-05T00:00:00.000Z')
      const slot = await getNextAvailableReleaseSlot(projectId, { after })
      expect(slot!.getUTCHours()).toBe(23)
      expect(slot!.getUTCMinutes()).toBe(45)
    })

    it('an occupied slot is skipped in favor of the next matching cadence slot', async () => {
      await setPublishConfig({ releaseFrequency: 'daily', releaseTime: '09:00' })
      const after = new Date('2026-01-05T00:00:00.000Z')
      const firstSlot = await getNextAvailableReleaseSlot(projectId, { after })
      expect(firstSlot!.toISOString()).toBe('2026-01-05T09:00:00.000Z')

      const occupyingChapter = await seedChapter()
      await db.insert(chapterPublications).values({
        projectId,
        chapterId: occupyingChapter.id,
        publishStatus: 'scheduled',
        isPublished: true,
        publishedAt: firstSlot,
        publicReleaseDate: firstSlot,
      })

      const nextSlot = await getNextAvailableReleaseSlot(projectId, { after })
      expect(nextSlot!.toISOString()).toBe('2026-01-06T09:00:00.000Z')
    })

    it('excludeChapterId lets a chapter reclaim its own already-occupied slot', async () => {
      await setPublishConfig({ releaseFrequency: 'daily', releaseTime: '09:00' })
      const after = new Date('2026-01-05T00:00:00.000Z')
      const firstSlot = await getNextAvailableReleaseSlot(projectId, { after })

      const chapter = await seedChapter()
      await db.insert(chapterPublications).values({
        projectId,
        chapterId: chapter.id,
        publishStatus: 'scheduled',
        isPublished: true,
        publishedAt: firstSlot,
        publicReleaseDate: firstSlot,
      })

      const slot = await getNextAvailableReleaseSlot(projectId, { after, excludeChapterId: chapter.id })
      expect(slot!.toISOString()).toBe(firstSlot!.toISOString())
    })
  })

  describe('getProjectMaxEarlyAccessDays', () => {
    it('returns the max earlyAccessDays across active tiers for the project owner', async () => {
      await db.insert(subscriptionTiers).values([
        { authorId: userId, name: 'Bronze', tierLevel: 1, earlyAccessDays: 2, isActive: true },
        { authorId: userId, name: 'Gold', tierLevel: 2, earlyAccessDays: 7, isActive: true },
        { authorId: userId, name: 'Retired', tierLevel: 3, earlyAccessDays: 30, isActive: false },
      ])
      const { maxEarlyAccessDays } = await getProjectMaxEarlyAccessDays(projectId)
      expect(maxEarlyAccessDays).toBe(7) // inactive tier excluded
    })

    it('returns 0 for an unknown project', async () => {
      const { maxEarlyAccessDays } = await getProjectMaxEarlyAccessDays('00000000-0000-0000-0000-000000000000')
      expect(maxEarlyAccessDays).toBe(0)
    })
  })

  describe('upsertScheduledChapterPublication', () => {
    it('creates a new scheduled row with publicReleaseDate equal to the scheduled date', async () => {
      const chapter = await seedChapter()
      const scheduledAt = new Date('2026-02-01T09:00:00.000Z')
      const row = await upsertScheduledChapterPublication(projectId, chapter.id, scheduledAt)
      expect(row!.publishStatus).toBe('scheduled')
      expect(row!.isPublished).toBe(true)
      expect(row!.publishedAt!.toISOString()).toBe(scheduledAt.toISOString())
      expect(row!.publicReleaseDate!.toISOString()).toBe(scheduledAt.toISOString())
      expect(row!.firstPublishedAt).toBeNull()
    })

    it('updates the existing row rather than inserting a duplicate', async () => {
      const chapter = await seedChapter()
      await upsertScheduledChapterPublication(projectId, chapter.id, new Date('2026-02-01T09:00:00.000Z'))
      const newDate = new Date('2026-02-08T09:00:00.000Z')
      await upsertScheduledChapterPublication(projectId, chapter.id, newDate)

      const rows = await db.select().from(chapterPublications).where(eq(chapterPublications.chapterId, chapter.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]!.publishedAt!.toISOString()).toBe(newDate.toISOString())
    })
  })

  describe('shiftFollowingScheduledChaptersUp', () => {
    it('shifts later chapters into the vacated slot, chain-style', async () => {
      const [c1, c2, c3] = await Promise.all([seedChapter(), seedChapter(), seedChapter()])
      const d1 = new Date('2026-01-01T09:00:00.000Z')
      const d2 = new Date('2026-01-08T09:00:00.000Z')
      const d3 = new Date('2026-01-15T09:00:00.000Z')
      await upsertScheduledChapterPublication(projectId, c1!.id, d1)
      await upsertScheduledChapterPublication(projectId, c2!.id, d2)
      await upsertScheduledChapterPublication(projectId, c3!.id, d3)

      // c1's slot (d1) was vacated (e.g. c1 was published early) — later chapters shift up.
      await shiftFollowingScheduledChaptersUp(projectId, d1, { excludeChapterId: c1!.id })

      const rows = await db.select().from(chapterPublications).where(eq(chapterPublications.projectId, projectId))
      const byChapter = new Map(rows.map(r => [r.chapterId, r]))
      expect(byChapter.get(c2!.id)!.publishedAt!.toISOString()).toBe(d1.toISOString())
      expect(byChapter.get(c3!.id)!.publishedAt!.toISOString()).toBe(d2.toISOString())
    })
  })

  describe('reorderScheduleByEntityOrder', () => {
    it('reassigns dates so earlier entity-order chapters get earlier dates', async () => {
      const c1 = await seedChapter({ entityData: { title: 'One', order: 1 } })
      const c2 = await seedChapter({ entityData: { title: 'Two', order: 2 } })
      const d1 = new Date('2026-01-01T09:00:00.000Z')
      const d2 = new Date('2026-01-08T09:00:00.000Z')
      // Dates assigned backwards relative to entity order.
      await upsertScheduledChapterPublication(projectId, c1.id, d2)
      await upsertScheduledChapterPublication(projectId, c2.id, d1)

      await reorderScheduleByEntityOrder(projectId)

      const rows = await db.select().from(chapterPublications).where(eq(chapterPublications.projectId, projectId))
      const byChapter = new Map(rows.map(r => [r.chapterId, r]))
      expect(byChapter.get(c1.id)!.publishedAt!.toISOString()).toBe(d1.toISOString())
      expect(byChapter.get(c2.id)!.publishedAt!.toISOString()).toBe(d2.toISOString())
    })

    it('is a no-op when dates already follow entity order', async () => {
      const c1 = await seedChapter({ entityData: { title: 'One', order: 1 } })
      const c2 = await seedChapter({ entityData: { title: 'Two', order: 2 } })
      const d1 = new Date('2026-01-01T09:00:00.000Z')
      const d2 = new Date('2026-01-08T09:00:00.000Z')
      await upsertScheduledChapterPublication(projectId, c1.id, d1)
      await upsertScheduledChapterPublication(projectId, c2.id, d2)

      await reorderScheduleByEntityOrder(projectId)

      const rows = await db.select().from(chapterPublications).where(eq(chapterPublications.projectId, projectId))
      const byChapter = new Map(rows.map(r => [r.chapterId, r]))
      expect(byChapter.get(c1.id)!.publishedAt!.toISOString()).toBe(d1.toISOString())
      expect(byChapter.get(c2.id)!.publishedAt!.toISOString()).toBe(d2.toISOString())
    })
  })

  describe('shouldAutoPublishAsGapFill', () => {
    async function pipelineChapter(order: number, publishStatus: string) {
      const chapter = await seedChapter({ entityData: { title: `Ch ${order}`, order } })
      await db.insert(chapterPublications).values({
        projectId,
        chapterId: chapter.id,
        publishStatus,
        isPublished: publishStatus === 'published',
      })
      return chapter
    }

    it('true when both neighbors are published', async () => {
      await pipelineChapter(1, 'published')
      const middle = await pipelineChapter(2, 'draft')
      await pipelineChapter(3, 'published')
      // middle isn't in the pipeline query (draft), insert it directly without a chapterPublications row.
      await db.delete(chapterPublications).where(eq(chapterPublications.chapterId, middle.id))

      expect(await shouldAutoPublishAsGapFill(projectId, middle.id)).toBe(true)
    })

    it('false when only the previous neighbor is published (no next)', async () => {
      await pipelineChapter(1, 'published')
      const last = await pipelineChapter(2, 'draft')
      await db.delete(chapterPublications).where(eq(chapterPublications.chapterId, last.id))

      expect(await shouldAutoPublishAsGapFill(projectId, last.id)).toBe(false)
    })

    it('true at the start of the manuscript when the next chapter is published', async () => {
      const first = await pipelineChapter(1, 'draft')
      await db.delete(chapterPublications).where(eq(chapterPublications.chapterId, first.id))
      await pipelineChapter(2, 'published')

      expect(await shouldAutoPublishAsGapFill(projectId, first.id)).toBe(true)
    })

    it('false when there are no other pipeline chapters', async () => {
      const only = await seedChapter({ entityData: { title: 'Solo', order: 1 } })
      expect(await shouldAutoPublishAsGapFill(projectId, only.id)).toBe(false)
    })
  })

  // ==========================================================================
  // subscription-expiration.ts
  // ==========================================================================

  describe('processSubscriptionExpiration', () => {
    let fakeStripe: any

    beforeEach(() => {
      fakeStripe = { subscriptions: { retrieve: jest.fn() } }
      mockGetStripe.mockReturnValue(fakeStripe)
    })

    afterEach(() => {
      mockGetStripe.mockReset()
    })

    async function makeTier() {
      const [tier] = await db.insert(subscriptionTiers).values({
        authorId: userId, name: 'Patron', tierLevel: 1,
      }).returning()
      return tier!
    }

    async function makeSub(overrides: Partial<typeof subscriptions.$inferInsert> & {
      subscriberId: string; authorId: string; tierId: string
    }) {
      const [sub] = await db.insert(subscriptions).values({
        status: 'active',
        currentPeriodStart: new Date(Date.now() - 30 * DAY_MS),
        currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
        stripeSubscriptionId: `sub_${Math.random().toString(36).slice(2)}`,
        ...overrides,
      }).returning()
      return sub!
    }

    it('leaves an active subscription untouched while it is inside its period', async () => {
      const subscriber = await createTestUser()
      const tier = await makeTier()
      const sub = await makeSub({ subscriberId: subscriber.id, authorId: userId, tierId: tier.id })

      await processSubscriptionExpiration()

      expect(fakeStripe.subscriptions.retrieve).not.toHaveBeenCalled()
      const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id))
      expect(row!.status).toBe('active')
    })

    it('an active subscription past currentPeriodEnd is remapped from the live Stripe status', async () => {
      const subscriber = await createTestUser()
      const tier = await makeTier()
      const sub = await makeSub({
        subscriberId: subscriber.id, authorId: userId, tierId: tier.id,
        currentPeriodEnd: new Date(Date.now() - DAY_MS), // already past
      })
      fakeStripe.subscriptions.retrieve.mockResolvedValue({
        status: 'canceled',
        items: { data: [{ current_period_start: 0, current_period_end: 0 }] },
      })

      await processSubscriptionExpiration()

      const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id))
      expect(row!.status).toBe('canceled')
    })

    it('an active subscription past its local period end but still active in Stripe just refreshes currentPeriodEnd', async () => {
      const subscriber = await createTestUser()
      const tier = await makeTier()
      const sub = await makeSub({
        subscriberId: subscriber.id, authorId: userId, tierId: tier.id,
        currentPeriodEnd: new Date(Date.now() - DAY_MS),
      })
      const newEnd = Math.floor((Date.now() + 30 * DAY_MS) / 1000)
      fakeStripe.subscriptions.retrieve.mockResolvedValue({
        status: 'active',
        items: { data: [{ current_period_start: Math.floor(Date.now() / 1000), current_period_end: newEnd }] },
      })

      await processSubscriptionExpiration()

      const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id))
      expect(row!.status).toBe('active')
      expect(row!.currentPeriodEnd.getTime()).toBe(newEnd * 1000)
    })

    it('a past_due/canceled subscription that Stripe reports recovered is restored to active', async () => {
      const subscriber = await createTestUser()
      const tier = await makeTier()
      const sub = await makeSub({
        subscriberId: subscriber.id, authorId: userId, tierId: tier.id,
        status: 'past_due',
        currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS), // not "expired" by period
      })
      const newEnd = Math.floor((Date.now() + 30 * DAY_MS) / 1000)
      fakeStripe.subscriptions.retrieve.mockResolvedValue({
        status: 'active',
        cancel_at_period_end: false,
        items: { data: [{ current_period_start: Math.floor(Date.now() / 1000), current_period_end: newEnd }] },
      })

      await processSubscriptionExpiration()

      const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id))
      expect(row!.status).toBe('active')
      expect(row!.currentPeriodEnd.getTime()).toBe(newEnd * 1000)
    })

    it('is idempotent — running twice leaves the recovered subscription stable', async () => {
      const subscriber = await createTestUser()
      const tier = await makeTier()
      const sub = await makeSub({
        subscriberId: subscriber.id, authorId: userId, tierId: tier.id,
        status: 'canceled',
        currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
      })
      const newEnd = Math.floor((Date.now() + 30 * DAY_MS) / 1000)
      fakeStripe.subscriptions.retrieve.mockResolvedValue({
        status: 'active',
        cancel_at_period_end: false,
        items: { data: [{ current_period_start: Math.floor(Date.now() / 1000), current_period_end: newEnd }] },
      })

      await processSubscriptionExpiration()
      await processSubscriptionExpiration()

      const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]!.status).toBe('active')
      expect(rows[0]!.currentPeriodEnd.getTime()).toBe(newEnd * 1000)
    })

    it('an expired site membership is downgraded to free/expired', async () => {
      const member = await createTestUser()
      await db.insert(siteMemberships).values({
        userId: member.id, tier: 'supporter', status: 'active',
        currentPeriodEnd: new Date(Date.now() - DAY_MS),
      })

      await processSubscriptionExpiration()

      const [row] = await db.select().from(siteMemberships).where(eq(siteMemberships.userId, member.id))
      expect(row!.tier).toBe('free')
      expect(row!.status).toBe('expired')
    })

    it('a site membership still inside its period is untouched', async () => {
      const member = await createTestUser()
      await db.insert(siteMemberships).values({
        userId: member.id, tier: 'supporter', status: 'active',
        currentPeriodEnd: new Date(Date.now() + DAY_MS),
      })

      await processSubscriptionExpiration()

      const [row] = await db.select().from(siteMemberships).where(eq(siteMemberships.userId, member.id))
      expect(row!.tier).toBe('supporter')
      expect(row!.status).toBe('active')
    })

    it('an admin-granted membership (null currentPeriodEnd) is never swept up as expired', async () => {
      const member = await createTestUser()
      await db.insert(siteMemberships).values({
        userId: member.id, tier: 'supporter', status: 'active', currentPeriodEnd: null,
      })

      await processSubscriptionExpiration()

      const [row] = await db.select().from(siteMemberships).where(eq(siteMemberships.userId, member.id))
      expect(row!.status).toBe('active')
    })

    it('idempotent for site memberships — running twice does not error or change the outcome', async () => {
      const member = await createTestUser()
      await db.insert(siteMemberships).values({
        userId: member.id, tier: 'supporter', status: 'active',
        currentPeriodEnd: new Date(Date.now() - DAY_MS),
      })

      await processSubscriptionExpiration()
      await processSubscriptionExpiration()

      const rows = await db.select().from(siteMemberships).where(eq(siteMemberships.userId, member.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]!.status).toBe('expired')
    })

    it('when Stripe is unconfigured, neither an expired author subscription nor a Stripe-backed membership is touched', async () => {
      // Our own missing configuration must never downgrade someone who may
      // well have paid; only memberships with nothing behind them expire.
      mockGetStripe.mockReturnValue(null)

      const subscriber = await createTestUser()
      const tier = await makeTier()
      const sub = await makeSub({
        subscriberId: subscriber.id, authorId: userId, tierId: tier.id,
        currentPeriodEnd: new Date(Date.now() - DAY_MS),
      })

      const member = await createTestUser()
      await db.insert(siteMemberships).values({
        userId: member.id, tier: 'supporter', status: 'active',
        stripeSubscriptionId: 'sub_has_id_but_no_stripe_client',
        currentPeriodEnd: new Date(Date.now() - DAY_MS),
      })

      await processSubscriptionExpiration()

      const [subRow] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id))
      expect(subRow!.status).toBe('active') // untouched — stale forever without a Stripe client

      const [memRow] = await db.select().from(siteMemberships).where(eq(siteMemberships.userId, member.id))
      expect(memRow!.status).toBe('active') // untouched: we could not verify it
      expect(memRow!.tier).toBe('supporter')

      // A comped membership has no Stripe subscription to renew it, so its
      // period end is authoritative and it still expires.
      const comped = await createTestUser()
      await db.insert(siteMemberships).values({
        userId: comped.id, tier: 'supporter', status: 'active',
        stripeSubscriptionId: null,
        currentPeriodEnd: new Date(Date.now() - DAY_MS),
      })
      await processSubscriptionExpiration()
      const [compedRow] = await db.select().from(siteMemberships).where(eq(siteMemberships.userId, comped.id))
      expect(compedRow!.status).toBe('expired')
      expect(compedRow!.tier).toBe('free')
    })
  })

  // ==========================================================================
  // tier-dispatch.ts
  // ==========================================================================

  describe('tier-dispatch', () => {
    beforeAll(() => {
      initTierDispatch()
    })

    async function makeTier(tierLevel = 1) {
      const [tier] = await db.insert(subscriptionTiers).values({
        authorId: userId, name: `Tier ${tierLevel}`, tierLevel,
      }).returning()
      return tier!
    }

    async function makeEmbargo(overrides: Partial<typeof embargoSchedules.$inferInsert> & { entityId: string }) {
      const [row] = await db.insert(embargoSchedules).values({
        projectId,
        isPublished: true,
        ...overrides,
      }).returning()
      return row!
    }

    function waitForEvent(): Promise<any> {
      return new Promise((resolve) => {
        const unsub = serverEventBus.on('content:available', (event) => {
          unsub()
          resolve(event)
        })
      })
    }

    it('fires content:available and marks the tier schedule dispatched once its release date has arrived', async () => {
      const chapter = await seedChapter()
      const tier = await makeTier(2)
      const events = waitForEvent()
      await makeEmbargo({
        entityId: chapter.id,
        tierSchedules: [
          { tierId: tier.id, releaseDate: new Date(Date.now() - DAY_MS).toISOString(), dispatched: false },
        ],
      })

      await processEmbargoReleases()

      const event = await events
      expect(event.projectId).toBe(projectId)
      expect(event.entityId).toBe(chapter.id)
      expect(event.payload.tierId).toBe(tier.id)
      expect(event.payload.tierLevel).toBe(2)

      const [row] = await db.select().from(embargoSchedules).where(eq(embargoSchedules.entityId, chapter.id))
      const schedules = row!.tierSchedules as Array<{ dispatched?: boolean }>
      expect(schedules[0]!.dispatched).toBe(true)
    })

    it('leaves a tier schedule alone when its release date has not arrived yet', async () => {
      const chapter = await seedChapter()
      const tier = await makeTier(1)
      let fired = false
      const unsub = serverEventBus.on('content:available', () => { fired = true })
      await makeEmbargo({
        entityId: chapter.id,
        tierSchedules: [
          { tierId: tier.id, releaseDate: new Date(Date.now() + DAY_MS).toISOString(), dispatched: false },
        ],
      })

      await processEmbargoReleases()
      unsub()

      expect(fired).toBe(false)
      const [row] = await db.select().from(embargoSchedules).where(eq(embargoSchedules.entityId, chapter.id))
      const schedules = row!.tierSchedules as Array<{ dispatched?: boolean }>
      expect(schedules[0]!.dispatched).toBe(false)
    })

    it('does not re-fire a tier schedule that was already dispatched', async () => {
      const chapter = await seedChapter()
      const tier = await makeTier(1)
      let fireCount = 0
      const unsub = serverEventBus.on('content:available', () => { fireCount++ })
      await makeEmbargo({
        entityId: chapter.id,
        tierSchedules: [
          { tierId: tier.id, releaseDate: new Date(Date.now() - DAY_MS).toISOString(), dispatched: true },
        ],
      })

      await processEmbargoReleases()
      unsub()

      expect(fireCount).toBe(0)
    })

    it('fires a public content:available event (tierId "public", tierLevel 0) once publicReleaseDate is reached', async () => {
      const chapter = await seedChapter()
      const events = waitForEvent()
      await makeEmbargo({
        entityId: chapter.id,
        publicReleaseDate: new Date(Date.now() - DAY_MS),
        tierSchedules: [],
      })

      await processEmbargoReleases()

      const event = await events
      expect(event.payload.tierId).toBe('public')
      expect(event.payload.tierLevel).toBe(0)
    })

    it('a content:available event for a nonexistent project is skipped without throwing', async () => {
      await expect(
        serverEventBus.emit(contentAvailable('00000000-0000-0000-0000-000000000000', 'irrelevant-entity', 'irrelevant-tier', 1))
      ).resolves.toBeUndefined()
    })

    it('a content:available event missing entityId is skipped without throwing', async () => {
      await expect(
        serverEventBus.emit({
          type: 'content:available',
          timestamp: new Date(),
          projectId,
          payload: { tierId: 'some-tier', tierLevel: 1 },
        })
      ).resolves.toBeUndefined()
    })

    it('dispatches to an installed automation (delivery_channel) bobbin for a qualifying subscriber', async () => {
      const chapter = await seedChapter()
      const tier = await makeTier(1)
      const subscriber = await createTestUser()
      await db.insert(subscriptions).values({
        subscriberId: subscriber.id,
        authorId: userId,
        tierId: tier.id,
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
      })
      await db.insert(userBobbinsInstalled).values({
        userId: subscriber.id,
        bobbinId: 'test-automation-bobbin',
        bobbinType: 'delivery_channel',
        isEnabled: true,
        config: { foo: 'bar' },
      })

      const handler = jest.fn().mockResolvedValue(undefined)
      registerAutomationHandler('test-automation-bobbin', handler)

      await serverEventBus.emit(contentAvailable(projectId, chapter.id, tier.id, 1))

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        userId: subscriber.id,
        projectId,
        entityId: chapter.id,
        tierId: tier.id,
        tierLevel: 1,
        bobbinConfig: { foo: 'bar' },
      }))
    })

    it('does not dispatch to a subscriber below the required tier level', async () => {
      const chapter = await seedChapter()
      const lowTier = await makeTier(1)
      const highTier = await makeTier(3)
      const subscriber = await createTestUser()
      await db.insert(subscriptions).values({
        subscriberId: subscriber.id,
        authorId: userId,
        tierId: lowTier.id,
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
      })
      await db.insert(userBobbinsInstalled).values({
        userId: subscriber.id,
        bobbinId: 'test-automation-bobbin-2',
        bobbinType: 'delivery_channel',
        isEnabled: true,
      })

      const handler = jest.fn().mockResolvedValue(undefined)
      registerAutomationHandler('test-automation-bobbin-2', handler)

      // Content released at the *high* tier — the low-tier subscriber shouldn't qualify.
      await serverEventBus.emit(contentAvailable(projectId, chapter.id, highTier.id, 3))

      expect(handler).not.toHaveBeenCalled()
    })
  })
})
