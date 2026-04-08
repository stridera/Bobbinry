/**
 * Email Client (Resend)
 *
 * Transactional email sending for notifications, welcome emails, etc.
 * No-ops gracefully when RESEND_API_KEY is not configured (local dev).
 *
 * All emails use a branded "Literary Correspondence" template:
 * - Table-based layout (600px max) for cross-client compatibility
 * - Warm paper background, white content card, teal header
 * - Georgia serif headings, system sans-serif body
 * - Inline styles only — no <style> blocks
 */

import { createHmac } from 'crypto'
import { Resend } from 'resend'
import { env } from './env'

let _client: Resend | null = null

function getClient(): Resend | null {
  if (!env.RESEND_API_KEY) return null
  if (!_client) {
    _client = new Resend(env.RESEND_API_KEY)
  }
  return _client
}

/** Escape user-controlled strings before interpolating into HTML email bodies */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------
const COLORS = {
  bg: '#faf8f4',
  card: '#ffffff',
  headerBar: '#33706b',
  headerText: '#ffffff',
  accent: '#de8c2b',
  text: '#333333',
  muted: '#888888',
  divider: '#d0c5b7',
  buttonBg: '#33706b',
  buttonText: '#ffffff',
} as const

const FONT_HEADING = "Georgia, 'Times New Roman', serif"
const FONT_BODY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

// ---------------------------------------------------------------------------
// Shared template helpers
// ---------------------------------------------------------------------------

/** Branded email shell — DOCTYPE, html, head, body, outer table, header, content card, footer */
function emailLayout(content: string, footer?: string): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>Bobbinry</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.bg};font-family:${FONT_BODY};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.bg};">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <!-- Container -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Header bar -->
          <tr>
            <td style="background-color:${COLORS.headerBar};padding:20px 32px;border-radius:8px 8px 0 0;">
              <span style="font-family:${FONT_HEADING};font-size:22px;font-weight:bold;color:${COLORS.headerText};letter-spacing:0.5px;">Bobbinry</span>
            </td>
          </tr>
          <!-- Content card -->
          <tr>
            <td style="background-color:${COLORS.card};padding:32px;border-left:1px solid #e8e4de;border-right:1px solid #e8e4de;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:${COLORS.card};padding:0 32px 24px;border-left:1px solid #e8e4de;border-right:1px solid #e8e4de;border-bottom:1px solid #e8e4de;border-radius:0 0 8px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-top:1px solid ${COLORS.divider};padding-top:16px;">
                    <p style="margin:0;font-size:12px;color:${COLORS.muted};line-height:18px;">
                      ${footer || `&copy; Bobbinry &mdash; Tools for writers and worldbuilders`}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** Render a teal CTA button as an Outlook-safe table cell */
