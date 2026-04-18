/**
 * RSS Feed Token Management Routes
 *
 * Per-user tokens embedded in RSS feed URLs so subscribers can receive
 * subscriber-only / early-access content in their feed reader. Separate from
 * API keys because they live in URLs (leak differently) and are scope-free
 * (feed reading only).
 */

import { FastifyInstance } from 'fastify'
import { createHash, randomBytes } from 'crypto'
import { db } from '../db/connection'
import { rssFeedTokens } from '../db/schema'
import { eq, and, isNull, desc, sql } from 'drizzle-orm'
import { requireAuth, requireVerified, denyApiKeyAuth } from '../middleware/auth'

const RSS_TOKEN_LIMIT_PER_USER = 10
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function toBase62(bytes: Buffer): string {
  let result = ''
  for (const byte of bytes) {
    result += BASE62[byte % 62]
  }
  return result
}

export function hashRssToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export default async function rssTokensPlugin(fastify: FastifyInstance) {
  /**
   * Create a new RSS feed token.
   * POST /rss-tokens
   * Returns the plaintext token exactly once.
   */
  fastify.post<{
    Body: { label?: string }
  }>('/rss-tokens', {
    preHandler: [requireAuth, requireVerified, denyApiKeyAuth]
  }, async (request, reply) => {
    const userId = request.user!.id
    const label = request.body?.label?.trim() || null
    if (label && label.length > 100) {
      return reply.status(400).send({ error: 'Label must be 100 characters or fewer' })
    }

    const [{ count: existing = 0 } = {}] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rssFeedTokens)
      .where(and(eq(rssFeedTokens.userId, userId), isNull(rssFeedTokens.revokedAt)))

    if (existing >= RSS_TOKEN_LIMIT_PER_USER) {
      return reply.status(403).send({
        error: 'RSS token limit reached',
        message: `You can have at most ${RSS_TOKEN_LIMIT_PER_USER} active RSS tokens`
      })
    }

    const rawBytes = randomBytes(32)
    const token = 'bby_rss_' + toBase62(rawBytes)
    const tokenHash = hashRssToken(token)

    const [row] = await db
      .insert(rssFeedTokens)
      .values({ userId, label, tokenHash })
      .returning({ id: rssFeedTokens.id, label: rssFeedTokens.label, createdAt: rssFeedTokens.createdAt })

    return reply.status(201).send({
      id: row!.id,
      label: row!.label,
      createdAt: row!.createdAt,
      token,
      warning: 'Store this token now — it will not be shown again.'
    })
  })

  /**
   * List the caller's active RSS tokens (metadata only, no plaintext).
   * GET /rss-tokens
   */
  fastify.get('/rss-tokens', {
    preHandler: [requireAuth, denyApiKeyAuth]
  }, async (request, _reply) => {
    const userId = request.user!.id
    const rows = await db
      .select({
        id: rssFeedTokens.id,
        label: rssFeedTokens.label,
        lastUsedAt: rssFeedTokens.lastUsedAt,
        createdAt: rssFeedTokens.createdAt,
      })
      .from(rssFeedTokens)
      .where(and(eq(rssFeedTokens.userId, userId), isNull(rssFeedTokens.revokedAt)))
      .orderBy(desc(rssFeedTokens.createdAt))
    return { tokens: rows }
  })

  /**
   * Revoke an RSS token.
   * DELETE /rss-tokens/:tokenId
   */
  fastify.delete<{
    Params: { tokenId: string }
  }>('/rss-tokens/:tokenId', {
    preHandler: [requireAuth, denyApiKeyAuth]
  }, async (request, reply) => {
    const userId = request.user!.id
    const { tokenId } = request.params

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(tokenId)) {
      return reply.status(400).send({ error: 'Invalid token ID format' })
    }

    const result = await db
      .update(rssFeedTokens)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(rssFeedTokens.id, tokenId),
        eq(rssFeedTokens.userId, userId),
        isNull(rssFeedTokens.revokedAt)
      ))
      .returning({ id: rssFeedTokens.id })

    if (result.length === 0) {
      return reply.status(404).send({ error: 'Token not found' })
    }

    return reply.send({ success: true })
  })
}
