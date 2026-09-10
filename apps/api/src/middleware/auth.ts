/**
 * Authentication Middleware for API Routes
 *
 * Validates JWT tokens from NextAuth and extracts user context.
 * Uses the same secret as NextAuth to verify tokens.
 * Also supports API key authentication (bby_ prefix).
 */

import { FastifyRequest, FastifyReply, RouteOptions } from 'fastify'
import * as jose from 'jose'
import { createHash } from 'crypto'
import { db } from '../db/connection'
import { users, projects, apiKeys } from '../db/schema'
import { eq, and, isNull, isNotNull, or } from 'drizzle-orm'
import type { PgTable, AnyPgColumn } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { getUserBadges, getUserMembershipTier, type MembershipTier } from '../lib/membership'
import { isUuid } from '../lib/slugs'
import { env } from '../lib/env'

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

// API key cache keyed by key hash. Short TTL so revocation on one instance
// propagates to peer instances within a few seconds (clearApiKeyCache only
// clears the local Map).
const API_KEY_CACHE_TTL_MS = 5_000
const apiKeyCache = new Map<string, { keyId: string; userId: string; scopes: string[]; projectId: string | null; tier: MembershipTier; expiresAt: number }>()

function getCachedApiKey(keyHash: string): { keyId: string; userId: string; scopes: string[]; projectId: string | null; tier: MembershipTier } | null {
  const entry = apiKeyCache.get(keyHash)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    apiKeyCache.delete(keyHash)
    return null
  }
  return { keyId: entry.keyId, userId: entry.userId, scopes: entry.scopes, projectId: entry.projectId, tier: entry.tier }
}

function cacheApiKey(keyHash: string, keyId: string, userId: string, scopes: string[], projectId: string | null, tier: MembershipTier): void {
  apiKeyCache.set(keyHash, { keyId, userId, scopes, projectId, tier, expiresAt: Date.now() + API_KEY_CACHE_TTL_MS })
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
    // Which key, not just which user. Revision capture buckets a writing
    // session per actor: without this, a sync bot's writes would fold into the
    // human's open session and destroy the pre-bot snapshot — the single most
    // valuable restore point in that scenario.
    apiKeyId?: string
    apiKeyScopes?: string[]
    // When set, the API key is restricted to a single project.
    apiKeyProjectId?: string | null
    // Row loaded and authorised by an `ownsResolvedProject` preHandler.
    ownedRow?: unknown
  }

  interface FastifyContextConfig {
    // Set by hand only for 'in-handler' routes and optionalAuth routes; the
    // guards in a preHandler list declare it otherwise (declareApiKeyPolicy).
    apiKey?: ApiKeyPolicy
  }
}

/**
 * How a route treats `bby_` API keys. Keys are default-deny: a route that
 * declares nothing is session-only, so a new route cannot quietly widen what
 * an existing key can do.
 * - `false`: session only (what `denyApiKeyAuth` declares).
 * - `{ scope }`: keys holding that scope (what `requireScope` declares). On an
 *   optionalAuth route, any other key is served as anonymous.
 * - `'in-handler'`: any key; the handler calls `assertEntityScope` for the
 *   collection it touches, which isn't known until the request is read.
 */
export type ApiKeyPolicy = false | 'in-handler' | { scope: string }

/**
 * Get the JWT secret for token verification.
 * Uses NEXTAUTH_SECRET (same as shell) or API_JWT_SECRET as fallback.
 *
 * Requires an explicit secret in every environment (not just production) —
 * the previous hardcoded fallback meant a misconfigured staging or test
 * deployment ran with a publicly-known secret, letting anyone forge JWTs.
 */
export function getJwtSecret(): Uint8Array {
  const secret = env.NEXTAUTH_SECRET || env.API_JWT_SECRET

  if (!secret) {
    throw new Error('JWT secret must be configured (NEXTAUTH_SECRET or API_JWT_SECRET)')
  }

  return new TextEncoder().encode(secret)
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
async function resolveApiKey(token: string): Promise<{ user: AuthenticatedUser; keyId: string; scopes: string[]; projectId: string | null } | null> {
  if (!token.startsWith('bby_')) return null

  const keyHash = hashApiKey(token)

  // Check cache first
  const cached = getCachedApiKey(keyHash)
  if (cached) {
    const user = getCachedUser(cached.userId)
    if (user) {
      // Fire-and-forget lastUsedAt update
      db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.keyHash, keyHash)).catch(() => {})
      return { user, keyId: cached.keyId, scopes: cached.scopes, projectId: cached.projectId }
    }
  }

  // Query API key from DB
  const [key] = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      scopes: apiKeys.scopes,
      projectId: apiKeys.projectId,
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
  cacheApiKey(keyHash, key.id, user.id, key.scopes, key.projectId, tier)

  // Fire-and-forget lastUsedAt update
  db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.keyHash, keyHash)).catch(() => {})

  return { user, keyId: key.id, scopes: key.scopes, projectId: key.projectId }
}