function emailButton(text: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr>
    <td style="background-color:${COLORS.buttonBg};border-radius:6px;padding:14px 28px;">
      <a href="${url}" style="color:${COLORS.buttonText};font-family:${FONT_BODY};font-size:16px;font-weight:600;text-decoration:none;display:inline-block;">${text}</a>
    </td>
  </tr>
</table>`
}

// ---------------------------------------------------------------------------
// HMAC-signed unsubscribe tokens
// ---------------------------------------------------------------------------

function getHmacSecret(): string {
  // Use RESEND_API_KEY as HMAC secret — always available when emails are sent
  return env.RESEND_API_KEY || 'dev-secret'
}

/** Generate an HMAC-signed unsubscribe token: userId:prefKey signed as hex */
export function generateUnsubscribeToken(userId: string, prefKey: string): string {
  const payload = `${userId}:${prefKey}`
  const signature = createHmac('sha256', getHmacSecret()).update(payload).digest('hex')
  return `${payload}:${signature}`
}

/** Verify and parse an unsubscribe token. Returns { userId, prefKey } or null. */
export function verifyUnsubscribeToken(token: string): { userId: string; prefKey: string } | null {
  const parts = token.split(':')
  if (parts.length !== 3) return null
  const userId = parts[0]!
  const prefKey = parts[1]!
  const signature = parts[2]!
  const expectedSig = createHmac('sha256', getHmacSecret()).update(`${userId}:${prefKey}`).digest('hex')
  if (signature !== expectedSig) return null
  return { userId, prefKey }
}

function unsubscribeUrl(userId: string, prefKey: string): string {
  const token = generateUnsubscribeToken(userId, prefKey)
  return `${env.API_ORIGIN}/api/unsubscribe?token=${encodeURIComponent(token)}`
}

function notificationFooter(userId: string, prefKey: string): string {
  const url = unsubscribeUrl(userId, prefKey)
  return `&copy; Bobbinry &mdash; Tools for writers and worldbuilders<br><a href="${url}" style="color:${COLORS.muted};text-decoration:underline;">Unsubscribe</a> from these emails`
}

// ---------------------------------------------------------------------------
// Send email
// ---------------------------------------------------------------------------

interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
  headers?: Record<string, string>
}

export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  const client = getClient()
  if (!client) {
    console.log(`[email] Skipping send (no RESEND_API_KEY): "${opts.subject}" → ${opts.to}`)
    return false
  }

  try {
    await client.emails.send({
      from: env.EMAIL_FROM,
      to: Array.isArray(opts.to) ? opts.to : [opts.to],
      subject: opts.subject,
      html: opts.html,
      ...(opts.text ? { text: opts.text } : {}),
      ...(opts.headers ? { headers: opts.headers } : {}),
    })
    return true
  } catch (err) {
    console.error('[email] Failed to send:', (err as Error).message)
    return false
  }
}

// ---------------------------------------------------------------------------
// Auth emails (no unsubscribe headers)
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(to: string, token: string, name?: string): Promise<boolean> {
  const displayName = name || 'there'
  const verifyUrl = `${env.WEB_ORIGIN}/verify-email?token=${token}`
  const content = `
    <h1 style="margin:0 0 16px;font-family:${FONT_HEADING};font-size:24px;color:${COLORS.text};">Hey ${escapeHtml(displayName)}, verify your email</h1>
    <p style="margin:0 0 8px;font-size:16px;color:${COLORS.text};line-height:24px;">Thanks for signing up for Bobbinry! Please verify your email address to unlock all features.</p>
    ${emailButton('Verify my email', verifyUrl)}
    <p style="margin:0 0 8px;font-size:14px;color:${COLORS.muted};line-height:20px;">This link expires in 24 hours.</p>
    <p style="margin:0;font-size:13px;color:${COLORS.muted};line-height:20px;">If you didn&rsquo;t create a Bobbinry account, you can safely ignore this email.</p>
  `
  return sendEmail({
    to,
    subject: 'Verify your email — Bobbinry',
    html: emailLayout(content),
    text: `Hey ${displayName}, verify your email to unlock all features on Bobbinry. Visit: ${verifyUrl} — This link expires in 24 hours.`,
  })
}

export async function sendPasswordResetEmail(to: string, token: string, name?: string): Promise<boolean> {
  const displayName = name || 'there'
  const resetUrl = `${env.WEB_ORIGIN}/reset-password?token=${token}`
  const content = `
    <h1 style="margin:0 0 16px;font-family:${FONT_HEADING};font-size:24px;color:${COLORS.text};">Hey ${escapeHtml(displayName)}, reset your password</h1>
    <p style="margin:0 0 8px;font-size:16px;color:${COLORS.text};line-height:24px;">We received a request to reset your Bobbinry password. Click the button below to choose a new one.</p>
    ${emailButton('Reset my password', resetUrl)}
    <p style="margin:0 0 8px;font-size:14px;color:${COLORS.muted};line-height:20px;">This link expires in 1 hour.</p>
    <p style="margin:0;font-size:13px;color:${COLORS.muted};line-height:20px;">If you didn&rsquo;t request a password reset, you can ignore this email. Your password won&rsquo;t be changed.</p>
  `
  return sendEmail({
    to,
    subject: 'Reset your password — Bobbinry',
    html: emailLayout(content),
    text: `Hey ${displayName}, reset your Bobbinry password. Visit: ${resetUrl} — This link expires in 1 hour. If you didn't request this, ignore this email.`,
  })
}

