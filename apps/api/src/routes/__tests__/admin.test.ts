import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { randomBytes } from 'crypto'
import { db } from '../../db/connection'
import { users, userBadges, userProfiles, siteMemberships, projects, apiKeys, cronRuns } from '../../db/schema'
import { createTestApp, createTestToken, createTestUser, createTestProject, cleanupAllTestData } from '../../__tests__/test-helpers'
import { hashApiKey } from '../../middleware/auth'

/**
 * Owner-only admin surface (apps/api/src/routes/admin.ts): dashboard stats,
 * user listing/search, badge grant/revoke, the supporter-status shortcut,
 * and manual cron invocation. Every route is gated by
 * [requireAuth, requireOwner, denyApiKeyAuth] — non-admins and API-key auth
 * must be refused on all of them.
 */
describe('Admin routes', () => {
  let app: any

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    await cleanupAllTestData()
  })

  async function verifiedUser() {
    const user = await createTestUser()
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
    return { user, token: await createTestToken(user.id) }
  }

  async function ownerUser() {
    const { user, token } = await verifiedUser()
    await db.insert(userBadges).values({ userId: user.id, badge: 'owner' })
    return { user, token }
  }

  /** Insert a usable bby_ API key for a user and return the raw token. Each
   * call mints a unique token — the auth middleware caches resolved API keys
   * by hash for a few seconds in-process, independent of DB truncation, so a
   * reused literal token would resolve to a stale cached user from an
   * earlier (already-cleaned-up) test. */
  async function apiKeyFor(userId: string) {
    const token = `bby_${randomBytes(16).toString('hex')}`
    await db.insert(apiKeys).values({
      userId,
      name: 'Test Key',
      keyPrefix: token.slice(0, 8),
      keyHash: hashApiKey(token),
      scopes: ['entities:read'],
    })
    return token
  }

  function inject(method: 'GET' | 'POST' | 'DELETE', url: string, token?: string, payload?: unknown) {
    return app.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload,
    })
  }

  const FAKE_ID = '11111111-1111-1111-1111-111111111111'

  // ═══════════════════════════════════════════════════════════════
  // Authorization gate — every route
  // ═══════════════════════════════════════════════════════════════

  const gateRoutes: Array<{ name: string; method: 'GET' | 'POST' | 'DELETE'; url: string; payload?: unknown }> = [
    { name: 'GET /admin/stats', method: 'GET', url: '/api/admin/stats' },
    { name: 'GET /admin/users', method: 'GET', url: '/api/admin/users' },
    { name: 'POST /admin/users/:userId/badges', method: 'POST', url: `/api/admin/users/${FAKE_ID}/badges`, payload: { badge: 'moderator' } },
    { name: 'POST /admin/users/:userId/supporter', method: 'POST', url: `/api/admin/users/${FAKE_ID}/supporter`, payload: { grant: true } },
    { name: 'DELETE /admin/users/:userId/badges/:badge', method: 'DELETE', url: `/api/admin/users/${FAKE_ID}/badges/moderator` },
    { name: 'POST /admin/cron/run/:job', method: 'POST', url: '/api/admin/cron/run/admin_daily_report' },
  ]

  describe('authorization gate', () => {
    it.each(gateRoutes)('$name returns 401 without a token', async ({ method, url, payload }) => {
      const res = await inject(method, url, undefined, payload)
      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.payload)).toEqual({
        error: 'Authentication required',
        message: 'Missing or invalid Authorization header',
      })
    })

    it.each(gateRoutes)('$name returns 403 "Forbidden" for a signed-in non-admin', async ({ method, url, payload }) => {
      const { token } = await verifiedUser()
      const res = await inject(method, url, token, payload)
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload)).toEqual({
        error: 'Forbidden',
        message: 'Owner access required',
      })
    })

    it.each(gateRoutes)('$name returns 403 "Session auth required" for an admin authenticated via API key', async ({ method, url, payload }) => {
      const { user } = await ownerUser()
      const keyToken = await apiKeyFor(user.id)
      const res = await inject(method, url, keyToken, payload)
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload)).toEqual({
        error: 'Session auth required',
        message: 'This endpoint requires session authentication and cannot be accessed with an API key',
      })
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // GET /admin/stats
  // ═══════════════════════════════════════════════════════════════

  describe('GET /admin/stats', () => {
    it('reports counts scoped correctly: non-deleted projects only, badges grouped by active only', async () => {
      const { user: owner, token } = await ownerUser()
      const other1 = await createTestUser()
      const other2 = await createTestUser()

      // Active project counts, soft-deleted project does not.
      await createTestProject(owner.id)
      const trashed = await createTestProject(other1.id)
      await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, trashed.id))

      // Active supporter badge counts; inactive moderator badge is excluded.
      await db.insert(userBadges).values({ userId: other1.id, badge: 'supporter', label: 'Supporter' })
      await db.insert(userBadges).values({ userId: other2.id, badge: 'moderator', isActive: false })

      const res = await inject('GET', '/api/admin/stats', token)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)

      expect(body.totalUsers).toBe(3) // owner + other1 + other2
      expect(body.totalProjects).toBe(1) // trashed one excluded
      expect(body.signupsLast7d).toBe(3)
      expect(body.signupsLast30d).toBe(3)
      expect(body.badgeCounts.owner).toBe(1)
      expect(body.badgeCounts.supporter).toBe(1)
      expect(body.badgeCounts.moderator).toBeUndefined()
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // GET /admin/users
  // ═══════════════════════════════════════════════════════════════

  describe('GET /admin/users', () => {
    it('searches by email, name, and username, and returns [] when nothing matches', async () => {
      const { token } = await ownerUser()
      const alice = await createTestUser({ email: 'alice-search@example.com', name: 'Alice Alpha' })
      await createTestUser({ email: 'bob-search@example.com', name: 'Bob Beta' })
      const carol = await createTestUser({ email: 'carol-search@example.com', name: 'Carol Gamma' })
      await db.insert(userProfiles).values({ userId: carol.id, username: 'wordsmith' })

      const byEmail = await inject('GET', '/api/admin/users?search=alice-search', token)
      expect(byEmail.statusCode).toBe(200)
      const emailBody = JSON.parse(byEmail.payload)
      expect(emailBody.total).toBe(1)
      expect(emailBody.users).toHaveLength(1)
      expect(emailBody.users[0].id).toBe(alice.id)

      const byUsername = await inject('GET', '/api/admin/users?search=wordsmith', token)
      const usernameBody = JSON.parse(byUsername.payload)
      expect(usernameBody.total).toBe(1)
      expect(usernameBody.users[0].id).toBe(carol.id)

      const noMatch = await inject('GET', '/api/admin/users?search=nobody-matches-this', token)
      const noMatchBody = JSON.parse(noMatch.payload)
      expect(noMatchBody.total).toBe(0)
      expect(noMatchBody.users).toEqual([])
    })

    it('paginates with page/limit and defaults to page=1, limit=50', async () => {
      const { token } = await ownerUser()
      for (let i = 0; i < 5; i++) {
        await createTestUser()
      }
      // owner + 5 = 6 total users

      const defaults = await inject('GET', '/api/admin/users', token)
      const defaultsBody = JSON.parse(defaults.payload)
      expect(defaultsBody.page).toBe(1)
      expect(defaultsBody.limit).toBe(50)
      expect(defaultsBody.total).toBe(6)
      expect(defaultsBody.users).toHaveLength(6)

      const page1 = await inject('GET', '/api/admin/users?limit=2&page=1', token)
      const page1Body = JSON.parse(page1.payload)
      expect(page1Body.users).toHaveLength(2)
      expect(page1Body.total).toBe(6)
      expect(page1Body.page).toBe(1)
      expect(page1Body.limit).toBe(2)

      const page3 = await inject('GET', '/api/admin/users?limit=2&page=3', token)
      expect(JSON.parse(page3.payload).users).toHaveLength(2)

      const page4 = await inject('GET', '/api/admin/users?limit=2&page=4', token)
      expect(JSON.parse(page4.payload).users).toHaveLength(0)
    })

    it('clamps limit to [1,100] and page to a minimum of 1', async () => {
      const { token } = await ownerUser()
      const overLimit = await inject('GET', '/api/admin/users?limit=1000', token)
      expect(JSON.parse(overLimit.payload).limit).toBe(100)

      const zeroPage = await inject('GET', '/api/admin/users?page=0', token)
      expect(JSON.parse(zeroPage.payload).page).toBe(1)

      const negativeLimit = await inject('GET', '/api/admin/users?limit=-5', token)
      expect(JSON.parse(negativeLimit.payload).limit).toBe(1)
    })

    it('attaches active badges and membership (stripe vs admin source), omitting inactive badges', async () => {
      const { token } = await ownerUser()
      const supporterUser = await createTestUser()
      await db.insert(userBadges).values({ userId: supporterUser.id, badge: 'supporter', label: 'Supporter' })
      await db.insert(userBadges).values({ userId: supporterUser.id, badge: 'moderator', isActive: false })

      const stripeUser = await createTestUser()
      await db.insert(siteMemberships).values({
        userId: stripeUser.id,
        tier: 'supporter',
        status: 'active',
        stripeSubscriptionId: 'sub_123',
      })

      const adminGrantedUser = await createTestUser()
      await db.insert(siteMemberships).values({
        userId: adminGrantedUser.id,
        tier: 'supporter',
        status: 'active',
      })

      const noMembershipUser = await createTestUser()

      const res = await inject('GET', '/api/admin/users?limit=100', token)
      const body = JSON.parse(res.payload)
      const byId = new Map(body.users.map((u: any) => [u.id, u]))

      expect(byId.get(supporterUser.id).badges).toEqual([{ badge: 'supporter', label: 'Supporter' }])
      expect(byId.get(stripeUser.id).membership).toEqual({ tier: 'supporter', status: 'active', source: 'stripe' })
      expect(byId.get(adminGrantedUser.id).membership).toEqual({ tier: 'supporter', status: 'active', source: 'admin' })
      expect(byId.get(noMembershipUser.id).membership).toBeNull()
      expect(byId.get(noMembershipUser.id).badges).toEqual([])
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // POST /admin/users/:userId/badges
  // ═══════════════════════════════════════════════════════════════

  describe('POST /admin/users/:userId/badges', () => {
    it('rejects a missing or empty badge name with 400', async () => {
      const { token } = await ownerUser()
      const target = await createTestUser()

      const missing = await inject('POST', `/api/admin/users/${target.id}/badges`, token, {})
      expect(missing.statusCode).toBe(400)
      expect(JSON.parse(missing.payload)).toEqual({ error: 'Badge name is required' })

      const empty = await inject('POST', `/api/admin/users/${target.id}/badges`, token, { badge: '' })
      expect(empty.statusCode).toBe(400)
      expect(JSON.parse(empty.payload)).toEqual({ error: 'Badge name is required' })
    })

    it('returns 404 "User not found" for a nonexistent target user', async () => {
      const { token } = await ownerUser()
      const res = await inject('POST', `/api/admin/users/${FAKE_ID}/badges`, token, { badge: 'moderator' })
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload)).toEqual({ error: 'User not found' })
    })

    it('grants a badge, defaulting label to null, and stamps grantedBy', async () => {
      const { user: admin, token } = await ownerUser()
      const target = await createTestUser()

      const res = await inject('POST', `/api/admin/users/${target.id}/badges`, token, { badge: 'contributor' })
      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.payload)
      expect(body.userId).toBe(target.id)
      expect(body.badge).toBe('contributor')
      expect(body.label).toBeNull()
      expect(body.grantedBy).toBe(admin.id)
      expect(body.isActive).toBe(true)

      const [row] = await db.select().from(userBadges).where(eq(userBadges.userId, target.id))
      expect(row?.badge).toBe('contributor')
    })

    it('stores a provided label', async () => {
      const { token } = await ownerUser()
      const target = await createTestUser()

      const res = await inject('POST', `/api/admin/users/${target.id}/badges`, token, { badge: 'beta_tester', label: 'Beta Tester' })
      expect(res.statusCode).toBe(201)
      expect(JSON.parse(res.payload).label).toBe('Beta Tester')
    })

    it('returns 409 when the user already has the badge', async () => {
      const { token } = await ownerUser()
      const target = await createTestUser()
      await db.insert(userBadges).values({ userId: target.id, badge: 'moderator' })

      const res = await inject('POST', `/api/admin/users/${target.id}/badges`, token, { badge: 'moderator' })
      expect(res.statusCode).toBe(409)
      expect(JSON.parse(res.payload)).toEqual({ error: 'User already has this badge' })
    })

    // (userId, badge) is unique regardless of isActive, so a revoked badge
    // leaves an inactive row behind; re-granting must reactivate it rather
    // than conflict forever.
    it('re-grants a badge that exists but is inactive by reactivating it', async () => {
      const { user: owner, token } = await ownerUser()
      const target = await createTestUser()
      await db.insert(userBadges).values({ userId: target.id, badge: 'supporter', isActive: false })

      const res = await inject('POST', `/api/admin/users/${target.id}/badges`, token, { badge: 'supporter', label: 'Supporter' })
      expect(res.statusCode).toBe(201)
      expect(JSON.parse(res.payload).isActive).toBe(true)

      const [row] = await db.select().from(userBadges).where(eq(userBadges.userId, target.id))
      expect(row?.isActive).toBe(true)
      expect(row?.label).toBe('Supporter')
      expect(row?.grantedBy).toBe(owner.id)
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // POST /admin/users/:userId/supporter
  // ═══════════════════════════════════════════════════════════════

  describe('POST /admin/users/:userId/supporter', () => {
    it('rejects a non-boolean "grant" with 400', async () => {
      const { token } = await ownerUser()
      const target = await createTestUser()

      const missing = await inject('POST', `/api/admin/users/${target.id}/supporter`, token, {})
      expect(missing.statusCode).toBe(400)
      expect(JSON.parse(missing.payload)).toEqual({ error: '"grant" (boolean) is required' })

      const wrongType = await inject('POST', `/api/admin/users/${target.id}/supporter`, token, { grant: 'yes' })
      expect(wrongType.statusCode).toBe(400)
    })

    it('returns 404 "User not found" for a nonexistent target user', async () => {
      const { token } = await ownerUser()
      const res = await inject('POST', `/api/admin/users/${FAKE_ID}/supporter`, token, { grant: true })
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload)).toEqual({ error: 'User not found' })
    })

    it('grants supporter status for a user with no existing membership (source: admin)', async () => {
      const { user: admin, token } = await ownerUser()
      const target = await createTestUser()

      const res = await inject('POST', `/api/admin/users/${target.id}/supporter`, token, { grant: true })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ supporter: true, source: 'admin' })

      const [membership] = await db.select().from(siteMemberships).where(eq(siteMemberships.userId, target.id))
      expect(membership?.tier).toBe('supporter')
      expect(membership?.status).toBe('active')
      expect(membership?.stripeSubscriptionId).toBeNull()

      const [badge] = await db.select().from(userBadges).where(eq(userBadges.userId, target.id))
      expect(badge?.badge).toBe('supporter')
      expect(badge?.label).toBe('Supporter')
      expect(badge?.isActive).toBe(true)
      expect(badge?.grantedBy).toBe(admin.id)
    })

    it('grant leaves an active Stripe-paid membership untouched (source: stripe)', async () => {
      const { token } = await ownerUser()
      const target = await createTestUser()
      await db.insert(siteMemberships).values({
        userId: target.id,
        tier: 'supporter',
        status: 'active',
        stripeSubscriptionId: 'sub_untouched',
        stripePriceId: 'price_1',
      })

      const res = await inject('POST', `/api/admin/users/${target.id}/supporter`, token, { grant: true })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ supporter: true, source: 'stripe' })

      const [membership] = await db.select().from(siteMemberships).where(eq(siteMemberships.userId, target.id))
      expect(membership?.stripeSubscriptionId).toBe('sub_untouched')
      expect(membership?.stripePriceId).toBe('price_1')

      const [badge] = await db.select().from(userBadges).where(eq(userBadges.userId, target.id))
      expect(badge?.isActive).toBe(true)
    })

    it('grant reactivates a previously deactivated supporter badge', async () => {
      const { token } = await ownerUser()
      const target = await createTestUser()
      await db.insert(userBadges).values({ userId: target.id, badge: 'supporter', label: 'Supporter', isActive: false })

      const res = await inject('POST', `/api/admin/users/${target.id}/supporter`, token, { grant: true })
      expect(res.statusCode).toBe(200)

      const [badge] = await db.select().from(userBadges).where(eq(userBadges.userId, target.id))
      expect(badge?.isActive).toBe(true)
    })

    it('revoke with no existing membership/badge is a no-op that reports supporter: false', async () => {
      const { token } = await ownerUser()
      const target = await createTestUser()

      const res = await inject('POST', `/api/admin/users/${target.id}/supporter`, token, { grant: false })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ supporter: false })
    })

    it('revoke refuses to touch an active Stripe-paid membership with 409', async () => {
      const { token } = await ownerUser()
      const target = await createTestUser()
      await db.insert(siteMemberships).values({
        userId: target.id,
        tier: 'supporter',
        status: 'active',
        stripeSubscriptionId: 'sub_protected',
      })

      const res = await inject('POST', `/api/admin/users/${target.id}/supporter`, token, { grant: false })
      expect(res.statusCode).toBe(409)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Cannot revoke Stripe-paid supporter membership' })

      const [membership] = await db.select().from(siteMemberships).where(eq(siteMemberships.userId, target.id))
      expect(membership?.status).toBe('active')
    })

    it('revoke downgrades an admin-granted membership and deactivates the badge', async () => {
      const { token } = await ownerUser()
      const target = await createTestUser()
      await db.insert(siteMemberships).values({
        userId: target.id,
        tier: 'supporter',
        status: 'active',
      })
      await db.insert(userBadges).values({ userId: target.id, badge: 'supporter', label: 'Supporter' })

      const res = await inject('POST', `/api/admin/users/${target.id}/supporter`, token, { grant: false })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ supporter: false })

      const [membership] = await db.select().from(siteMemberships).where(eq(siteMemberships.userId, target.id))
      expect(membership?.tier).toBe('free')
      expect(membership?.status).toBe('revoked')

      const [badge] = await db.select().from(userBadges).where(eq(userBadges.userId, target.id))
      expect(badge?.isActive).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // DELETE /admin/users/:userId/badges/:badge
  // ═══════════════════════════════════════════════════════════════

  describe('DELETE /admin/users/:userId/badges/:badge', () => {
    it('returns 404 "Badge not found on user" when the badge does not exist for the user', async () => {
      const { token } = await ownerUser()
      const target = await createTestUser()

      const res = await inject('DELETE', `/api/admin/users/${target.id}/badges/moderator`, token)
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Badge not found on user' })
    })

    it('deletes an existing badge row', async () => {
      const { token } = await ownerUser()
      const target = await createTestUser()
      await db.insert(userBadges).values({ userId: target.id, badge: 'moderator' })

      const res = await inject('DELETE', `/api/admin/users/${target.id}/badges/moderator`, token)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ success: true })

      const remaining = await db.select().from(userBadges).where(eq(userBadges.userId, target.id))
      expect(remaining).toHaveLength(0)
    })

    it('also deletes an inactive badge row (no isActive filter in the query)', async () => {
      const { token } = await ownerUser()
      const target = await createTestUser()
      await db.insert(userBadges).values({ userId: target.id, badge: 'moderator', isActive: false })

      const res = await inject('DELETE', `/api/admin/users/${target.id}/badges/moderator`, token)
      expect(res.statusCode).toBe(200)

      const remaining = await db.select().from(userBadges).where(eq(userBadges.userId, target.id))
      expect(remaining).toHaveLength(0)
    })

    it('does not delete a badge belonging to a different user', async () => {
      const { token } = await ownerUser()
      const target = await createTestUser()
      const other = await createTestUser()
      await db.insert(userBadges).values({ userId: other.id, badge: 'moderator' })

      const res = await inject('DELETE', `/api/admin/users/${target.id}/badges/moderator`, token)
      expect(res.statusCode).toBe(404)

      const stillThere = await db.select().from(userBadges).where(eq(userBadges.userId, other.id))
      expect(stillThere).toHaveLength(1)
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // POST /admin/cron/run/:job
  // ═══════════════════════════════════════════════════════════════

  describe('POST /admin/cron/run/:job', () => {
    it('returns 404 for an unknown job name', async () => {
      const { token } = await ownerUser()
      const res = await inject('POST', '/api/admin/cron/run/not_a_real_job', token)
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload)).toEqual({ error: 'unknown cron job: not_a_real_job' })
    })

    it('skips the admin daily report outside production when not forced', async () => {
      const { token } = await ownerUser()
      const res = await inject('POST', '/api/admin/cron/run/admin_daily_report', token)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ ok: true, claimed: false, skipped: 'not_production' })
    })

    it('force=true bypasses the production gate and skips with no_growth once the report window excludes this test\'s own signup', async () => {
      const { token } = await ownerUser()
      // gatherReportData() counts users created after the cutoff, and the
      // owner user created above always falls inside the default (last 24h)
      // cutoff, which would otherwise make this send a real email. Seed a
      // cron_runs row with lastSentAt = now so the cutoff excludes it.
      await db.insert(cronRuns).values({
        jobName: 'admin_daily_report',
        lastStatus: 'success',
        lastSentAt: new Date(),
      })

      const res = await inject('POST', '/api/admin/cron/run/admin_daily_report?force=true', token)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ ok: true, claimed: true, skipped: 'no_growth' })
    })
  })

  // ═══════════════════════════════════════════════════════════════
  // Missing input validation (bug notes)
  // ═══════════════════════════════════════════════════════════════

  describe('malformed userId', () => {
    // A non-UUID id used to reach Postgres and surface as a masked 500.
    it('a non-UUID userId is a 400 on every :userId route', async () => {
      const { token } = await ownerUser()
      const calls: Array<[string, string, unknown]> = [
        ['POST', '/api/admin/users/not-a-uuid/badges', { badge: 'moderator' }],
        ['POST', '/api/admin/users/not-a-uuid/supporter', { grant: true }],
        ['DELETE', '/api/admin/users/not-a-uuid/badges/supporter', undefined],
      ]
      for (const [method, url, payload] of calls) {
        const res = await inject(method as 'POST' | 'DELETE', url, token, payload)
        expect(res.statusCode).toBe(400)
        expect(JSON.parse(res.payload).error).toBe('Invalid user ID format')
      }
    })
  })
})
