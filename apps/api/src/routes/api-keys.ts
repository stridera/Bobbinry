/**
 * API Key Management Routes
 *
 * Create, list, and revoke API keys for programmatic access.
 * All endpoints require session (JWT) auth — API keys cannot manage themselves.
 */

import { FastifyInstance } from 'fastify'
import { randomBytes } from 'crypto'
import { db } from '../db/connection'
import { apiKeys } from '../db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { requireAuth, requireVerified, denyApiKeyAuth, hashApiKey, clearApiKeyCache } from '../middleware/auth'
import { getUserMembershipTier } from '../lib/membership'

const VALID_SCOPES = ['projects:read', 'entities:read', 'stats:read', 'profile:read'] as const
const FREE_KEY_LIMIT = 5
const SUPPORTER_KEY_LIMIT = 10

// Base62 alphabet for key generation
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function toBase62(bytes: Buffer): string {
  let result = ''
  for (const byte of bytes) {
    result += BASE62[byte % 62]
  }
  return result
}

export default async function apiKeysPlugin(fastify: FastifyInstance) {
  /**
   * Create a new API key
   * POST /api-keys
   */
  fastify.post<{
    Body: {
      name: string
      scopes: string[]
      expiresInDays?: number
    }
  }>('/api-keys', {
    preHandler: [requireAuth, requireVerified, denyApiKeyAuth]
  }, async (request, reply) => {
    try {
      const { name, scopes, expiresInDays } = request.body
      const userId = request.user!.id

      // Validate name
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.status(400).send({ error: 'Name is required' })
      }
      if (name.length > 100) {
        return reply.status(400).send({ error: 'Name must be 100 characters or fewer' })
      }

      // Validate scopes
      if (!Array.isArray(scopes) || scopes.length === 0) {
        return reply.status(400).send({ error: 'At least one scope is required' })
      }
      const invalidScopes = scopes.filter(s => !VALID_SCOPES.includes(s as any))
      if (invalidScopes.length > 0) {
        return reply.status(400).send({
          error: `Invalid scopes: ${invalidScopes.join(', ')}`,
          validScopes: VALID_SCOPES
        })
      }
      // Deduplicate
      const uniqueScopes = [...new Set(scopes)]

      // Check key limit by membership tier
      const tier = await getUserMembershipTier(userId)
      const keyLimit = tier === 'supporter' ? SUPPORTER_KEY_LIMIT : FREE_KEY_LIMIT

      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(apiKeys)
        .where(and(
          eq(apiKeys.userId, userId),
          isNull(apiKeys.revokedAt)
        ))
      const existingCount = result[0]?.count ?? 0

      if (existingCount >= keyLimit) {
        return reply.status(403).send({
          error: 'API key limit reached',
          message: `You can have at most ${keyLimit} active API keys (${tier} tier)`
        })
      }

      // Generate the key: bby_ + base62(32 random bytes)
      const rawBytes = randomBytes(32)
      const fullKey = 'bby_' + toBase62(rawBytes)
      const keyPrefix = fullKey.slice(0, 8) // "bby_Ab3x"
      const keyHash = hashApiKey(fullKey)

      // Compute expiry
      const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null

      const [created] = await db
        .insert(apiKeys)
        .values({
          userId,
          name: name.trim(),
          keyPrefix,
          keyHash,
          scopes: uniqueScopes,
          expiresAt,
        })
        .returning({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPrefix: apiKeys.keyPrefix,
          scopes: apiKeys.scopes,
          expiresAt: apiKeys.expiresAt,
          createdAt: apiKeys.createdAt,
        })

      return reply.status(201).send({
        key: fullKey, // shown only once
        id: created!.id,
        name: created!.name,
        keyPrefix: created!.keyPrefix,
        scopes: created!.scopes,
        expiresAt: created!.expiresAt,
        createdAt: created!.createdAt,
      })
    } catch (error) {
      fastify.log.error(error, 'Failed to create API key')
      return reply.status(500).send({ error: 'Failed to create API key' })
    }
  })

  /**
   * List active API keys (no hash or full key returned)
   * GET /api-keys
   */
  fastify.get('/api-keys', {
    preHandler: [requireAuth, denyApiKeyAuth]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id

      const keys = await db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPrefix: apiKeys.keyPrefix,
          scopes: apiKeys.scopes,
          lastUsedAt: apiKeys.lastUsedAt,
          expiresAt: apiKeys.expiresAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(and(
          eq(apiKeys.userId, userId),
          isNull(apiKeys.revokedAt)
        ))
        .orderBy(apiKeys.createdAt)

      return reply.send({ keys })
    } catch (error) {
      fastify.log.error(error, 'Failed to list API keys')
      return reply.status(500).send({ error: 'Failed to list API keys' })
    }
  })

  /**
   * Revoke an API key
   * DELETE /api-keys/:keyId
   */
  fastify.delete<{
    Params: { keyId: string }
  }>('/api-keys/:keyId', {
    preHandler: [requireAuth, denyApiKeyAuth]
  }, async (request, reply) => {
    try {
      const userId = request.user!.id
      const { keyId } = request.params

      // UUID validation
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (!uuidRegex.test(keyId)) {
        return reply.status(400).send({ error: 'Invalid key ID format' })
      }

      // Find the key (must belong to user and not already revoked)
      const [key] = await db
        .select({ id: apiKeys.id, keyHash: apiKeys.keyHash })
        .from(apiKeys)
        .where(and(
          eq(apiKeys.id, keyId),
          eq(apiKeys.userId, userId),
          isNull(apiKeys.revokedAt)
        ))
        .limit(1)

      if (!key) {
        return reply.status(404).send({ error: 'API key not found' })
      }

      // Revoke it
      await db
        .update(apiKeys)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(apiKeys.id, keyId))

      // Clear from cache
      clearApiKeyCache(key.keyHash)

      return reply.send({ success: true })
    } catch (error) {
      fastify.log.error(error, 'Failed to revoke API key')
      return reply.status(500).send({ error: 'Failed to revoke API key' })
    }
  })
}