export async function sendWelcomeEmail(to: string, name?: string): Promise<boolean> {
  const displayName = name || 'there'
  const content = `
    <h1 style="margin:0 0 16px;font-family:${FONT_HEADING};font-size:24px;color:${COLORS.text};">Welcome to Bobbinry, ${escapeHtml(displayName)}!</h1>
    <p style="margin:0 0 8px;font-size:16px;color:${COLORS.text};line-height:24px;">Your account is ready. Here&rsquo;s what you can do:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;">
      <tr>
        <td style="padding:4px 12px 4px 0;font-size:16px;color:${COLORS.accent};font-weight:bold;vertical-align:top;">&bull;</td>
        <td style="padding:4px 0;font-size:15px;color:${COLORS.text};line-height:22px;"><strong>Create projects</strong> for your stories and worlds</td>
      </tr>
      <tr>
        <td style="padding:4px 12px 4px 0;font-size:16px;color:${COLORS.accent};font-weight:bold;vertical-align:top;">&bull;</td>
        <td style="padding:4px 0;font-size:15px;color:${COLORS.text};line-height:22px;"><strong>Install bobbins</strong> to extend your workflow</td>
      </tr>
      <tr>
        <td style="padding:4px 12px 4px 0;font-size:16px;color:${COLORS.accent};font-weight:bold;vertical-align:top;">&bull;</td>
        <td style="padding:4px 0;font-size:15px;color:${COLORS.text};line-height:22px;"><strong>Follow authors</strong> and discover new writing</td>
      </tr>
    </table>
    ${emailButton('Get started', 'https://bobbinry.com')}
  `
  return sendEmail({
    to,
    subject: 'Welcome to Bobbinry!',
    html: emailLayout(content),
    text: `Welcome to Bobbinry, ${displayName}! Your account is ready. Get started at https://bobbinry.com`,
  })
}

// ---------------------------------------------------------------------------
// Notification emails (with List-Unsubscribe headers + in-body unsubscribe)
// ---------------------------------------------------------------------------

export async function sendNewFollowerEmail(
  to: string,
  followerName: string,
  projectTitle: string,
  recipientUserId?: string
): Promise<boolean> {
  const footer = recipientUserId
    ? notificationFooter(recipientUserId, 'emailNewFollower')
    : undefined
  const content = `
    <h1 style="margin:0 0 16px;font-family:${FONT_HEADING};font-size:24px;color:${COLORS.text};">New follower!</h1>
    <p style="margin:0 0 8px;font-size:16px;color:${COLORS.text};line-height:24px;"><strong>${escapeHtml(followerName)}</strong> started following your project <strong>${escapeHtml(projectTitle)}</strong>.</p>
    ${emailButton('View dashboard', 'https://bobbinry.com/dashboard')}
  `

  const headers: Record<string, string> = {}
  if (recipientUserId) {
    const unsub = unsubscribeUrl(recipientUserId, 'emailNewFollower')
    headers['List-Unsubscribe'] = `<${unsub}>`
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }

  return sendEmail({
    to,
    subject: `${followerName} is now following "${projectTitle}"`,
    html: emailLayout(content, footer),
    text: `${followerName} started following your project "${projectTitle}". View your dashboard at https://bobbinry.com/dashboard`,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  })
}

// ---------------------------------------------------------------------------
// Admin daily report
// ---------------------------------------------------------------------------

import type { AdminDailyReport } from '../jobs/admin-daily-report'

