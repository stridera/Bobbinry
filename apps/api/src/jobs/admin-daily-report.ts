/**
 * Admin Daily Report
 *
 * Gathers platform metrics since the last successful send (or the last 24h
 * as a fallback) and emails a summary to all owner-badge users. Only sends
 * when there is something to report (growth, errors, or moderation queue).
 *
 * Idempotent: gated on a row in cron_runs so the trigger-scheduler can invoke
 * this every tick and the function self-rate-limits. Self-heals if a tick is
 * missed near 14:00 UTC — the next tick after the fire time claims and sends.
 *
 * Windowing: the cutoff is `cron_runs.last_sent_at` if set (so a previously
 * missed/skipped day's events roll into the next send), capped at 7 days back
 * to keep query plans bounded.
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
  comments,
  reactions,
  chapterAnnotations,
  entities,
} from '../db/schema'
import { eq, and, sql, count, gt, isNull, notInArray } from 'drizzle-orm'
import { sendEmail, buildAdminDailyReportHtml, buildAdminDailyReportText } from '../lib/email'
import { env } from '../lib/env'

const JOB_NAME = 'admin_daily_report'
const FIRE_HOUR_UTC = 14
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const PROD_WEB_ORIGIN = 'https://bobbinry.com'

export interface AdminDailyReport {
  // Growth — counted toward the gating decision
  newSignups: number
  newProjects: number
  chaptersFirstPublished: number
  newSubscriptions: number
  newSupporterMemberships: number
  newProjectFollows: number
  newUserFollows: number
  // Activity — reported when present, but does not trigger a send on its own
  chapterViewsStarted: number
  chapterReadsCompleted: number
  newComments: number
  newReactions: number
  newAnnotations: number
  entitiesEdited: number
  // Attention bucket
  failedPayments: number
  failedSyncs: number
  reportedUploads: number
  pendingComments: number
}

export interface AdminDailyReportResult {
  ok: boolean
  claimed: boolean
  skipped?: 'not_production' | 'before_fire_time' | 'already_ran' | 'no_growth' | 'no_admins'
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

/**
 * Compute the report's cutoff: prefer the last successful send (so missed
 * days roll into the next report), fall back to a fixed 24h window, and cap
 * at 7 days back to bound query work.
 */
export async function getCutoff(now: Date): Promise<{ cutoff: Date; capped: boolean }> {
  const fallback = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const floor = new Date(now.getTime() - MAX_WINDOW_MS)

  const [row] = await db
    .select({ lastSentAt: cronRuns.lastSentAt })
    .from(cronRuns)
    .where(eq(cronRuns.jobName, JOB_NAME))
    .limit(1)

  const candidate = row?.lastSentAt ?? fallback
  if (candidate < floor) return { cutoff: floor, capped: true }
  return { cutoff: candidate, capped: false }
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

export async function gatherReportData(cutoff: Date): Promise<AdminDailyReport> {
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
    [newComm],
    [newReact],
    [newAnnot],
    [edits],
    [failedPay],
    [failedSync],
    [reported],
    [pendComm],
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
    db.select({ count: count() }).from(comments)
      .where(and(
        gt(comments.createdAt, cutoff),
        notInArray(comments.moderationStatus, ['deleted', 'hidden']),
      )),
    db.select({ count: count() }).from(reactions)
      .where(gt(reactions.createdAt, cutoff)),
    db.select({ count: count() }).from(chapterAnnotations)
      .where(gt(chapterAnnotations.createdAt, cutoff)),
    db.select({ count: count() }).from(entities)
      .where(gt(entities.lastEditedAt, cutoff)),
    db.select({ count: count() }).from(subscriptionPayments)
      .where(and(eq(subscriptionPayments.status, 'failed'), gt(subscriptionPayments.createdAt, cutoff))),
    db.select({ count: count() }).from(projectDestinations)
      .where(and(eq(projectDestinations.lastSyncStatus, 'failed'), gt(projectDestinations.updatedAt, cutoff))),
    db.select({ count: count() }).from(uploads)
      .where(and(eq(uploads.status, 'reported'), gt(uploads.updatedAt, cutoff))),
    db.select({ count: count() }).from(comments)
      .where(and(eq(comments.moderationStatus, 'pending'), gt(comments.createdAt, cutoff))),
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
    newComments: newComm?.count ?? 0,
    newReactions: newReact?.count ?? 0,
    newAnnotations: newAnnot?.count ?? 0,
    entitiesEdited: edits?.count ?? 0,
    failedPayments: failedPay?.count ?? 0,
    failedSyncs: failedSync?.count ?? 0,
    reportedUploads: reported?.count ?? 0,
    pendingComments: pendComm?.count ?? 0,
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
  sentAt: Date | null = null,
): Promise<void> {
  await db
    .update(cronRuns)
    .set({
      lastStatus: status,
      lastError: error,
      updatedAt: new Date(),
      ...(sentAt ? { lastSentAt: sentAt } : {}),
    })
    .where(eq(cronRuns.jobName, JOB_NAME))
}

export async function processAdminDailyReport(
  opts: { force?: boolean } = {},
): Promise<AdminDailyReportResult> {
  const force = !!opts.force
  const now = new Date()

  // Production gate — every dev/staging environment also runs this on its own
  // scheduler, but only prod should email the admin list. Force bypasses so
  // manual testing from the admin route still works in dev.
  if (!force && env.WEB_ORIGIN !== PROD_WEB_ORIGIN) {
    return { ok: true, claimed: false, skipped: 'not_production' }
  }

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
    const { cutoff } = await getCutoff(now)
    const report = await gatherReportData(cutoff)

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
      report.reportedUploads > 0 ||
      report.pendingComments > 0

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

    const windowMs = now.getTime() - cutoff.getTime()
    const multiDay = windowMs > 36 * 60 * 60 * 1000
    const days = Math.max(1, Math.round(windowMs / (24 * 60 * 60 * 1000)))

    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    })

    const subject = multiDay
      ? `Bobbinry Report — last ${days} days`
      : `Bobbinry Daily Report — ${dateStr}`

    const html = buildAdminDailyReportHtml(report, { since: cutoff, until: now })
    const text = buildAdminDailyReportText(report, { since: cutoff, until: now })

    const sent = await sendEmail({
      to: adminEmails,
      subject,
      html,
      text,
    })

    if (sent) {
      console.log(`[admin-daily-report] Sent report to ${adminEmails.length} admin(s)`)
      await recordTerminal('success', null, now)
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
