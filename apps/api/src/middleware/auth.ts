/**
 * Authentication Middleware for API Routes
 *
 * Validates JWT tokens from NextAuth and extracts user context.
 * Uses the same secret as NextAuth to verify tokens.
 * Also supports API key authentication (bby_ prefix).
 */

import { FastifyRequest, FastifyReply } from 'fastify'
import * as jose from 'jose'
import { createHash } from 'crypto'
import { db } from '../db/connection'
import { users, projects, apiKeys } from '../db/schema'
import { eq, and, isNull, isNotNull, or } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { getUserBadges, getUserMembershipTier, type MembershipTier } from '../lib/membership'

// User context attached to authenticated requests
export interface AuthenticatedUser {
  id: string
  email: string
  name: string | null
  emailVerified: Date | null
}

// In-memory auth user cache (60s TTL) to avoid redundant DB lookups
const AUTH_CACHE_TTL_MS = 60_000
const userCache = new Map<string, { user: AuthenticatedUser; expiresAt: number }>()

function getCachedUser(userId: string): AuthenticatedUser | null {
  const entry = userCache.get(userId)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    userCache.delete(userId)
    return null
  }
  return entry.user
}

function cacheUser(user: AuthenticatedUser): void {
  userCache.set(user.id, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS })
}

/** Clear cached user entry (e.g. on password change, account deletion) */
export function clearUserCache(userId: string): void {
  userCache.delete(userId)
}

// API key cache (60s TTL) keyed by key hash
const API_KEY_CACHE_TTL_MS = 60_000
const apiKeyCache = new Map<string, { userId: string; scopes: string[]; tier: MembershipTier; expiresAt: number }>()

function getCachedApiKey(keyHash: string): { userId: string; scopes: string[]; tier: MembershipTier } | null {
  const entry = apiKeyCache.get(keyHash)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    apiKeyCache.delete(keyHash)
    return null
  }
  return { userId: entry.userId, scopes: entry.scopes, tier: entry.tier }
}

function cacheApiKey(keyHash: string, userId: string, scopes: string[], tier: MembershipTier): void {
  apiKeyCache.set(keyHash, { userId, scopes, tier, expiresAt: Date.now() + API_KEY_CACHE_TTL_MS })
}

/** Clear cached API key entry (e.g. on revocation) */
export function clearApiKeyCache(keyHash: string): void {
  apiKeyCache.delete(keyHash)
}

/** Get cached API key tier for rate limiting (avoids DB lookup in hot path) */
export function getApiKeyTier(keyHash: string): MembershipTier | null {
  const cached = getCachedApiKey(keyHash)
  return cached?.tier ?? null
}

/** Hash a raw API key token with SHA-256 */
export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Extend FastifyRequest to include user and API key info
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser
    apiKeyAuth?: boolean
    apiKeyScopes?: string[]
  }
}

/**
 * Get the JWT secret for token verification.
 * Uses NEXTAUTH_SECRET (same as shell) or API_JWT_SECRET as fallback.
 */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET || process.env.API_JWT_SECRET

  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT secret must be configured in production (NEXTAUTH_SECRET or API_JWT_SECRET)')
  }

  // Use a development-only secret if not configured (matches shell's auth.ts)
  const effectiveSecret = secret || 'development-secret-only-for-local-dev'

  return new TextEncoder().encode(effectiveSecret)
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization

  if (!authHeader) {
    return null
  }

  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
    return null
  }

  return parts[1] || null
}

/**
 * Verify and decode a JWT token
 */
async function verifyToken(token: string): Promise<{ id: string; email?: string; name?: string } | null> {
  try {
    const secret = getJwtSecret()

    // NextAuth uses HS256 by default
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: ['HS256']
    })

    // NextAuth stores user ID in 'id' or 'sub' claim
    const userId = payload.id as string || payload.sub as string

    if (!userId) {
      return null
    }

    const result: { id: string; email?: string; name?: string } = { id: userId }

    if (payload.email) {
      result.email = payload.email as string
    }
    if (payload.name) {
      result.name = payload.name as string
    }

    return result
  } catch {
    // Token is invalid, expired, or has wrong signature
    return null
  }
}

/**
 * Resolve an API key token to a user and scopes.
 * Returns null if the token is not a valid API key.
 */
async function resolveApiKey(token: string): Promise<{ user: AuthenticatedUser; scopes: string[] } | null> {
  if (!token.startsWith('bby_')) return null

  const keyHash = hashApiKey(token)

  // Check cache first
  const cached = getCachedApiKey(keyHash)
  if (cached) {
    const user = getCachedUser(cached.userId)
    if (user) {
      // Fire-and-forget lastUsedAt update
      db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.keyHash, keyHash)).catch(() => {})
      return { user, scopes: cached.scopes }
    }
  }

  // Query API key from DB
  const [key] = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      scopes: apiKeys.scopes,
    })
    .from(apiKeys)
    .where(and(
      eq(apiKeys.keyHash, keyHash),
      isNull(apiKeys.revokedAt),
      or(isNull(apiKeys.expiresAt), sql`${apiKeys.expiresAt} > NOW()`)
    ))
    .limit(1)

  if (!key) return null

  // Look up the user
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.id, key.userId))
    .limit(1)

  if (!user) return null

  // Get membership tier for rate limiting cache
  const tier = await getUserMembershipTier(user.id)

  // Cache both the key and user
  cacheUser(user)
  cacheApiKey(keyHash, user.id, key.scopes, tier)

  // Fire-and-forget lastUsedAt update
  db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.keyHash, keyHash)).catch(() => {})

  return { user, scopes: key.scopes }
}

/**
 * Shared logic for authenticating a request via JWT or API key.
 * Returns the user and whether auth succeeded, or null if no valid auth found.
 */