export function buildAdminDailyReportHtml(report: AdminDailyReport): string {
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })

  // Build growth rows (only non-zero metrics)
  const growthMetrics: [number, string][] = [
    [report.newSignups, 'new sign-up' + (report.newSignups !== 1 ? 's' : '')],
    [report.newProjects, 'new project' + (report.newProjects !== 1 ? 's' : '') + ' created'],
    [report.chaptersFirstPublished, 'chapter' + (report.chaptersFirstPublished !== 1 ? 's' : '') + ' first published'],
    [report.newSubscriptions, 'new subscription' + (report.newSubscriptions !== 1 ? 's' : '')],
    [report.newSupporterMemberships, 'new supporter membership' + (report.newSupporterMemberships !== 1 ? 's' : '')],
    [report.newProjectFollows, 'new project follow' + (report.newProjectFollows !== 1 ? 's' : '')],
    [report.newUserFollows, 'new user follow' + (report.newUserFollows !== 1 ? 's' : '')],
  ]
  const growthRows = growthMetrics.filter(([n]) => n > 0)

  const hasErrors = report.failedPayments > 0 || report.failedSyncs > 0 || report.reportedUploads > 0

  let content = `
    <h1 style="margin:0 0 4px;font-family:${FONT_HEADING};font-size:24px;color:${COLORS.text};">Daily Report</h1>
    <p style="margin:0 0 20px;font-size:14px;color:${COLORS.muted};line-height:20px;">${dateStr}</p>
  `

  if (growthRows.length > 0) {
    content += `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">`
    for (const [count, label] of growthRows) {
      content += `
      <tr>
        <td style="padding:4px 12px 4px 0;font-size:16px;color:${COLORS.accent};font-weight:bold;vertical-align:top;">&bull;</td>
        <td style="padding:4px 0;font-size:15px;color:${COLORS.text};line-height:22px;"><strong>${count}</strong> ${escapeHtml(label)}</td>
      </tr>`
    }
    content += `</table>`

    // Reading stats as muted context line
    if (report.chapterViewsStarted > 0 || report.chapterReadsCompleted > 0) {
      const parts: string[] = []
      if (report.chapterViewsStarted > 0) parts.push(`${report.chapterViewsStarted} chapter view${report.chapterViewsStarted !== 1 ? 's' : ''}`)
      if (report.chapterReadsCompleted > 0) parts.push(`${report.chapterReadsCompleted} completed`)
      content += `<p style="margin:8px 0 0;font-size:13px;color:${COLORS.muted};line-height:20px;">${parts.join(', ')}</p>`
    }
  }

  if (hasErrors) {
    content += `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
      <tr><td style="border-top:1px solid ${COLORS.divider};padding-top:16px;">
        <h2 style="margin:0 0 12px;font-family:${FONT_HEADING};font-size:18px;color:${COLORS.accent};">Attention Needed</h2>
      </td></tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">`

    const errorMetrics: [number, string][] = [
      [report.failedPayments, 'failed payment' + (report.failedPayments !== 1 ? 's' : '')],
      [report.failedSyncs, 'failed sync' + (report.failedSyncs !== 1 ? 's' : '')],
      [report.reportedUploads, 'reported upload' + (report.reportedUploads !== 1 ? 's' : '')],
    ]
    for (const [count, label] of errorMetrics) {
      if (count > 0) {
        content += `
      <tr>
        <td style="padding:4px 12px 4px 0;font-size:16px;color:${COLORS.accent};font-weight:bold;vertical-align:top;">&bull;</td>
        <td style="padding:4px 0;font-size:15px;color:${COLORS.text};line-height:22px;"><strong>${count}</strong> ${escapeHtml(label)}</td>
      </tr>`
      }
    }
    content += `</table>`
  }

  content += emailButton('View Admin Dashboard', `${env.WEB_ORIGIN}/admin`)

  return emailLayout(content)
}

