/**
 * Trigger Scheduler
 *
 * One-minute tick that runs the platform's periodic jobs: scheduled and
 * embargoed chapter releases, trash purge, subscription reconciliation, the
 * admin daily report, and revision thinning. Bobbin-declared schedule triggers
 * and the backup-sync loop were removed in September 2026 — nothing registered
 * handlers for them; Drive sync runs through jobs/drive-sync-core.ts.
 */

import { db } from '../db/connection'
import { chapterPublications } from '../db/schema'
import { eq, and, lte, isNull } from 'drizzle-orm'
import { processEmbargoReleases, initTierDispatch } from './tier-dispatch'
import { processTrashPurge } from './trash-purge'
import { processRevisionThinning } from './revision-thinning'
import { processSubscriptionExpiration } from './subscription-expiration'
import { processAdminDailyReport } from './admin-daily-report'
import { serverEventBus, contentPublished } from '../lib/event-bus'
import { moduleLogger } from '../lib/logger'

const log = moduleLogger('trigger-scheduler')



export async function processScheduledReleases(): Promise<void> {
  try {
    const now = new Date()
    const duePublications = await db
      .select({
        id: chapterPublications.id,
        projectId: chapterPublications.projectId,
        chapterId: chapterPublications.chapterId,
      })
      .from(chapterPublications)
      .where(and(
        eq(chapterPublications.publishStatus, 'scheduled'),
        lte(chapterPublications.publishedAt, now)
      ))

    if (duePublications.length === 0) return

    // Stamp firstPublishedAt for any due-but-unstamped rows in a single UPDATE.
    // (Drizzle's sql template tag doesn't auto-bind JS Date — see commit 2699f73.)
    await db
      .update(chapterPublications)
      .set({ firstPublishedAt: now })
      .where(and(
        eq(chapterPublications.publishStatus, 'scheduled'),
        isNull(chapterPublications.firstPublishedAt),
        lte(chapterPublications.publishedAt, now),
      ))

    for (const publication of duePublications) {
      await db
        .update(chapterPublications)
        .set({
          publishStatus: 'published',
          lastPublishedAt: now,
          updatedAt: now,
        })
        .where(eq(chapterPublications.id, publication.id))

      serverEventBus.fire(contentPublished(
        publication.projectId,
        publication.chapterId,
        'system',
        true
      ))
    }
  } catch (err) {
    log.error({ err }, 'Failed to process scheduled releases')
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null

/**
 * Start the trigger scheduler.
 * Runs every minute to check for matching cron triggers and backup sync.
 */
export function startTriggerScheduler(): void {
  if (intervalId) return

  // Initialize tier dispatch (subscribes to content:available events)
  initTierDispatch()

  log.info('Starting trigger scheduler (1-minute interval)')

  async function tick() {
    try {
      const tasks: Promise<any>[] = [
        processScheduledReleases(),
        processEmbargoReleases(),
      ]

      // Run trash purge hourly (at minute 0)
      if (new Date().getUTCMinutes() === 0) {
        tasks.push(processTrashPurge())
      }

      // Reconcile subscription state with Stripe every 15 minutes
      if (new Date().getUTCMinutes() % 15 === 0) {
        tasks.push(processSubscriptionExpiration())
      }

      // Admin daily report self-gates on the cron_runs row — safe to call every tick
      tasks.push(processAdminDailyReport())

      // Revision thinning likewise self-gates on cron_runs. Heavy scan, run
      // off-peak: claiming only happens once per UTC day regardless, but
      // starting it in the small hours keeps it away from writing traffic.
      if (new Date().getUTCHours() === 4) {
        tasks.push(processRevisionThinning())
      }

      await Promise.allSettled(tasks)
    } catch (err) {
      // Without this, a throw from getInstalledBobbins (e.g. transient DB/DNS failure)
      // becomes an unhandled promise rejection on every setInterval firing.
      log.error({ err }, 'Tick failed')
    }
  }

  intervalId = setInterval(tick, 60 * 1000)
  // Run once immediately
  tick().catch(err => log.error({ err }, 'Initial tick failed'))
}

/**
 * Stop the trigger scheduler.
 */
export function stopTriggerScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    log.info('Stopped trigger scheduler')
  }
}
