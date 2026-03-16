/**
 * Authentication Middleware for API Routes
 *
 * Validates JWT tokens from NextAuth and extracts user context.
 * Uses the same secret as NextAuth to verify tokens.
 */

import { FastifyRequest, FastifyReply } from 'fastify'
import * as jose from 'jose'
import { db } from '../db/connection'
import { users, projects } from '../db/schema'
import { eq, and, isNull, isNotNull } from 'drizzle-orm'
import { getUserBadges } from '../lib/membership'

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

// Extend FastifyRequest to include user
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser
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
 * Authentication middleware - requires valid JWT token
 *
 * Extracts user from JWT and attaches to request.user
 * Returns 401 if token is missing or invalid.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = extractBearerToken(request)

  if (!token) {
    reply.status(401).send({
      error: 'Authentication required',
      message: 'Missing or invalid Authorization header'
    })
    return
  }

  const tokenPayload = await verifyToken(token)

  if (!tokenPayload) {
    reply.status(401).send({
      error: 'Authentication required',
      message: 'Invalid or expired token'
    })
    return
  }

  // Check cache first, then fall back to DB
  const cached = getCachedUser(tokenPayload.id)
  if (cached) {
    request.user = cached
    return
  }

  // Verify user exists in database
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

  if (!user) {
    reply.status(401).send({
      error: 'Authentication required',
      message: 'User not found'
    })
    return
  }

  cacheUser(user)
  request.user = user
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
  const token = extractBearerToken(request)

  if (!token) {
    return // No token is fine for optional auth
  }

  const tokenPayload = await verifyToken(token)

  if (!tokenPayload) {
    return // Invalid token is also fine for optional auth
  }

  // Check cache first, then fall back to DB
  const cached = getCachedUser(tokenPayload.id)
  if (cached) {
    request.user = cached
    return
  }

  // Try to get user from database
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

  if (user) {
    cacheUser(user)
    request.user = user
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