interface Authentication {
  user: AuthenticatedUser
  // Present when the bearer token was an API key rather than a session JWT.
  apiKey?: { id: string; scopes: string[]; projectId: string | null }
}

/**
 * Resolve the request's bearer token (API key or JWT) to a user, or null if
 * there is no valid one. Attaches nothing: the caller first decides whether
 * the route admits an API key at all.
 */
async function authenticateRequest(request: FastifyRequest): Promise<Authentication | null> {
  const token = extractBearerToken(request)
  if (!token) return null

  // Try API key first (fast prefix check)
  if (token.startsWith('bby_')) {
    const result = await resolveApiKey(token)
    if (!result) return null
    return { user: result.user, apiKey: { id: result.keyId, scopes: result.scopes, projectId: result.projectId } }
  }

  // Fall back to JWT
  const tokenPayload = await verifyToken(token)
  if (!tokenPayload) return null

  // Check cache first, then fall back to DB
  const cached = getCachedUser(tokenPayload.id)
  if (cached) return { user: cached }

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
  return { user }
}

function attachAuthentication(request: FastifyRequest, { user, apiKey }: Authentication): void {
  request.user = user
  request.apiKeyAuth = apiKey !== undefined
  if (apiKey) {
    request.apiKeyId = apiKey.id
    request.apiKeyScopes = apiKey.scopes
    request.apiKeyProjectId = apiKey.projectId
  }
}

const SESSION_ONLY = {
  error: 'Session auth required',
  message: 'This endpoint requires session authentication and cannot be accessed with an API key'
}

function insufficientScope(scope: string) {
  return { error: 'Insufficient scope', message: `This API key does not have the '${scope}' scope` }
}

/** Why this route refuses an API key holding `scopes`, or null if it admits it. */
function apiKeyRefusal(request: FastifyRequest, scopes: string[]): { error: string; message: string } | null {
  const policy = request.routeOptions.config.apiKey
  if (!policy) return SESSION_ONLY
  if (policy === 'in-handler' || scopes.includes(policy.scope)) return null
  return insufficientScope(policy.scope)
}

/**
 * Authentication middleware - requires valid JWT token or API key
 *
 * Extracts user from JWT/API key and attaches to request.user
 * Returns 401 if token is missing or invalid, and 403 for an API key the
 * route does not admit (see ApiKeyPolicy).
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const auth = await authenticateRequest(request)

  if (!auth) {
    reply.status(401).send({
      error: 'Authentication required',
      message: 'Missing or invalid Authorization header'
    })
    return
  }

  if (auth.apiKey) {
    const refusal = apiKeyRefusal(request, auth.apiKey.scopes)
    if (refusal) {
      reply.status(403).send(refusal)
      return
    }
  }

  attachAuthentication(request, auth)
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
  const auth = await authenticateRequest(request)
  // A key the route doesn't admit carries no identity here: the caller is
  // served as anonymous, exactly as if the header were absent.
  if (!auth || (auth.apiKey && apiKeyRefusal(request, auth.apiKey.scopes))) return
  attachAuthentication(request, auth)
}

// Guards made by requireScope, by the scope each checks, so
// declareApiKeyPolicy can read a route's scope off its preHandler list.
const scopeGuards = new WeakMap<object, string>()

/**
 * Scope enforcement middleware factory.
 * If the request is authenticated via API key, checks that the key has the required scope.
 * JWT requests pass through (all scopes implicit). Also declares the route's
 * ApiKeyPolicy, which is what lets a key reach the route at all.
 */
export function requireScope(scope: string) {
  const guard = async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (request.apiKeyAuth && request.apiKeyScopes && !request.apiKeyScopes.includes(scope)) {
      reply.status(403).send(insufficientScope(scope))
      return
    }
  }
  scopeGuards.set(guard, scope)
  return guard
}

/**
 * Pick the right scope for an entity operation based on its collection.
 * Manuscript content (collection 'content') is gated by manuscript:*; everything
 * else (characters, places, lore, type definitions, custom types) is gated by
 * entities:*. JWT auth always passes through (all scopes implicit). A route
 * that relies on this declares `config: { apiKey: 'in-handler' }`.
 *
 * Returns true when the caller may proceed. On rejection, writes a 403 to
 * `reply` and returns false — caller should `return` immediately.
 */
