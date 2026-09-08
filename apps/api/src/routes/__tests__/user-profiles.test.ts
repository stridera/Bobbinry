import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { db } from '../../db/connection'
import { userProfiles, userFollowers, projects, projectPublishConfig, entities, chapterPublications } from '../../db/schema'
import { eq } from 'drizzle-orm'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'

/**
 * Covers routes/users/profiles.ts (the signed-in user's own profile — read,
 * update, username claiming) and routes/users/public-profile.ts (the
 * anonymous /api/users/by-username/:username view and published-projects
 * listing).
 */
describe('User profiles', () => {
  let app: any
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  afterEach(async () => { await cleanupAllTestData() })

  async function authedUser() {
    const user = await createTestUser()
    const token = await createTestToken(user.id)
    return { user, token }
  }

  function inject(method: string, url: string, token?: string, payload?: Record<string, unknown>) {
    return app.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      payload,
    })
  }

  function getProfile(userId: string, token?: string) {
    return inject('GET', `/api/users/${userId}/profile`, token)
  }

  function putProfile(userId: string, token: string | undefined, body: Record<string, unknown>) {
    return inject('PUT', `/api/users/${userId}/profile`, token, body)
  }

  function getByUsername(username: string) {
    return inject('GET', `/api/users/by-username/${encodeURIComponent(username)}`)
  }

  function getPublishedProjects(userId: string) {
    return inject('GET', `/api/users/${userId}/published-projects`)
  }

  /** Seeds a public/live project with a publish config row (mirrors reader-lookup-seo.test.ts). */
  let shortUrlCounter = 0
  async function seedProject(
    ownerId: string,
    overrides: { name?: string; projectVisibility?: string; publishingMode?: string } = {}
  ) {
    shortUrlCounter++
    const project = await createTestProject(ownerId, { name: overrides.name ?? 'Test Project' })
    const shortUrl = `project-${shortUrlCounter}-${Date.now()}`
    await db.update(projects).set({ shortUrl }).where(eq(projects.id, project.id))
    await db.insert(projectPublishConfig).values({
      projectId: project.id,
      publishingMode: overrides.publishingMode ?? 'live',
      projectVisibility: overrides.projectVisibility ?? 'public',
      defaultVisibility: 'public',
    })
    return { ...project, shortUrl }
  }

  async function seedPublishedChapter(projectId: string, title = 'Chapter 1') {
    const [chapter] = await db.insert(entities).values({
      projectId,
      bobbinId: 'manuscript',
      collectionName: 'content',
      contentType: 'chapter',
      entityData: { title, body: '<p>Text.</p>', word_count: 2 },
    }).returning()
    await db.insert(chapterPublications).values({
      projectId,
      chapterId: chapter!.id,
      publishStatus: 'published',
      isPublished: true,
      publishedAt: new Date(),
      firstPublishedAt: new Date(),
      lastPublishedAt: new Date(),
    })
    return chapter!
  }

  // ==========================================================================
  // 1. Own profile: auth + requireSelf
  // ==========================================================================

  describe('own profile — auth', () => {
    it('PUT without a token returns 401 with the requireAuth message', async () => {
      const { user } = await authedUser()
      const res = await putProfile(user.id, undefined, { displayName: 'Nope' })
      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.payload)).toEqual({
        error: 'Authentication required',
        message: 'Missing or invalid Authorization header',
      })
    })

    it('GET /users/:userId/profile requires no auth — it is intentionally public', async () => {
      const { user } = await authedUser()
      await db.insert(userProfiles).values({ userId: user.id, displayName: 'Visible' })
      const res = await getProfile(user.id)
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).profile.displayName).toBe('Visible')
    })

    it('GET returns 404 when no profile row exists', async () => {
      const { user } = await authedUser()
      const res = await getProfile(user.id)
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Profile not found' })
    })

    it('GET returns 400 for a non-UUID userId', async () => {
      const res = await getProfile('not-a-uuid')
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Invalid user ID format' })
    })

    it('PUT refuses a malformed userId in the URL with 400 (requireSelf)', async () => {
      const { token } = await authedUser()
      const res = await putProfile('not-a-uuid', token, { displayName: 'X' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Invalid user ID format' })
    })

    it('PUT refuses updating another user’s profile with 403 (requireSelf)', async () => {
      const { token } = await authedUser()
      const other = await createTestUser()
      const res = await putProfile(other.id, token, { displayName: 'Hijacked' })
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload)).toEqual({
        error: 'Forbidden',
        message: 'You can only access your own data',
      })
    })
  })

  // ==========================================================================
  // 2. Update validation
  // ==========================================================================

  describe('update validation', () => {
    it('rejects a username shorter than 3 characters', async () => {
      const { user, token } = await authedUser()
      const res = await putProfile(user.id, token, { username: 'ab' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Username must be between 3 and 30 characters' })
    })

    it('rejects a username longer than 30 characters', async () => {
      const { user, token } = await authedUser()
      const res = await putProfile(user.id, token, { username: 'a'.repeat(31) })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Username must be between 3 and 30 characters' })
    })

    it('rejects a username that does not start with a letter', async () => {
      const { user, token } = await authedUser()
      const res = await putProfile(user.id, token, { username: '1abcdef' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({
        error: 'Username must start with a letter and contain only letters, numbers, hyphens, and underscores',
      })
    })

    it('rejects a username with disallowed characters', async () => {
      const { user, token } = await authedUser()
      const res = await putProfile(user.id, token, { username: 'abc!def' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({
        error: 'Username must start with a letter and contain only letters, numbers, hyphens, and underscores',
      })
    })

    it('rejects an all-hex-looking username of 8+ characters', async () => {
      const { user, token } = await authedUser()
      const res = await putProfile(user.id, token, { username: 'abcdef12' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Username must contain at least one non-hex letter' })
    })

    it('rejects a reserved username', async () => {
      const { user, token } = await authedUser()
      const res = await putProfile(user.id, token, { username: 'admin' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'This username is reserved' })
      // The failed validation aborted before any DB write.
      const getRes = await getProfile(user.id)
      expect(getRes.statusCode).toBe(404)
    })

    // A canonical UUID is 36 characters, which always exceeds the 30-char max
    // and is rejected by the length check first — the dedicated "Username
    // cannot be a UUID" branch further down in the handler is unreachable in
    // practice. Documenting the actual (length) message rather than the
    // UUID-specific one.
    it('a UUID-shaped username is rejected by the length check, not the UUID check', async () => {
      const { user, token } = await authedUser()
      const res = await putProfile(user.id, token, { username: crypto.randomUUID() })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Username must be between 3 and 30 characters' })
    })
  })

  // ==========================================================================
  // Successful update: allow-list persistence
  // ==========================================================================

  describe('successful update', () => {
    it('creates a profile on first PUT (201) with only the allow-listed fields set', async () => {
      const { user, token } = await authedUser()
      const res = await putProfile(user.id, token, {
        displayName: 'Ada Lovelace',
        bio: 'Wrote the first algorithm.',
        websiteUrl: 'https://example.com',
        blueskyHandle: 'ada.bsky.social',
      })
      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.payload)
      expect(body.profile.userId).toBe(user.id)
      expect(body.profile.displayName).toBe('Ada Lovelace')
      expect(body.profile.bio).toBe('Wrote the first algorithm.')
      expect(body.profile.websiteUrl).toBe('https://example.com')
      expect(body.profile.blueskyHandle).toBe('ada.bsky.social')
    })

    it('a second PUT updates (200) and leaves unspecified fields untouched', async () => {
      const { user, token } = await authedUser()
      await putProfile(user.id, token, { displayName: 'First Name', bio: 'Original bio.' })

      const res = await putProfile(user.id, token, { displayName: 'Second Name' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.profile.displayName).toBe('Second Name')
      expect(body.profile.bio).toBe('Original bio.')
    })

    it('ignores smuggled fields (id, userId, badge, role) and never trusts a raw body spread', async () => {
      const { user, token } = await authedUser()
      const other = await createTestUser()

      const res = await putProfile(user.id, token, {
        displayName: 'Real Name',
        id: 'evil-id',
        userId: other.id,
        badge: 'owner',
        role: 'admin',
      })
      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.payload)

      // userId always comes from the URL param / requireSelf, never the body.
      expect(body.profile.userId).toBe(user.id)
      expect(body.profile.userId).not.toBe(other.id)
      expect(body.profile.displayName).toBe('Real Name')
      expect(body.profile).not.toHaveProperty('badge')
      expect(body.profile).not.toHaveProperty('role')

      // The other user was not touched.
      const otherProfile = await getProfile(other.id)
      expect(otherProfile.statusCode).toBe(404)
    })
  })

  // ==========================================================================
  // 3. Username claiming
  // ==========================================================================

  describe('username claiming', () => {
    it('claiming a free username succeeds and is reflected in the public profile', async () => {
      const { user, token } = await authedUser()
      const res = await putProfile(user.id, token, { username: 'freshusername' })
      expect(res.statusCode).toBe(201)
      expect(JSON.parse(res.payload).profile.username).toBe('freshusername')

      const pub = await getByUsername('freshusername')
      expect(pub.statusCode).toBe(200)
      expect(JSON.parse(pub.payload).profile.userId).toBe(user.id)
    })

    it('claiming a username another user holds is a 409, and re-claiming your own is fine', async () => {
      const first = await authedUser()
      const second = await authedUser()

      const firstRes = await putProfile(first.user.id, first.token, { username: 'takenname' })
      expect(firstRes.statusCode).toBe(201)

      const secondRes = await putProfile(second.user.id, second.token, { username: 'takenname' })
      expect(secondRes.statusCode).toBe(409)
      expect(JSON.parse(secondRes.payload)).toEqual({ error: 'This username is already taken' })

      // Re-claiming your own username is not a conflict with yourself.
      const again = await putProfile(first.user.id, first.token, { username: 'takenname', bio: 'still mine' })
      expect(again.statusCode).toBe(200)

      // The first claimant still owns the username.
      const pub = await getByUsername('takenname')
      expect(JSON.parse(pub.payload).profile.userId).toBe(first.user.id)
    })

    it('does not normalise case — two users can claim visually identical usernames differing only in case', async () => {
      const first = await authedUser()
      const second = await authedUser()

      const firstRes = await putProfile(first.user.id, first.token, { username: 'CamelCase' })
      expect(firstRes.statusCode).toBe(201)

      const secondRes = await putProfile(second.user.id, second.token, { username: 'camelcase' })
      expect(secondRes.statusCode).toBe(201)

      const pub1 = await getByUsername('CamelCase')
      const pub2 = await getByUsername('camelcase')
      expect(JSON.parse(pub1.payload).profile.userId).toBe(first.user.id)
      expect(JSON.parse(pub2.payload).profile.userId).toBe(second.user.id)
    })
  })

  // ==========================================================================
  // 4. Public profile — /api/users/by-username/:username
  // ==========================================================================

  describe('public profile by username', () => {
    it('returns the public shape and never leaks the user’s email', async () => {
      const { user, token } = await authedUser()
      await putProfile(user.id, token, {
        displayName: 'Public Author',
        bio: 'Bio text.',
        username: 'publicauthor',
      })

      const res = await getByUsername('publicauthor')
      expect(res.statusCode).toBe(200)
      expect(res.payload).not.toContain(user.email)

      const body = JSON.parse(res.payload)
      expect(body.profile.userId).toBe(user.id)
      expect(body.profile.username).toBe('publicauthor')
      expect(body.profile.displayName).toBe('Public Author')
      expect(body.profile.userName).toBe(user.name)
      expect(body.profile).not.toHaveProperty('email')
      expect(body.profile.followerCount).toBe(0)
      expect(body.profile.followingCount).toBe(0)
    })

    it('404s for an unknown username', async () => {
      const res = await getByUsername('no-such-user-anywhere')
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload)).toEqual({ error: 'User not found' })
    })

    it('rejects a username over 50 characters with 400', async () => {
      const res = await getByUsername('x'.repeat(51))
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Invalid username' })
    })

    it('does not 500 on odd/injection-shaped usernames that match no row', async () => {
      const res = await getByUsername("odd'chars\"--drop")
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload)).toEqual({ error: 'User not found' })
    })

    it('follower and following counts equal precisely the seeded rows', async () => {
      const { user, token } = await authedUser()
      await putProfile(user.id, token, { username: 'countedauthor' })

      const followerA = await createTestUser()
      const followerB = await createTestUser()
      const followsA = await createTestUser()

      await db.insert(userFollowers).values([
        { followerId: followerA.id, followingId: user.id },
        { followerId: followerB.id, followingId: user.id },
        { followerId: user.id, followingId: followsA.id },
      ])

      const res = await getByUsername('countedauthor')
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.profile.followerCount).toBe(2)
      expect(body.profile.followingCount).toBe(1)
    })
  })

  // ==========================================================================
  // 5. Published projects listing
  // ==========================================================================

  describe('published projects listing', () => {
    it('rejects a non-UUID userId with 400', async () => {
      const res = await getPublishedProjects('not-a-uuid')
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Invalid user ID format' })
    })

    it('lists only public, live projects that have at least one published chapter', async () => {
      const { user } = await authedUser()

      const visible = await seedProject(user.id, { name: 'Visible Project' })
      await seedPublishedChapter(visible.id, 'Chapter One')

      const noChapters = await seedProject(user.id, { name: 'No Chapters Yet' })
      void noChapters

      const privateProject = await seedProject(user.id, { name: 'Secret Project', projectVisibility: 'private' })
      await seedPublishedChapter(privateProject.id, 'Secret Chapter')

      const res = await getPublishedProjects(user.id)
      expect(res.statusCode).toBe(200)
      const { projects: listed } = JSON.parse(res.payload)

      const names = listed.map((p: { name: string }) => p.name)
      expect(names).toContain('Visible Project')
      expect(names).not.toContain('No Chapters Yet')
      expect(names).not.toContain('Secret Project')
      expect(listed).toHaveLength(1)

      const visibleEntry = listed.find((p: { id: string }) => p.id === visible.id)
      expect(visibleEntry.chapterCount).toBe(1)
    })
  })
})
