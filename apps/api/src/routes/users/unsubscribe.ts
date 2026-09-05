/** One-click unsubscribe (RFC 8058) and confirmation page. Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { userNotificationPreferences } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { verifyUnsubscribeToken } from '../../lib/email'
import { escapeHtml } from '../../lib/text'

const unsubscribeRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // UNSUBSCRIBE (RFC 8058 one-click + GET confirmation page)
  // ============================================================================

  // POST /unsubscribe — one-click unsubscribe (RFC 8058)
  fastify.post<{
    Querystring: { token?: string }
    Body: { token?: string }
  }>('/unsubscribe', async (request, reply) => {
    const token = (request.query as Record<string, string>)?.token
      || (request.body as Record<string, string>)?.token
    if (!token) {
      return reply.status(400).send({ error: 'Missing token' })
    }

    const parsed = verifyUnsubscribeToken(token)
    if (!parsed) {
      return reply.status(400).send({ error: 'Invalid or expired token' })
    }

    const { userId, prefKey } = parsed

    // Validate prefKey is a real column
    const validKeys = ['emailNewChapter', 'emailNewFollower', 'emailNewSubscriber', 'emailNewComment', 'emailBetaReaderJoined']
    if (!validKeys.includes(prefKey)) {
      return reply.status(400).send({ error: 'Invalid preference key' })
    }

    try {
      const [existing] = await db
        .select()
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, userId))
        .limit(1)

      if (existing) {
        await db
          .update(userNotificationPreferences)
          .set({ [prefKey]: false, updatedAt: new Date() })
          .where(eq(userNotificationPreferences.userId, userId))
      } else {
        await db
          .insert(userNotificationPreferences)
          .values({ userId, [prefKey]: false })
      }

      return reply.status(200).send({ success: true })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update preferences' })
    }
  })

  // GET /unsubscribe — confirmation page
  fastify.get<{
    Querystring: { token?: string }
  }>('/unsubscribe', async (request, reply) => {
    const token = (request.query as Record<string, string>)?.token
    const parsed = token ? verifyUnsubscribeToken(token) : null

    const labelMap: Record<string, string> = {
      emailNewChapter: 'new chapter notifications',
      emailNewFollower: 'new follower notifications',
      emailNewSubscriber: 'new subscriber notifications',
      emailNewComment: 'new comment notifications',
      emailBetaReaderJoined: 'beta reader signup notifications',
    }

    let body: string
    if (!parsed) {
      body = `
        <h1 style="font-family:Georgia,serif;font-size:22px;color:#333;">Invalid link</h1>
        <p style="font-size:15px;color:#333;">This unsubscribe link is invalid or has expired.</p>
      `
    } else {
      const label = labelMap[parsed.prefKey] || 'these notifications'
      body = `
        <h1 style="font-family:Georgia,serif;font-size:22px;color:#333;">Unsubscribe</h1>
        <p style="font-size:15px;color:#333;line-height:24px;">Click the button below to stop receiving <strong>${label}</strong>.</p>
        <form method="POST" action="/api/unsubscribe?token=${encodeURIComponent(token!)}">
          <input type="hidden" name="token" value="${escapeHtml(token!)}">
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr>
              <td style="background-color:#33706b;border-radius:6px;padding:14px 28px;">
                <button type="submit" style="background:none;border:none;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;cursor:pointer;">Unsubscribe</button>
              </td>
            </tr>
          </table>
        </form>
        <p style="font-size:13px;color:#888;">You can re-enable notifications anytime in your <a href="https://bobbinry.com/settings/notifications" style="color:#33706b;">notification settings</a>.</p>
      `
    }

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Unsubscribe — Bobbinry</title></head>
<body style="margin:0;padding:0;background-color:#faf8f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf8f4;">
    <tr><td align="center" style="padding:48px 16px;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
        <tr><td style="background-color:#33706b;padding:20px 32px;border-radius:8px 8px 0 0;">
          <span style="font-family:Georgia,serif;font-size:22px;font-weight:bold;color:#fff;">Bobbinry</span>
        </td></tr>
        <tr><td style="background-color:#fff;padding:32px;border:1px solid #e8e4de;border-top:none;border-radius:0 0 8px 8px;">
          ${body}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

    return reply.status(200).header('content-type', 'text/html; charset=utf-8').send(html)
  })
}

export default unsubscribeRoutes
