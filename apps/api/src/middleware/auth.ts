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
import { eq } from 'drizzle-orm'

// User context attached to authenticated requests
export interface AuthenticatedUser {
  id: string
  email: string
  name: string | null
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
function getJwtSecret(): Uint8Array {
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

  // Verify user exists in database
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name
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

  // Attach user to request
  request.user = user
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

  // Try to get user from database
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name
    })
    .from(users)
    .where(eq(users.id, tokenPayload.id))
    .limit(1)

  if (user) {
    request.user = user
  }
}

/**
 * Project ownership authorization helper
 *
 * Verifies the authenticated user owns the specified project.
 * Must be called after requireAuth middleware.
 */
export async function requireProjectOwnership(
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string
): Promise<boolean> {
  if (!request.user) {
    reply.status(401).send({ error: 'Authentication required' })
    return false
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(projectId)) {
    reply.status(400).send({ error: 'Invalid project ID format' })
    return false
  }

  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
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
