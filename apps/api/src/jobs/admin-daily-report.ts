/**
 * Admin Daily Report
 *
 * Gathers 24-hour platform metrics and emails a summary to all owner-badge users.
 * Only sends when there is something to report (growth or errors).
 * Triggered daily at 14:00 UTC from the trigger scheduler.
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
} from '../db/schema'
import { eq, and, sql, count } from 'drizzle-orm'
import { sendEmail, buildAdminDailyReportHtml, buildAdminDailyReportText } from '../lib/email'

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
      .where(sql`${users.createdAt} > ${cutoff}`),
    db.select({ count: count() }).from(projects)
      .where(sql`${projects.createdAt} > ${cutoff} AND ${projects.deletedAt} IS NULL`),
    db.select({ count: count() }).from(chapterPublications)
      .where(sql`${chapterPublications.firstPublishedAt} > ${cutoff}`),
    db.select({ count: count() }).from(subscriptions)
      .where(sql`${subscriptions.createdAt} > ${cutoff}`),
    db.select({ count: count() }).from(siteMemberships)
      .where(sql`${siteMemberships.createdAt} > ${cutoff} AND ${siteMemberships.tier} = 'supporter'`),
    db.select({ count: count() }).from(projectFollows)
      .where(sql`${projectFollows.createdAt} > ${cutoff}`),
    db.select({ count: count() }).from(userFollowers)
      .where(sql`${userFollowers.createdAt} > ${cutoff}`),
    db.select({ count: count() }).from(chapterViews)
      .where(sql`${chapterViews.startedAt} > ${cutoff}`),
    db.select({ count: count() }).from(chapterViews)
      .where(sql`${chapterViews.completedAt} > ${cutoff}`),
    db.select({ count: count() }).from(subscriptionPayments)
      .where(sql`${subscriptionPayments.status} = 'failed' AND ${subscriptionPayments.createdAt} > ${cutoff}`),
    db.select({ count: count() }).from(projectDestinations)
      .where(sql`${projectDestinations.lastSyncStatus} = 'failed' AND ${projectDestinations.updatedAt} > ${cutoff}`),
    db.select({ count: count() }).from(uploads)
      .where(sql`${uploads.status} = 'reported' AND ${uploads.updatedAt} > ${cutoff}`),
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

export async function processAdminDailyReport(): Promise<void> {
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
      return
    }

    const adminEmails = await getAdminEmails()
    if (adminEmails.length === 0) {
      console.log('[admin-daily-report] No admin emails found, skipping')
      return
    }

    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    })

    const html = buildAdminDailyReportHtml(report)
    const text = buildAdminDailyReportText(report)

    await sendEmail({
      to: adminEmails,
      subject: `Bobbinry Daily Report — ${dateStr}`,
      html,
      text,
    })

    console.log(`[admin-daily-report] Sent report to ${adminEmails.length} admin(s)`)
  } catch (err) {
    console.error('[admin-daily-report] Failed to send daily report:', err)
  }
}
