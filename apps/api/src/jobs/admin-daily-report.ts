/**
 * Admin Daily Report
 *
 * Gathers 24-hour platform metrics and emails a summary to all owner-badge users.
 * Only sends when there is something to report (growth or errors).
 *
 * Idempotent: gated on a row in cron_runs so the trigger-scheduler can invoke
 * this every tick and the function self-rate-limits. Self-heals if a tick is
 * missed near 14:00 UTC — the next tick after the fire time claims and sends.
 */

import { db } from '../db/connection'
import {
  users,
  projects,
  chapterPublications,
  subscriptions,
  subscriptionPayments,
  siteMemberships,
  projectFollows,
  userFollowers,
  chapterViews,
  projectDestinations,
  uploads,
  userBadges,
  cronRuns,
} from '../db/schema'
import { eq, and, sql, count, gt, isNull } from 'drizzle-orm'
import { sendEmail, buildAdminDailyReportHtml, buildAdminDailyReportText } from '../lib/email'

const JOB_NAME = 'admin_daily_report'
const FIRE_HOUR_UTC = 14

export interface AdminDailyReport {
  // Growth
  newSignups: number
  newProjects: number
  chaptersFirstPublished: number
  newSubscriptions: number
  newSupporterMemberships: number
  newProjectFollows: number
  newUserFollows: number
  // Reading
  chapterViewsStarted: number
  chapterReadsCompleted: number
  // Errors
  failedPayments: number
  failedSyncs: number
  reportedUploads: number
}

export interface AdminDailyReportResult {
  ok: boolean
  claimed: boolean
  skipped?: 'before_fire_time' | 'already_ran' | 'no_growth' | 'no_admins'
  sent?: boolean
  error?: string
}

/** Today's 14:00 UTC, regardless of whether it has passed yet. */
export function todayFireTime(now: Date): Date {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    FIRE_HOUR_UTC, 0, 0,
  ))
}

async function getAdminEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(userBadges)
    .innerJoin(users, eq(userBadges.userId, users.id))
    .where(and(
      eq(userBadges.badge, 'owner'),
      eq(userBadges.isActive, true),
    ))

  return rows.map(r => r.email)
}

async function gatherReportData(): Promise<AdminDailyReport> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [
    [signups],
    [newProjects],
    [chapters],
    [subs],
    [supporters],
    [projFollows],
    [usrFollows],
    [views],
    [completed],
    [failedPay],
    [failedSync],
    [reported],
  ] = await Promise.all([
    db.select({ count: count() }).from(users)
      .where(gt(users.createdAt, cutoff)),
    db.select({ count: count() }).from(projects)
      .where(and(gt(projects.createdAt, cutoff), isNull(projects.deletedAt))),
    db.select({ count: count() }).from(chapterPublications)
      .where(gt(chapterPublications.firstPublishedAt, cutoff)),
    db.select({ count: count() }).from(subscriptions)
      .where(gt(subscriptions.createdAt, cutoff)),
    db.select({ count: count() }).from(siteMemberships)
      .where(and(gt(siteMemberships.createdAt, cutoff), eq(siteMemberships.tier, 'supporter'))),
    db.select({ count: count() }).from(projectFollows)
      .where(gt(projectFollows.createdAt, cutoff)),
    db.select({ count: count() }).from(userFollowers)
      .where(gt(userFollowers.createdAt, cutoff)),
    db.select({ count: count() }).from(chapterViews)
      .where(gt(chapterViews.startedAt, cutoff)),
    db.select({ count: count() }).from(chapterViews)
      .where(gt(chapterViews.completedAt, cutoff)),
    db.select({ count: count() }).from(subscriptionPayments)
      .where(and(eq(subscriptionPayments.status, 'failed'), gt(subscriptionPayments.createdAt, cutoff))),
    db.select({ count: count() }).from(projectDestinations)
      .where(and(eq(projectDestinations.lastSyncStatus, 'failed'), gt(projectDestinations.updatedAt, cutoff))),
    db.select({ count: count() }).from(uploads)
      .where(and(eq(uploads.status, 'reported'), gt(uploads.updatedAt, cutoff))),
  ])

  return {
    newSignups: signups?.count ?? 0,
    newProjects: newProjects?.count ?? 0,
    chaptersFirstPublished: chapters?.count ?? 0,
    newSubscriptions: subs?.count ?? 0,
    newSupporterMemberships: supporters?.count ?? 0,
    newProjectFollows: projFollows?.count ?? 0,
    newUserFollows: usrFollows?.count ?? 0,
    chapterViewsStarted: views?.count ?? 0,
    chapterReadsCompleted: completed?.count ?? 0,
    failedPayments: failedPay?.count ?? 0,
    failedSyncs: failedSync?.count ?? 0,
    reportedUploads: reported?.count ?? 0,
  }
}