async function authenticateRequest(request: FastifyRequest): Promise<{ user: AuthenticatedUser } | null> {
  const token = extractBearerToken(request)
  if (!token) return null

  // Try API key first (fast prefix check)
  if (token.startsWith('bby_')) {
    const result = await resolveApiKey(token)
    if (!result) return null
    request.apiKeyAuth = true
    request.apiKeyScopes = result.scopes
    return { user: result.user }
  }

  // Fall back to JWT
  const tokenPayload = await verifyToken(token)
  if (!tokenPayload) return null

  // Check cache first, then fall back to DB
  const cached = getCachedUser(tokenPayload.id)
  if (cached) {
    request.apiKeyAuth = false
    return { user: cached }
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.id, tokenPayload.id))
    .limit(1)

  if (!user) return null

  cacheUser(user)
  request.apiKeyAuth = false
  return { user }
}

/**
 * Authentication middleware - requires valid JWT token or API key
 *
 * Extracts user from JWT/API key and attaches to request.user
 * Returns 401 if token is missing or invalid.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const result = await authenticateRequest(request)

  if (!result) {
    reply.status(401).send({
      error: 'Authentication required',
      message: 'Missing or invalid Authorization header'
    })
    return
  }

  request.user = result.user
}

/**
 * Email verification middleware - requires verified email
 *
 * Must be used after requireAuth. Returns 403 if user's email is not verified.
 */
export async function requireVerified(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    reply.status(401).send({
      error: 'Authentication required',
      message: 'Missing or invalid Authorization header'
    })
    return
  }

  if (!request.user.emailVerified) {
    reply.status(403).send({
      error: 'Email not verified',
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email address to use this feature'
    })
    return
  }
}

/**
 * Owner authorization middleware - requires 'owner' badge
 *
 * Must be used after requireAuth. Returns 403 if user doesn't have the 'owner' badge.
 */
export async function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    reply.status(401).send({
      error: 'Authentication required',
      message: 'Missing or invalid Authorization header'
    })
    return
  }

  const badges = await getUserBadges(request.user.id)
  if (!badges.includes('owner')) {
    reply.status(403).send({
      error: 'Forbidden',
      message: 'Owner access required'
    })
    return
  }
}

/**
 * Optional authentication middleware
 *
 * Extracts user if token is present but doesn't require it.
 * Useful for routes that work differently for authenticated vs anonymous users.
 */
export async function optionalAuth(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const result = await authenticateRequest(request)
  if (result) {
    request.user = result.user
  }
}

/**
 * Scope enforcement middleware factory.
 * If the request is authenticated via API key, checks that the key has the required scope.
 * JWT requests pass through (all scopes implicit).
 */
export function requireScope(scope: string) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (request.apiKeyAuth && request.apiKeyScopes && !request.apiKeyScopes.includes(scope)) {
      reply.status(403).send({
        error: 'Insufficient scope',
        message: `This API key does not have the '${scope}' scope`
      })
    }
  }
}

/**
 * Deny API key authentication middleware.
 * Use on sensitive endpoints that require session (JWT) auth only.
 */
export async function denyApiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (request.apiKeyAuth) {
    reply.status(403).send({
      error: 'Session auth required',
      message: 'This endpoint requires session authentication and cannot be accessed with an API key'
    })
  }
}

/**
 * Read-only enforcement for API key requests.
 * Blocks non-GET/HEAD methods when the Authorization header carries an API key.
 * Checks the raw header prefix so it can run as an onRequest hook (before auth resolves).
 * Safety net for Phase 1 (read-only API keys).
 */
export async function requireReadOnly(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return
  const authHeader = request.headers.authorization
  if (!authHeader) return
  const token = authHeader.split(' ')[1]
  if (token?.startsWith('bby_')) {
    reply.status(403).send({
      error: 'Read-only access',
      message: 'API keys only support read operations'
    })
  }
}

/**
 * Internal helper for project ownership checks.
 * @param deletedOnly - if true, matches only trashed projects; if false, only active ones.
 */
async function checkProjectOwnership(
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string,
  deletedOnly: boolean
): Promise<boolean> {
  if (!request.user) {
    reply.status(401).send({ error: 'Authentication required' })
    return false
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID format' })
    return false
  }

  const deletedFilter = deletedOnly ? isNotNull(projects.deletedAt) : isNull(projects.deletedAt)
  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(and(eq(projects.id, projectId), deletedFilter))
    .limit(1)

  if (!project) {
    reply.status(404).send({ error: 'Project not found' })
    return false
  }

  if (project.ownerId !== request.user.id) {
    reply.status(403).send({
      error: 'Forbidden',
      message: 'You do not have permission to access this project'
    })
    return false
  }

  return true
}

/** Verifies the authenticated user owns the specified active (non-trashed) project. */
export async function requireProjectOwnership(
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string
): Promise<boolean> {
  return checkProjectOwnership(request, reply, projectId, false)
}

/** Same as requireProjectOwnership but only matches trashed (soft-deleted) projects. */
export async function requireDeletedProjectOwnership(
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string
): Promise<boolean> {
  return checkProjectOwnership(request, reply, projectId, true)
}

/**
 * User self-authorization helper
 *
 * Verifies the authenticated user is accessing their own data.
 * Must be called after requireAuth middleware.
 */
export function requireSelf(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string
): boolean {
  if (!request.user) {
    reply.status(401).send({ error: 'Authentication required' })
    return false
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(userId)) {
    reply.status(400).send({ error: 'Invalid user ID format' })
    return false
  }

  if (request.user.id !== userId) {
    reply.status(403).send({
      error: 'Forbidden',
      message: 'You can only access your own data'
    })
    return false
  }

  return true
}
