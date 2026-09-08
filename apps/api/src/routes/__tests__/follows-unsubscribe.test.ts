import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { randomUUID, createHash } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import {
  users,
  projects,
  projectFollows,
  userNotificationPreferences,
  rssFeedTokens,
  subscriptions,
  subscriptionTiers,
  projectPublishConfig,
  accessGrants,
} from '../../db/schema'
import { generateUnsubscribeToken } from '../../lib/email'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'

/** Mark a user's email verified — required by requireVerified-gated routes. */
async function verify(userId: string) {
  await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, userId))
}

describe('Project Follows / Unsubscribe / RSS Tokens', () => {
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

  // ==========================================================================
  // Project follows
  // ==========================================================================

  describe('POST /projects/:projectId/follow', () => {
    it('401s without a token', async () => {
      const owner = await createTestUser()
      const project = await createTestProject(owner.id)

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/follow`,
      })

      expect(res.statusCode).toBe(401)
    })

    it('creates exactly one row and is not idempotent (400 on repeat)', async () => {
      const owner = await createTestUser()
      const project = await createTestProject(owner.id)
      const follower = await createTestUser()
      await verify(follower.id)
      const token = await createTestToken(follower.id)

      const first = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/follow`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(first.statusCode).toBe(201)

      const second = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/follow`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(second.statusCode).toBe(400)
      expect(second.json()).toEqual({ error: 'Already following this project' })

      const rows = await db
        .select()
        .from(projectFollows)
        .where(and(eq(projectFollows.followerId, follower.id), eq(projectFollows.projectId, project.id)))
      expect(rows.length).toBe(1)
    })

    it('404s for a non-existent project', async () => {
      const follower = await createTestUser()
      await verify(follower.id)
      const token = await createTestToken(follower.id)

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${randomUUID()}/follow`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'Project not found' })
    })

    it('refuses to follow your own project', async () => {
      const owner = await createTestUser()
      await verify(owner.id)
      const project = await createTestProject(owner.id)
      const token = await createTestToken(owner.id)

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/follow`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'Cannot follow your own project' })
    })
  })

  describe('DELETE /projects/:projectId/follow', () => {
    it('removes the row and is idempotent (200 again with no row)', async () => {
      const owner = await createTestUser()
      const project = await createTestProject(owner.id)
      const follower = await createTestUser()
      const token = await createTestToken(follower.id)

      await db.insert(projectFollows).values({ followerId: follower.id, projectId: project.id })

      const first = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${project.id}/follow`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(first.statusCode).toBe(200)

      const rows = await db
        .select()
        .from(projectFollows)
        .where(and(eq(projectFollows.followerId, follower.id), eq(projectFollows.projectId, project.id)))
      expect(rows.length).toBe(0)

      // Calling again with nothing to delete still succeeds — the route
      // doesn't check for an existing row before deleting.
      const second = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${project.id}/follow`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(second.statusCode).toBe(200)
    })

    it('refuses to unfollow while actively subscribed to the owner', async () => {
      const owner = await createTestUser()
      const follower = await createTestUser()
      const project = await createTestProject(owner.id)
      const token = await createTestToken(follower.id)

      await db.insert(projectFollows).values({ followerId: follower.id, projectId: project.id })

      const [tier] = await db.insert(subscriptionTiers).values({
        authorId: owner.id,
        name: 'Tier 1',
        tierLevel: 1,
      }).returning()

      await db.insert(subscriptions).values({
        subscriberId: follower.id,
        authorId: owner.id,
        tierId: tier!.id,
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      })

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${project.id}/follow`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'Cannot unfollow while subscribed. Unsubscribe first.' })

      const rows = await db
        .select()
        .from(projectFollows)
        .where(and(eq(projectFollows.followerId, follower.id), eq(projectFollows.projectId, project.id)))
      expect(rows.length).toBe(1)
    })
  })

  describe('GET /projects/:projectId/follow-status', () => {
    it('follower count equals seeded rows, and reflects the caller state', async () => {
      const owner = await createTestUser()
      const project = await createTestProject(owner.id)
      const followerA = await createTestUser()
      const followerB = await createTestUser()
      await db.insert(projectFollows).values([
        { followerId: followerA.id, projectId: project.id },
        { followerId: followerB.id, projectId: project.id },
      ])
      const token = await createTestToken(followerA.id)

      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/follow-status`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ isFollowing: true, followerCount: 2, muted: false })
    })

    it('works for a logged-out caller (optionalAuth)', async () => {
      const owner = await createTestUser()
      const project = await createTestProject(owner.id)

      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/follow-status`,
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ isFollowing: false, followerCount: 0, muted: false })
    })
  })

  describe('PATCH /projects/:projectId/follow', () => {
    it('toggles mute on an existing follow', async () => {
      const owner = await createTestUser()
      const project = await createTestProject(owner.id)
      const follower = await createTestUser()
      const token = await createTestToken(follower.id)
      await db.insert(projectFollows).values({ followerId: follower.id, projectId: project.id })

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${project.id}/follow`,
        headers: { authorization: `Bearer ${token}` },
        payload: { muted: true },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ success: true, muted: true })

      const [row] = await db
        .select()
        .from(projectFollows)
        .where(and(eq(projectFollows.followerId, follower.id), eq(projectFollows.projectId, project.id)))
      expect(row!.muted).toBe(true)
    })

    it('404s when not following the project', async () => {
      const owner = await createTestUser()
      const project = await createTestProject(owner.id)
      const follower = await createTestUser()
      const token = await createTestToken(follower.id)

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${project.id}/follow`,
        headers: { authorization: `Bearer ${token}` },
        payload: { muted: true },
      })

      expect(res.statusCode).toBe(404)
      expect(res.json()).toEqual({ error: 'Not following this project' })
    })
  })

  describe('GET /users/:userId/follows', () => {
    it('returns only the caller\'s own follows', async () => {
      const ownerA = await createTestUser()
      const ownerB = await createTestUser()
      const projectA = await createTestProject(ownerA.id, { name: 'Project A' })
      const projectB = await createTestProject(ownerB.id, { name: 'Project B' })

      const caller = await createTestUser()
      const other = await createTestUser()
      await db.insert(projectFollows).values([
        { followerId: caller.id, projectId: projectA.id },
        { followerId: other.id, projectId: projectB.id },
      ])

      const token = await createTestToken(caller.id)
      const res = await app.inject({
        method: 'GET',
        url: `/api/users/${caller.id}/follows`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(200)
      const { follows } = res.json()
      expect(follows.length).toBe(1)
      expect(follows[0].projectId).toBe(projectA.id)
      expect(follows[0].projectName).toBe('Project A')
    })

    it('403s when requesting someone else\'s follows', async () => {
      const caller = await createTestUser()
      const other = await createTestUser()
      const token = await createTestToken(caller.id)

      const res = await app.inject({
        method: 'GET',
        url: `/api/users/${other.id}/follows`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(403)
    })
  })

  // ==========================================================================
  // Unsubscribe
  // ==========================================================================

  describe('POST /unsubscribe', () => {
    it('unsubscribes the right user from the right category, without a session', async () => {
      const user = await createTestUser()
      const token = generateUnsubscribeToken(user.id, 'emailNewChapter')

      // No Authorization header at all — this route is hit from a logged-out
      // email client.
      const res = await app.inject({
        method: 'POST',
        url: `/api/unsubscribe?token=${encodeURIComponent(token)}`,
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ success: true })

      const [prefs] = await db
        .select()
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, user.id))
      expect(prefs!.emailNewChapter).toBe(false)
      // Untouched categories keep their column defaults.
      expect(prefs!.emailNewFollower).toBe(true)
    })

    it('flips only the targeted column when a preferences row already exists', async () => {
      const user = await createTestUser()
      await db.insert(userNotificationPreferences).values({ userId: user.id })
      const token = generateUnsubscribeToken(user.id, 'emailNewComment')

      const res = await app.inject({
        method: 'POST',
        url: `/api/unsubscribe?token=${encodeURIComponent(token)}`,
      })

      expect(res.statusCode).toBe(200)
      const [prefs] = await db
        .select()
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, user.id))
      expect(prefs!.emailNewComment).toBe(false)
      expect(prefs!.emailNewFollower).toBe(true)
    })

    it('is idempotent — unsubscribing twice leaves the same state', async () => {
      const user = await createTestUser()
      const token = generateUnsubscribeToken(user.id, 'emailNewSubscriber')

      const first = await app.inject({ method: 'POST', url: `/api/unsubscribe?token=${encodeURIComponent(token)}` })
      const second = await app.inject({ method: 'POST', url: `/api/unsubscribe?token=${encodeURIComponent(token)}` })

      expect(first.statusCode).toBe(200)
      expect(second.statusCode).toBe(200)

      const [prefs] = await db
        .select()
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, user.id))
      expect(prefs!.emailNewSubscriber).toBe(false)
    })

    it('rejects a missing token', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/unsubscribe' })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'Missing token' })
    })

    it('rejects a tampered token', async () => {
      const user = await createTestUser()
      const token = generateUnsubscribeToken(user.id, 'emailNewChapter')
      const tampered = token.slice(0, -1) + (token.at(-1) === '0' ? '1' : '0')

      const res = await app.inject({ method: 'POST', url: `/api/unsubscribe?token=${encodeURIComponent(tampered)}` })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'Invalid or expired token' })
    })

    it('rejects a truncated token', async () => {
      const user = await createTestUser()
      const token = generateUnsubscribeToken(user.id, 'emailNewChapter')
      const truncated = token.split(':').slice(0, 2).join(':')

      const res = await app.inject({ method: 'POST', url: `/api/unsubscribe?token=${encodeURIComponent(truncated)}` })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'Invalid or expired token' })
    })

    it('rejects a validly-signed token for a preference key that is not a real column', async () => {
      const user = await createTestUser()
      const token = generateUnsubscribeToken(user.id, 'notARealPreference')

      const res = await app.inject({ method: 'POST', url: `/api/unsubscribe?token=${encodeURIComponent(token)}` })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'Invalid preference key' })
    })
  })

  describe('GET /unsubscribe', () => {
    it('renders a confirmation page for a valid token', async () => {
      const user = await createTestUser()
      const token = generateUnsubscribeToken(user.id, 'emailNewFollower')

      const res = await app.inject({ method: 'GET', url: `/api/unsubscribe?token=${encodeURIComponent(token)}` })

      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('text/html')
      expect(res.payload).toContain('new follower notifications')
      expect(res.payload).not.toContain('Invalid link')
    })

    it('shows an invalid-link message for a bad or missing token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/unsubscribe' })

      expect(res.statusCode).toBe(200)
      expect(res.payload).toContain('Invalid link')
    })
  })

  // ==========================================================================
  // RSS tokens
  // ==========================================================================

  describe('POST /rss-tokens', () => {
    it('401s without a token', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/rss-tokens' })
      expect(res.statusCode).toBe(401)
    })

    it('creates a token, returns the plaintext once, and stores only its hash', async () => {
      const user = await createTestUser()
      await verify(user.id)
      const token = await createTestToken(user.id)

      const res = await app.inject({
        method: 'POST',
        url: '/api/rss-tokens',
        headers: { authorization: `Bearer ${token}` },
        payload: { label: 'My reader' },
      })

      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body.token).toMatch(/^bby_rss_/)
      expect(body.label).toBe('My reader')

      const [row] = await db.select().from(rssFeedTokens).where(eq(rssFeedTokens.id, body.id))
      expect(row).toBeDefined()
      expect(row!.tokenHash).toBe(createHash('sha256').update(body.token).digest('hex'))
      // The plaintext token itself is never persisted.
      expect(JSON.stringify(row)).not.toContain(body.token)
    })

    it('rejects a label over 100 characters', async () => {
      const user = await createTestUser()
      await verify(user.id)
      const token = await createTestToken(user.id)

      const res = await app.inject({
        method: 'POST',
        url: '/api/rss-tokens',
        headers: { authorization: `Bearer ${token}` },
        payload: { label: 'x'.repeat(101) },
      })

      expect(res.statusCode).toBe(400)
    })

    it('403s once the per-user token limit is reached', async () => {
      const user = await createTestUser()
      await verify(user.id)
      const token = await createTestToken(user.id)

      await db.insert(rssFeedTokens).values(
        Array.from({ length: 10 }, (_, i) => ({
          userId: user.id,
          label: `token-${i}`,
          tokenHash: createHash('sha256').update(`seed-${i}-${randomUUID()}`).digest('hex'),
        }))
      )

      const res = await app.inject({
        method: 'POST',
        url: '/api/rss-tokens',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(403)
      expect(res.json().error).toBe('RSS token limit reached')
    })
  })

  describe('GET /rss-tokens', () => {
    it('lists metadata without the plaintext token', async () => {
      const user = await createTestUser()
      const otherUser = await createTestUser()
      const token = await createTestToken(user.id)

      await db.insert(rssFeedTokens).values({
        userId: user.id,
        label: 'Feedly',
        tokenHash: createHash('sha256').update('plaintext-value').digest('hex'),
      })
      await db.insert(rssFeedTokens).values({
        userId: otherUser.id,
        label: 'Someone else\'s',
        tokenHash: createHash('sha256').update('other-plaintext').digest('hex'),
      })

      const res = await app.inject({
        method: 'GET',
        url: '/api/rss-tokens',
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(200)
      const { tokens } = res.json()
      expect(tokens.length).toBe(1)
      expect(tokens[0].label).toBe('Feedly')
      expect(tokens[0]).not.toHaveProperty('tokenHash')
      expect(tokens[0]).not.toHaveProperty('token')
    })
  })

  describe('DELETE /rss-tokens/:tokenId', () => {
    it('revokes the token, and revoking again 404s', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const [row] = await db.insert(rssFeedTokens).values({
        userId: user.id,
        tokenHash: createHash('sha256').update('to-revoke').digest('hex'),
      }).returning()

      const first = await app.inject({
        method: 'DELETE',
        url: `/api/rss-tokens/${row!.id}`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(first.statusCode).toBe(200)

      const second = await app.inject({
        method: 'DELETE',
        url: `/api/rss-tokens/${row!.id}`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(second.statusCode).toBe(404)
      expect(second.json()).toEqual({ error: 'Token not found' })
    })

    it('will not let another user revoke someone else\'s token', async () => {
      const owner = await createTestUser()
      const attacker = await createTestUser()
      const attackerToken = await createTestToken(attacker.id)
      const [row] = await db.insert(rssFeedTokens).values({
        userId: owner.id,
        tokenHash: createHash('sha256').update('owner-token').digest('hex'),
      }).returning()

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/rss-tokens/${row!.id}`,
        headers: { authorization: `Bearer ${attackerToken}` },
      })

      expect(res.statusCode).toBe(404)

      const [still] = await db.select().from(rssFeedTokens).where(eq(rssFeedTokens.id, row!.id))
      expect(still!.revokedAt).toBeNull()
    })

    it('a revoked token no longer authenticates the RSS feed route for a private project', async () => {
      const author = await createTestUser()
      const project = await createTestProject(author.id)
      await db.insert(projectPublishConfig).values({
        projectId: project.id,
        projectVisibility: 'private',
      })

      const reader = await createTestUser()
      await db.insert(accessGrants).values({
        grantedTo: reader.id,
        authorId: author.id,
        projectId: project.id,
        grantType: 'comp',
        grantedBy: author.id,
      })

      const plaintext = 'bby_rss_test-plaintext-token'
      const [tokenRow] = await db.insert(rssFeedTokens).values({
        userId: reader.id,
        tokenHash: createHash('sha256').update(plaintext).digest('hex'),
      }).returning()

      const before = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/feed.xml?reader=${encodeURIComponent(plaintext)}`,
      })
      expect(before.statusCode).toBe(200)

      await db.update(rssFeedTokens).set({ revokedAt: new Date() }).where(eq(rssFeedTokens.id, tokenRow!.id))

      const after = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/feed.xml?reader=${encodeURIComponent(plaintext)}`,
      })
      expect(after.statusCode).toBe(404)
    })
  })
})