/**
 * Atomically claim today's run. Returns true if this caller owns the run,
 * false if another concurrent tick already claimed it.
 *
 * On force=true, always wins the claim and marks the row forced so it does
 * not block the legitimate 14:00 UTC firing later in the day.
 */
async function claimRun(now: Date, force: boolean): Promise<boolean> {
  const fireTime = todayFireTime(now)
  const claimed = await db
    .insert(cronRuns)
    .values({
      jobName: JOB_NAME,
      lastRunAt: now,
      lastStatus: 'success',
      lastError: null,
      forced: force,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: cronRuns.jobName,
      set: {
        lastRunAt: now,
        lastStatus: 'success',
        lastError: null,
        forced: force,
        updatedAt: now,
      },
      setWhere: force
        ? sql`true`
        : sql`${cronRuns.lastRunAt} < ${fireTime.toISOString()} OR ${cronRuns.forced} = true`,
    })
    .returning({ jobName: cronRuns.jobName })
  return claimed.length > 0
}

async function recordTerminal(
  status: 'success' | 'skipped' | 'failed',
  error: string | null,
): Promise<void> {
  await db
    .update(cronRuns)
    .set({ lastStatus: status, lastError: error, updatedAt: new Date() })
    .where(eq(cronRuns.jobName, JOB_NAME))
}

export async function processAdminDailyReport(
  opts: { force?: boolean } = {},
): Promise<AdminDailyReportResult> {
  const force = !!opts.force
  const now = new Date()

  // Time gate (skip silently — every tick calls us)
  if (!force && now < todayFireTime(now)) {
    return { ok: true, claimed: false, skipped: 'before_fire_time' }
  }

  // Atomic claim
  const claimed = await claimRun(now, force)
  if (!claimed) {
    return { ok: true, claimed: false, skipped: 'already_ran' }
  }

  try {
    const report = await gatherReportData()

    const hasGrowth =
      report.newSignups > 0 ||
      report.newProjects > 0 ||
      report.chaptersFirstPublished > 0 ||
      report.newSubscriptions > 0 ||
      report.newSupporterMemberships > 0 ||
      report.newProjectFollows > 0 ||
      report.newUserFollows > 0

    const hasErrors =
      report.failedPayments > 0 ||
      report.failedSyncs > 0 ||
      report.reportedUploads > 0

    if (!hasGrowth && !hasErrors) {
      console.log('[admin-daily-report] Nothing to report, skipping email')
      await recordTerminal('skipped', null)
      return { ok: true, claimed: true, skipped: 'no_growth' }
    }

    const adminEmails = await getAdminEmails()
    if (adminEmails.length === 0) {
      console.log('[admin-daily-report] No admin emails found, skipping')
      await recordTerminal('skipped', null)
      return { ok: true, claimed: true, skipped: 'no_admins' }
    }

    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    })

    const html = buildAdminDailyReportHtml(report)
    const text = buildAdminDailyReportText(report)

    const sent = await sendEmail({
      to: adminEmails,
      subject: `Bobbinry Daily Report — ${dateStr}`,
      html,
      text,
    })

    if (sent) {
      console.log(`[admin-daily-report] Sent report to ${adminEmails.length} admin(s)`)
      await recordTerminal('success', null)
      return { ok: true, claimed: true, sent: true }
    }

    const errMsg = 'sendEmail returned false (missing RESEND_API_KEY or upstream error)'
    console.error(`[admin-daily-report] ${errMsg}`)
    await recordTerminal('failed', errMsg)
    return { ok: false, claimed: true, sent: false, error: errMsg }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[admin-daily-report] Failed to send daily report:', err)
    await recordTerminal('failed', errMsg).catch(() => {})
    return { ok: false, claimed: true, error: errMsg }
  }
}
