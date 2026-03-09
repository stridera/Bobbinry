/**
 * Email Client (Resend)
 *
 * Transactional email sending for notifications, welcome emails, etc.
 * No-ops gracefully when RESEND_API_KEY is not configured (local dev).
 */

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

interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
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
    })
    return true
  } catch (err) {
    console.error('[email] Failed to send:', (err as Error).message)
    return false
  }
}

export async function sendVerificationEmail(to: string, token: string, name?: string): Promise<boolean> {
  const displayName = name || 'there'
  const verifyUrl = `${env.WEB_ORIGIN}/verify-email?token=${token}`
  return sendEmail({
    to,
    subject: 'Verify your email — Bobbinry',
    html: `
      <h1>Hey ${escapeHtml(displayName)}, verify your email</h1>
      <p>Thanks for signing up for Bobbinry! Please verify your email address to unlock all features.</p>
      <p><a href="${verifyUrl}">Verify my email &rarr;</a></p>
      <p>This link expires in 24 hours.</p>
      <p style="color: #888; font-size: 12px;">If you didn't create a Bobbinry account, you can ignore this email.</p>
    `,
    text: `Hey ${displayName}, verify your email to unlock all features on Bobbinry. Visit: ${verifyUrl} — This link expires in 24 hours.`,
  })
}

export async function sendWelcomeEmail(to: string, name?: string): Promise<boolean> {
  const displayName = name || 'there'
  return sendEmail({
    to,
    subject: 'Welcome to Bobbinry!',
    html: `
      <h1>Welcome to Bobbinry, ${escapeHtml(displayName)}!</h1>
      <p>Your account is ready. Start creating projects, installing bobbins, and building your worlds.</p>
      <p><a href="https://bobbinry.com">Get started &rarr;</a></p>
    `,
    text: `Welcome to Bobbinry, ${displayName}! Your account is ready. Get started at https://bobbinry.com`,
  })
}

export async function sendNewFollowerEmail(
  to: string,
  followerName: string,
  projectTitle: string
): Promise<boolean> {
  return sendEmail({
    to,
    subject: `${followerName} is now following "${projectTitle}"`,
    html: `
      <p><strong>${escapeHtml(followerName)}</strong> started following your project <strong>${escapeHtml(projectTitle)}</strong>.</p>
      <p><a href="https://bobbinry.com">View your dashboard &rarr;</a></p>
    `,
    text: `${followerName} started following your project "${projectTitle}". View your dashboard at https://bobbinry.com`,
  })
}

export async function sendNewChapterEmail(
  to: string | string[],
  authorName: string,
  projectTitle: string,
  chapterTitle: string,
  url: string
): Promise<boolean> {
  return sendEmail({
    to,
    subject: `New from ${authorName}: "${chapterTitle}"`,
    html: `
      <p><strong>${escapeHtml(authorName)}</strong> published a new chapter in <strong>${escapeHtml(projectTitle)}</strong>:</p>
      <h2>${escapeHtml(chapterTitle)}</h2>
      <p><a href="${url}">Read now &rarr;</a></p>
    `,
    text: `${authorName} published "${chapterTitle}" in ${projectTitle}. Read it at ${url}`,
  })
}