export function assertEntityScope(
  request: FastifyRequest,
  reply: FastifyReply,
  collection: string,
  action: 'read' | 'write'
): boolean {
  if (!request.apiKeyAuth) return true
  const required = collection === 'content' ? `manuscript:${action}` : `entities:${action}`
  if (request.apiKeyScopes && request.apiKeyScopes.includes(required)) return true
  reply.status(403).send(insufficientScope(required))
  return false
}

/**
 * Deny API key authentication middleware.
 * Use on sensitive endpoints that require session (JWT) auth only. Undeclared
 * routes are already session-only; this keeps the intent explicit where it
 * matters most.
 */
export async function denyApiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (request.apiKeyAuth) {
    reply.status(403).send(SESSION_ONLY)
    return
  }
}

/**
 * For key-admitting routes that act on the account rather than a project. The
 * per-project key restriction lives in the project ownership checks, so
 * without this a restricted key would reach past its project here.
 */
export async function denyProjectRestrictedKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (request.apiKeyAuth && request.apiKeyProjectId) {
    reply.status(403).send({
      error: 'Forbidden',
      message: 'This API key is restricted to a single project'
    })
    return
  }
}

/**
 * `onRoute` hook (server.ts): derive each route's ApiKeyPolicy from the guards
 * in its preHandler list, so `requireScope(...)` and `denyApiKeyAuth` are the
 * declaration and a route can't carry one without the other. An explicit
 * `config.apiKey` wins.
 */
export function declareApiKeyPolicy(route: RouteOptions): void {
  if (route.config?.apiKey !== undefined) return
  const guards: unknown[] = [route.preHandler ?? []].flat()
  let apiKey: ApiKeyPolicy | undefined
  if (guards.includes(denyApiKeyAuth)) {
    apiKey = false
  } else {
    const scope = guards.map(guard => scopeGuards.get(guard as object)).find(s => s !== undefined)
    if (scope) apiKey = { scope }
  }
  if (apiKey !== undefined) route.config = { ...route.config, apiKey }
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

  if (!isUuid(projectId)) {
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

  // Per-project API key restriction: if the key is locked to a project, it can
  // only operate on that project — even if the user owns the requested one.
  if (request.apiKeyAuth && request.apiKeyProjectId && request.apiKeyProjectId !== projectId) {
    reply.status(403).send({
      error: 'Forbidden',
      message: 'This API key is restricted to a different project'
    })
    return false
  }

  return true
}


/**
 * Route-level ownership guard: the authenticated user must own the active
 * project named by `request[source][key]` (params by default). Use as
 * `preHandler: [requireAuth, ownsProject()]` instead of calling
 * requireProjectOwnership inside the handler — a guard that runs before the
 * handler cannot be forgotten on one code path, which is how two IDORs got in.
 */
export function ownsProject(
  source: 'params' | 'body' | 'query' = 'params',
  key = 'projectId',
  opts: { optional?: boolean } = {},
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const bag = (request[source] ?? {}) as Record<string, unknown>
    // `optional`: the field may be absent or null (an API key with no project
    // restriction); when present it must still name a project the caller owns.
    if (opts.optional && (bag[key] === undefined || bag[key] === null)) return
    const projectId = typeof bag[key] === 'string' ? (bag[key] as string) : ''
    const ok = await checkProjectOwnership(request, reply, projectId, false)
    if (!ok) return reply
  }
}

/**
 * preHandler for routes whose project is only known through a row — an
 * embargo, a destination, an entity. `resolve` returns the owning projectId
 * (null → 404) and may hand the loaded row to the handler as
 * `request.ownedRow`, so the handler body carries no authorization branch.
 */
export function ownsResolvedProject(
  resolve: (request: FastifyRequest) => Promise<{ projectId: string | null; row?: unknown } | null>,
  notFound = 'Not found',
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const found = await resolve(request)
    if (!found?.projectId) return reply.status(404).send({ error: notFound, correlationId: request.id })
    const ok = await checkProjectOwnership(request, reply, found.projectId, false)
    if (!ok) return reply
    request.ownedRow = found.row
  }
}

/** Resolver for `ownsResolvedProject`: the project of the row whose id is `request.params[param]`. */
export function projectOfRow(table: PgTable & { id: AnyPgColumn; projectId: AnyPgColumn }, param: string) {
  return async (request: FastifyRequest) => {
    const id = (request.params as Record<string, string | undefined>)[param] ?? ''
    if (!isUuid(id)) return null
    // The intersection type confuses drizzle's select typing; the runtime object is the table.
    const [row] = await db.select({ projectId: table.projectId }).from(table as PgTable).where(eq(table.id, id)).limit(1)
    return row ? { projectId: (row.projectId as string | null) ?? null } : null
  }
}

/** Ownership check for trashed (soft-deleted) projects only — restore / purge routes. */
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
  if (!isUuid(userId)) {
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