export function buildAdminDailyReportText(report: AdminDailyReport): string {
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })

  const lines: string[] = [`Bobbinry Daily Report — ${dateStr}`, '']

  const growthMetrics: [number, string][] = [
    [report.newSignups, 'new sign-up' + (report.newSignups !== 1 ? 's' : '')],
    [report.newProjects, 'new project' + (report.newProjects !== 1 ? 's' : '') + ' created'],
    [report.chaptersFirstPublished, 'chapter' + (report.chaptersFirstPublished !== 1 ? 's' : '') + ' first published'],
    [report.newSubscriptions, 'new subscription' + (report.newSubscriptions !== 1 ? 's' : '')],
    [report.newSupporterMemberships, 'new supporter membership' + (report.newSupporterMemberships !== 1 ? 's' : '')],
    [report.newProjectFollows, 'new project follow' + (report.newProjectFollows !== 1 ? 's' : '')],
    [report.newUserFollows, 'new user follow' + (report.newUserFollows !== 1 ? 's' : '')],
  ]
  const growthRows = growthMetrics.filter(([n]) => n > 0)
  if (growthRows.length > 0) {
    for (const [count, label] of growthRows) {
      lines.push(`• ${count} ${label}`)
    }
    if (report.chapterViewsStarted > 0 || report.chapterReadsCompleted > 0) {
      const parts: string[] = []
      if (report.chapterViewsStarted > 0) parts.push(`${report.chapterViewsStarted} chapter view${report.chapterViewsStarted !== 1 ? 's' : ''}`)
      if (report.chapterReadsCompleted > 0) parts.push(`${report.chapterReadsCompleted} completed`)
      lines.push(`  (${parts.join(', ')})`)
    }
  }

  const hasErrors = report.failedPayments > 0 || report.failedSyncs > 0 || report.reportedUploads > 0
  if (hasErrors) {
    lines.push('', 'ATTENTION NEEDED:')
    if (report.failedPayments > 0) lines.push(`• ${report.failedPayments} failed payment${report.failedPayments !== 1 ? 's' : ''}`)
    if (report.failedSyncs > 0) lines.push(`• ${report.failedSyncs} failed sync${report.failedSyncs !== 1 ? 's' : ''}`)
    if (report.reportedUploads > 0) lines.push(`• ${report.reportedUploads} reported upload${report.reportedUploads !== 1 ? 's' : ''}`)
  }

  lines.push('', `View dashboard: ${env.WEB_ORIGIN}/admin`)

  return lines.join('\n')
}

export async function sendNewChapterEmail(
  to: string | string[],
  authorName: string,
  projectTitle: string,
  chapterTitle: string,
  url: string,
  recipientUserId?: string
): Promise<boolean> {
  const fullUrl = url.startsWith('http') ? url : `${env.WEB_ORIGIN}${url}`
  const footer = recipientUserId
    ? notificationFooter(recipientUserId, 'emailNewChapter')
    : undefined
  const content = `
    <p style="margin:0 0 4px;font-size:14px;color:${COLORS.muted};line-height:20px;">New from <strong style="color:${COLORS.text};">${escapeHtml(authorName)}</strong> in <strong style="color:${COLORS.text};">${escapeHtml(projectTitle)}</strong></p>
    <h1 style="margin:0 0 16px;font-family:${FONT_HEADING};font-size:24px;color:${COLORS.text};">${escapeHtml(chapterTitle)}</h1>
    ${emailButton('Read now', fullUrl)}
  `

  const headers: Record<string, string> = {}
  if (recipientUserId) {
    const unsub = unsubscribeUrl(recipientUserId, 'emailNewChapter')
    headers['List-Unsubscribe'] = `<${unsub}>`
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }

  return sendEmail({
    to,
    subject: `New from ${authorName}: "${chapterTitle}"`,
    html: emailLayout(content, footer),
    text: `${authorName} published "${chapterTitle}" in ${projectTitle}. Read it at ${fullUrl}`,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  })
}
