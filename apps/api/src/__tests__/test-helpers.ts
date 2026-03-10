import * as jose from 'jose'
import { scrypt, randomBytes } from 'crypto'
import { promisify } from 'util'
import { build } from '../server'
import { db } from '../db/connection'
import { users, projects } from '../db/schema'
import { getJwtSecret } from '../middleware/auth'
import { sql } from 'drizzle-orm'

const scryptAsync = promisify(scrypt)

/**
 * Build and ready a Fastify app instance for testing.
 */
export async function createTestApp() {
  const app = build({ logger: false })
  await app.ready()
  return app
}

/**
 * Sign a JWT for the given user ID (mirrors NextAuth token shape).
 */
export async function createTestToken(userId: string): Promise<string> {
  return new jose.SignJWT({ id: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(getJwtSecret())
}

let userCounter = 0

/**
 * Insert a test user with auto-generated email. Returns the full row.
 */
export async function createTestUser(overrides: { email?: string; name?: string } = {}) {
  userCounter++
  const [user] = await db.insert(users).values({
    email: overrides.email ?? `test-${userCounter}-${Date.now()}@test.local`,
    name: overrides.name ?? `Test User ${userCounter}`,
  }).returning()
  return user!
}

/**
 * Insert a test user with a password hash (for login/TOTP tests). Returns the full row.
 */
export async function createTestUserWithPassword(
  password: string,
  overrides: { email?: string; name?: string } = {}
) {
  userCounter++
  const salt = randomBytes(16).toString('hex')
  const hash = ((await scryptAsync(password, salt, 64)) as Buffer).toString('hex')
  const passwordHash = `${salt}:${hash}`
  const [user] = await db.insert(users).values({
    email: overrides.email ?? `test-${userCounter}-${Date.now()}@test.local`,
    name: overrides.name ?? `Test User ${userCounter}`,
    passwordHash
  }).returning()
  return user!
}

/**
 * Insert a test project with defaults. Returns the full row.
 */
export async function createTestProject(ownerId: string, overrides: { name?: string; description?: string } = {}) {
  const [project] = await db.insert(projects).values({
    ownerId,
    name: overrides.name ?? 'Test Project',
    description: overrides.description ?? 'Test Description',
  }).returning()
  return project!
}

// All table names from schema.ts — TRUNCATE CASCADE handles FK ordering
const ALL_TABLES = [
  'notifications',
  'email_verification_tokens',
  'password_reset_tokens',
  'provenance_events',
  'uploads',
  'entities',
  'publish_targets',
  'manifests_versions',
  'bobbins_installed',
  'memberships',
  'project_collection_memberships',
  'project_collections',
  'discount_codes',
  'access_grants',
  'subscription_payments',
  'subscriptions',
  'content_tags',
  'author_notes',
  'reactions',
  'comments',
  'chapter_views',
  'chapter_publications',
  'export_configs',
  'publish_snapshots',
  'embargo_schedules',
  'content_warnings',
  'project_destinations',
  'project_publish_config',
  'beta_readers',
  'user_bobbins_installed',
  'user_reading_preferences',
  'user_notification_preferences',
  'project_follows',
  'user_followers',
  'user_payment_config',
  'subscription_tiers',
  'user_profiles',
  'user_badges',
  'site_memberships',
  'projects',
  'users',
] as const

/**
 * Truncate all tables in a single statement. CASCADE handles FK dependencies.
 * Safety: refuses to run against non-test databases to prevent accidental data loss.
 */
export async function cleanupAllTestData() {
  const dbUrl = process.env.DATABASE_URL || ''
  if (!dbUrl.includes('_test') && !dbUrl.includes('test')) {
    throw new Error(
      `cleanupAllTestData() refused to run — DATABASE_URL does not contain "test".\n` +
      `Current DATABASE_URL: ${dbUrl.replace(/\/\/.*@/, '//***@')}\n` +
      `Set DATABASE_URL to a test database (e.g. bobbins_test) before running integration tests.`
    )
  }
  await db.execute(sql.raw(`TRUNCATE ${ALL_TABLES.join(', ')} CASCADE`))
}
