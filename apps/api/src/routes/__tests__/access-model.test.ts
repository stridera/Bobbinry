import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, jest } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import {
  users,
  projects,
  projectPublishConfig,
  entities,
  chapterPublications,
  chapterViews,
  userProfiles,
  userFollowers,
  projectFollows,
  betaReaders,
  accessGrants,
  subscriptions,
  subscriptionTiers,
  userPaymentConfig,
  notifications,
} from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'

// Operational email goes through Resend; keep it out of the suite and observable.
jest.mock('../../lib/email', () => ({
  ...(jest.requireActual('../../lib/email') as object),
  sendSubscribersDowngradedEmail: jest.fn(async () => true),
}))
import { sendSubscribersDowngradedEmail } from '../../lib/email'
import { canViewProject } from '../reader/shared'
import { downgradeUnpayableSubscriberProjects } from '../../lib/author-subscriptions'
const downgradeEmail = sendSubscribersDowngradedEmail as unknown as ReturnType<typeof jest.fn>

let counter = 0

async function seedAuthor(opts: { payments?: boolean } = {}) {
  counter++
  const user = await createTestUser()
  await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
  await db.insert(userProfiles).values({ userId: user.id, username: `author-${counter}-${Date.now()}`, displayName: `Author ${counter}` })
  if (opts.payments) await enableSubscriptions(user.id)
  return user
}

async function enableSubscriptions(authorId: string) {
  await db.insert(userPaymentConfig).values({ userId: authorId, stripeAccountId: 'acct_test', stripeOnboardingComplete: true })
  await db.insert(subscriptionTiers).values({ authorId, name: 'Supporter', tierLevel: 1, priceMonthly: '5.00' })
}

const DAY = 86_400_000

async function seedProject(
  ownerId: string,
  o: { name?: string; projectVisibility?: string; defaultVisibility?: string; publishingMode?: string } = {},
) {
  const project = await createTestProject(ownerId, { name: o.name ?? 'Project' })
  await db.insert(projectPublishConfig).values({
    projectId: project.id,
    publishingMode: o.publishingMode ?? 'live',
    projectVisibility: o.projectVisibility ?? 'public',
    defaultVisibility: o.defaultVisibility ?? 'public',
  })
  return project
}

async function publishChapter(
  projectId: string,
  title = 'Chapter',
  o: { publicReleaseDate?: Date | null; publishedAt?: Date } = {},
) {
  const [chapter] = await db.insert(entities).values({
    projectId,
    bobbinId: 'manuscript',
    collectionName: 'content',
    contentType: 'chapter',
    entityData: { title, body: '<p>Prose.</p>' },
  }).returning()
  const past = o.publishedAt ?? new Date(Date.now() - 60_000)
  await db.insert(chapterPublications).values({
    projectId,
    chapterId: chapter!.id,
    publishStatus: 'published',
    isPublished: true,
    publishedAt: past,
    publicReleaseDate: o.publicReleaseDate === undefined ? past : o.publicReleaseDate,
    firstPublishedAt: past,
    lastPublishedAt: past,
  })
  return chapter!
}

const followAuthor = (followerId: string, followingId: string) =>
  db.insert(userFollowers).values({ followerId, followingId })
const followProject = (followerId: string, projectId: string, muted = false) =>
  db.insert(projectFollows).values({ followerId, projectId, muted })
const addBeta = (authorId: string, readerId: string, projectId: string | null = null) =>
  db.insert(betaReaders).values({ authorId, readerId, projectId })

describe('Access model: feed, following, publish-config', () => {
  let app: any

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(() => { downgradeEmail.mockClear() })
  afterEach(async () => { await cleanupAllTestData() })

  async function get(url: string, userId: string) {
    const token = await createTestToken(userId)
    return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })
  }
  const feedOf = async (viewerId: string) => {
    const res = await get(`/api/users/${viewerId}/feed`, viewerId)
    expect(res.statusCode).toBe(200)
    return JSON.parse(res.payload).feed as Array<{ projectId: string; chapterTitle: string; locked: boolean }>
  }

  describe('GET /users/:userId/feed', () => {
    it('shows public chapters from followed authors and flags nothing as locked', async () => {
      const author = await seedAuthor()
      const reader = await createTestUser()
      const project = await seedProject(author.id)
      await publishChapter(project.id, 'Hello')
      await followAuthor(reader.id, author.id)

      const feed = await feedOf(reader.id)
      expect(feed).toHaveLength(1)
      expect(feed[0]).toMatchObject({ projectId: project.id, chapterTitle: 'Hello', locked: false })
    })

    it('excludes private projects unless the viewer is a beta reader or grantee', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id, { projectVisibility: 'private' })
      await publishChapter(project.id)

      const stranger = await createTestUser()
      const beta = await createTestUser()
      const grantee = await createTestUser()
      for (const u of [stranger, beta, grantee]) await followAuthor(u.id, author.id)
      await addBeta(author.id, beta.id)
      await db.insert(accessGrants).values({
        grantedTo: grantee.id, authorId: author.id, projectId: project.id, grantType: 'comp', grantedBy: author.id,
      })

      expect(await feedOf(stranger.id)).toHaveLength(0)
      expect(await feedOf(beta.id)).toHaveLength(1)
      expect(await feedOf(grantee.id)).toHaveLength(1)
    })

    it('excludes archived, trashed, and not-live projects', async () => {
      const author = await seedAuthor()
      const reader = await createTestUser()
      await followAuthor(reader.id, author.id)

      const archived = await seedProject(author.id)
      await db.update(projects).set({ isArchived: true }).where(eq(projects.id, archived.id))
      const trashed = await seedProject(author.id)
      await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, trashed.id))
      const draft = await seedProject(author.id, { publishingMode: 'draft' })
      const live = await seedProject(author.id, { name: 'Live' })
      for (const p of [archived, trashed, draft, live]) await publishChapter(p.id)

      const feed = await feedOf(reader.id)
      expect(feed.map(f => f.projectId)).toEqual([live.id])
    })

    it('excludes a muted project even when it arrives through an author follow', async () => {
      const author = await seedAuthor()
      const reader = await createTestUser()
      const muted = await seedProject(author.id)
      const other = await seedProject(author.id)
      await publishChapter(muted.id)
      await publishChapter(other.id)
      await followAuthor(reader.id, author.id)
      await followProject(reader.id, muted.id, true)

      const feed = await feedOf(reader.id)
      expect(feed.map(f => f.projectId)).toEqual([other.id])
    })

    it('subscribers-only: locked teaser when the author takes subscriptions, hidden when not, open to subscribers/beta readers', async () => {
      const payingAuthor = await seedAuthor({ payments: true })
      const brokeAuthor = await seedAuthor()
      const locked = await seedProject(payingAuthor.id, { defaultVisibility: 'subscribers_only' })
      const hidden = await seedProject(brokeAuthor.id, { defaultVisibility: 'subscribers_only' })
      await publishChapter(locked.id, 'Paid')
      await publishChapter(hidden.id, 'Unpayable')

      const plain = await createTestUser()
      const subscriber = await createTestUser()
      const beta = await createTestUser()
      for (const u of [plain, subscriber, beta]) {
        await followAuthor(u.id, payingAuthor.id)
        await followAuthor(u.id, brokeAuthor.id)
      }
      const [tier] = await db.select().from(subscriptionTiers).where(eq(subscriptionTiers.authorId, payingAuthor.id))
      await db.insert(subscriptions).values({
        subscriberId: subscriber.id, authorId: payingAuthor.id, tierId: tier!.id, status: 'active',
        currentPeriodStart: new Date(Date.now() - 86_400_000), currentPeriodEnd: new Date(Date.now() + 86_400_000),
      })
      await addBeta(payingAuthor.id, beta.id)

      const plainFeed = await feedOf(plain.id)
      expect(plainFeed).toHaveLength(1)
      expect(plainFeed[0]).toMatchObject({ projectId: locked.id, locked: true })

      const subFeed = await feedOf(subscriber.id)
      expect(subFeed).toHaveLength(1)
      expect(subFeed[0]).toMatchObject({ projectId: locked.id, locked: false })

      const betaFeed = await feedOf(beta.id)
      expect(betaFeed).toHaveLength(1)
      expect(betaFeed[0]).toMatchObject({ projectId: locked.id, locked: false })
    })

    it('hides embargoed chapters from non-privileged viewers but not from beta readers', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id)
      await publishChapter(project.id, 'Embargoed', { publicReleaseDate: new Date(Date.now() + 86_400_000) })
      const reader = await createTestUser()
      const beta = await createTestUser()
      await followAuthor(reader.id, author.id)
      await followAuthor(beta.id, author.id)
      await addBeta(author.id, beta.id)

      expect(await feedOf(reader.id)).toHaveLength(0)
      expect(await feedOf(beta.id)).toHaveLength(1)
    })

    it('hides chapters scheduled in the future, for non-subscribers and beta readers alike', async () => {
      const author = await seedAuthor({ payments: true })
      const locked = await seedProject(author.id, { defaultVisibility: 'subscribers_only' })
      const open = await seedProject(author.id)
      const future = new Date(Date.now() + 2 * DAY)
      await publishChapter(locked.id, 'Future locked', { publishedAt: future, publicReleaseDate: future })
      await publishChapter(open.id, 'Future open', { publishedAt: future, publicReleaseDate: future })
      const reader = await createTestUser()
      const beta = await createTestUser()
      for (const u of [reader, beta]) await followAuthor(u.id, author.id)
      await addBeta(author.id, beta.id)

      expect(await feedOf(reader.id)).toHaveLength(0)
      expect(await feedOf(beta.id)).toHaveLength(0)
    })

    it('shows a published-but-embargoed chapter as an upsell teaser with the cheapest tier; hides it with no qualifying tier', async () => {
      const seller = await seedAuthor({ payments: true }) // 'Supporter' at 5.00
      await db.insert(subscriptionTiers).values([
        { authorId: seller.id, name: 'Patron', tierLevel: 2, priceMonthly: '12.00' },
        { authorId: seller.id, name: 'Inactive cheap', tierLevel: 3, priceMonthly: '1.00', isActive: false },
      ])
      const noSale = await seedAuthor()
      const early = await seedProject(seller.id)
      const hiddenProj = await seedProject(noSale.id)
      const publicDate = new Date(Date.now() + 3 * DAY)
      await publishChapter(early.id, 'Early', { publicReleaseDate: publicDate })
      await publishChapter(hiddenProj.id, 'Embargoed, nothing to sell', { publicReleaseDate: publicDate })
      const reader = await createTestUser()
      await followAuthor(reader.id, seller.id)
      await followAuthor(reader.id, noSale.id)

      const feed = await feedOf(reader.id) as any[]
      expect(feed).toHaveLength(1)
      expect(feed[0]).toMatchObject({ projectId: early.id, locked: true })
      expect(feed[0].upsell).toMatchObject({ tierName: 'Supporter', priceMonthly: '5.00' })
    })

    it('carries the cheapest tier on a subscribers-only teaser, and nothing on unlocked items', async () => {
      const author = await seedAuthor({ payments: true })
      await db.insert(subscriptionTiers).values({ authorId: author.id, name: 'Patron', tierLevel: 2, priceMonthly: '12.00' })
      const project = await seedProject(author.id, { defaultVisibility: 'subscribers_only' })
      await publishChapter(project.id)
      const reader = await createTestUser()
      const beta = await createTestUser()
      for (const u of [reader, beta]) await followAuthor(u.id, author.id)
      await addBeta(author.id, beta.id)

      const [teaser] = await feedOf(reader.id) as any[]
      expect(teaser.upsell).toMatchObject({ tierName: 'Supporter' })
      const [open] = await feedOf(beta.id) as any[]
      expect(open).toMatchObject({ locked: false, upsell: null })
    })

    describe('early access (scheduled chapters)', () => {
      // A scheduled chapter has publishedAt = publicReleaseDate = its release date.
      async function setupEarlyAccess(defaultVisibility = 'public') {
        const author = await seedAuthor({ payments: true }) // 'Supporter', 5.00, 0 days
        const [early] = await db.insert(subscriptionTiers).values({
          authorId: author.id, name: 'Early Bird', tierLevel: 2, priceMonthly: '10.00', earlyAccessDays: 7,
        }).returning()
        const project = await seedProject(author.id, { defaultVisibility })
        const scheduled = (days: number, title: string) => {
          const at = new Date(Date.now() + days * DAY)
          return publishChapter(project.id, title, { publishedAt: at, publicReleaseDate: at })
        }
        const subscriber = await createTestUser()
        await db.insert(subscriptions).values({
          subscriberId: subscriber.id, authorId: author.id, tierId: early!.id, status: 'active',
          currentPeriodStart: new Date(Date.now() - DAY), currentPeriodEnd: new Date(Date.now() + 30 * DAY),
        })
        const stranger = await createTestUser()
        const beta = await createTestUser()
        for (const u of [subscriber, stranger, beta]) await followAuthor(u.id, author.id)
        await addBeta(author.id, beta.id)
        return { author, project, scheduled, subscriber, stranger, beta }
      }

      it.each(['public', 'subscribers_only'])('%s project: a 7-day subscriber reads a chapter 3 days out; a stranger gets an upsell for the cheapest tier with >= 3 days', async (visibility) => {
        const { scheduled, subscriber, stranger, beta } = await setupEarlyAccess(visibility)
        await scheduled(3, 'Soon')

        const [forSub] = await feedOf(subscriber.id) as any[]
        expect(forSub).toMatchObject({ chapterTitle: 'Soon', locked: false, upsell: null })

        const [teaser] = await feedOf(stranger.id) as any[]
        expect(teaser).toMatchObject({ chapterTitle: 'Soon', locked: true })
        expect(teaser.upsell).toMatchObject({ tierName: 'Early Bird', priceMonthly: '10.00' }) // not the 0-day Supporter

        expect(await feedOf(beta.id)).toHaveLength(0) // beta readers wait for publishedAt
      })

      it('reactions and comments follow the same viewer-aware gate as the chapter: 200 for an early-access subscriber, 404 for anonymous and non-subscribers', async () => {
        const { scheduled, subscriber, stranger } = await setupEarlyAccess()
        const chapter = await scheduled(3, 'Early')
        const url = (kind: string) => `/api/public/chapters/${chapter.id}/${kind}`
        const as = async (userId: string | null, kind: string) => app.inject({
          method: 'GET', url: url(kind),
          headers: userId ? { authorization: `Bearer ${await createTestToken(userId)}` } : {},
        })

        for (const kind of ['reactions', 'comments']) {
          expect((await as(subscriber.id, kind)).statusCode).toBe(200)
          expect((await as(null, kind)).statusCode).toBe(404)
          expect((await as(stranger.id, kind)).statusCode).toBe(404)
        }
      })

      it('hides a chapter 30 days out (longest window is 7) from everyone, owner and beta readers included', async () => {
        const { author, scheduled, subscriber, stranger, beta } = await setupEarlyAccess()
        await scheduled(30, 'Far away')
        for (const u of [subscriber, stranger, beta]) expect(await feedOf(u.id)).toHaveLength(0)
        // Owner view: their own work never feeds them, so check the privileged lane via a project-wide grant.
        const grantee = await createTestUser()
        await followAuthor(grantee.id, author.id)
        await db.insert(accessGrants).values({
          grantedTo: grantee.id, authorId: author.id, grantType: 'comp', grantedBy: author.id,
        })
        expect(await feedOf(grantee.id)).toHaveLength(0)
      })

      it('sorts by when each chapter became visible to the viewer, not by its release date', async () => {
        const { project, scheduled, subscriber, stranger } = await setupEarlyAccess()
        await scheduled(6, 'Early access (6 days out)') // visible to the 7-day tier since yesterday
        await publishChapter(project.id, 'Published two days ago', { publishedAt: new Date(Date.now() - 2 * DAY) })
        await scheduled(1, 'Early access (1 day out)') // visible since 6 days ago

        for (const viewer of [subscriber, stranger]) {
          const titles = (await feedOf(viewer.id)).map(f => f.chapterTitle)
          expect(titles).toEqual(['Early access (6 days out)', 'Published two days ago', 'Early access (1 day out)'])
        }
      })
    })

    it('ignores an expired grant on a private project', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id, { projectVisibility: 'private' })
      await publishChapter(project.id)
      const grantee = await createTestUser()
      await followAuthor(grantee.id, author.id)
      await db.insert(accessGrants).values({
        grantedTo: grantee.id, authorId: author.id, projectId: project.id, grantType: 'comp',
        grantedBy: author.id, expiresAt: new Date(Date.now() - DAY),
      })
      expect(await feedOf(grantee.id)).toHaveLength(0)
      expect(await canViewProject(project.id, grantee.id)).toBe(false)

      await db.update(accessGrants).set({ expiresAt: new Date(Date.now() + DAY) })
      expect(await canViewProject(project.id, grantee.id)).toBe(true)
    })

    it('a chapter-scoped grant opens only that chapter: private project, and unlocked within subscribers-only', async () => {
      const author = await seedAuthor({ payments: true })
      const priv = await seedProject(author.id, { projectVisibility: 'private' })
      const privA = await publishChapter(priv.id, 'Granted')
      await publishChapter(priv.id, 'Not granted')
      const subs = await seedProject(author.id, { defaultVisibility: 'subscribers_only' })
      const subsA = await publishChapter(subs.id, 'Granted too')
      await publishChapter(subs.id, 'Still locked')
      const reader = await createTestUser()
      await followAuthor(reader.id, author.id)
      for (const [projectId, chapterId] of [[priv.id, privA.id], [subs.id, subsA.id]] as const) {
        await db.insert(accessGrants).values({
          grantedTo: reader.id, authorId: author.id, projectId, chapterId, grantType: 'comp', grantedBy: author.id,
        })
      }

      const feed = await feedOf(reader.id)
      const byTitle = Object.fromEntries(feed.map(f => [f.chapterTitle, f]))
      expect(Object.keys(byTitle).sort()).toEqual(['Granted', 'Granted too', 'Still locked'])
      expect(byTitle['Granted']!.locked).toBe(false)
      expect(byTitle['Granted too']!.locked).toBe(false)
      expect(byTitle['Still locked']!.locked).toBe(true)
    })

    it('never shows the viewer their own work', async () => {
      const author = await seedAuthor()
      const own = await seedProject(author.id)
      await publishChapter(own.id)
      // Self-follows are rejected by the API, but rows can exist from older data.
      await followAuthor(author.id, author.id)
      await db.insert(projectFollows).values({ followerId: author.id, projectId: own.id })

      expect(await feedOf(author.id)).toHaveLength(0)
    })
  })

  describe('GET /users/:userId/reading-progress', () => {
    it('omits the viewer own projects', async () => {
      const author = await seedAuthor()
      const reader = await createTestUser()
      const mine = await seedProject(reader.id)
      const theirs = await seedProject(author.id)
      const myChapter = await publishChapter(mine.id, 'Mine')
      const theirChapter = await publishChapter(theirs.id, 'Theirs')
      await db.insert(chapterViews).values([
        { chapterId: myChapter.id, readerId: reader.id },
        { chapterId: theirChapter.id, readerId: reader.id },
      ])

      const res = await get(`/api/users/${reader.id}/reading-progress`, reader.id)
      expect(res.statusCode).toBe(200)
      const { progress } = JSON.parse(res.payload)
      expect(progress.map((p: any) => p.chapterTitle)).toEqual(['Theirs'])
    })
  })

  describe('GET /users/:userId/following', () => {
    it('lists authors and projects with access status, keeping follows when visibility changes', async () => {
      const author = await seedAuthor({ payments: true })
      const reader = await createTestUser()
      await followAuthor(reader.id, author.id)

      const ok = await seedProject(author.id, { name: 'Open' })
      const beta = await seedProject(author.id, { name: 'Beta', projectVisibility: 'private' })
      const subs = await seedProject(author.id, { name: 'Subs', defaultVisibility: 'subscribers_only' })
      const gone = await seedProject(author.id, { name: 'Gone' })
      await db.update(projects).set({ isArchived: true }).where(eq(projects.id, gone.id))
      const draft = await seedProject(author.id, { name: 'Draft', publishingMode: 'draft' })
      for (const p of [ok, beta, subs, gone, draft]) await followProject(reader.id, p.id, p.id === subs.id)

      const res = await get(`/api/users/${reader.id}/following`, reader.id)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.authors).toHaveLength(1)
      expect(body.authors[0]).toMatchObject({ id: author.id, displayName: expect.stringContaining('Author') })

      const byId = Object.fromEntries(body.projects.map((p: any) => [p.id, p]))
      expect(byId[ok.id]).toMatchObject({ accessStatus: 'ok', name: 'Open', authorUsername: expect.any(String) })
      expect(byId[subs.id]).toMatchObject({ accessStatus: 'subscribers_only', name: 'Subs', muted: true })
      // No longer openable: details withheld, the row stays so it can be unfollowed.
      for (const p of [beta, gone, draft]) {
        expect(byId[p.id]).toMatchObject({ name: null, slug: null, coverImage: null, authorUsername: expect.any(String) })
      }
      expect(byId[beta.id].accessStatus).toBe('beta_only')
      expect(byId[gone.id].accessStatus).toBe('unavailable')
      expect(byId[draft.id].accessStatus).toBe('unavailable')

      // Trashed projects are left out entirely.
      const trashed = await seedProject(author.id, { name: 'Trashed' })
      await followProject(reader.id, trashed.id)
      await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, trashed.id))
      const again = JSON.parse((await get(`/api/users/${reader.id}/following`, reader.id)).payload)
      expect(again.projects.map((p: any) => p.id)).not.toContain(trashed.id)
    })

    it('reports ok for a beta reader on a private project, and refuses other users', async () => {
      const author = await seedAuthor()
      const reader = await createTestUser()
      const project = await seedProject(author.id, { projectVisibility: 'private' })
      await followProject(reader.id, project.id)
      await addBeta(author.id, reader.id)

      const res = await get(`/api/users/${reader.id}/following`, reader.id)
      expect(JSON.parse(res.payload).projects[0].accessStatus).toBe('ok')

      const other = await createTestUser()
      expect((await get(`/api/users/${reader.id}/following`, other.id)).statusCode).toBe(403)
    })
  })

  describe('PUT/GET /projects/:projectId/publish-config', () => {
    async function put(projectId: string, userId: string, payload: Record<string, unknown>) {
      const token = await createTestToken(userId)
      return app.inject({
        method: 'PUT',
        url: `/api/projects/${projectId}/publish-config`,
        headers: { authorization: `Bearer ${token}` },
        payload,
      })
    }

    it('rejects subscribers_only when the author cannot take subscriptions', async () => {
      const author = await seedAuthor()
      const project = await createTestProject(author.id)
      const res = await put(project.id, author.id, { defaultVisibility: 'subscribers_only' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toMatch(/payments/i)
    })

    it('rejects subscribers_only with Stripe but no active tier', async () => {
      const author = await seedAuthor()
      await db.insert(userPaymentConfig).values({ userId: author.id, stripeAccountId: 'acct_x', stripeOnboardingComplete: true })
      const project = await createTestProject(author.id)
      expect((await put(project.id, author.id, { defaultVisibility: 'subscribers_only' })).statusCode).toBe(400)
    })

    it('accepts subscribers_only once payments and a tier exist', async () => {
      const author = await seedAuthor({ payments: true })
      const project = await createTestProject(author.id)
      const res = await put(project.id, author.id, { defaultVisibility: 'subscribers_only', projectVisibility: 'unlisted' })
      expect([200, 201]).toContain(res.statusCode)
      expect(JSON.parse(res.payload).config.defaultVisibility).toBe('subscribers_only')
    })

    it('re-sending the current subscribers_only value is allowed after payments lapse', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id, { defaultVisibility: 'subscribers_only' })
      const res = await put(project.id, author.id, { defaultVisibility: 'subscribers_only', enableComments: false })
      expect([200, 201]).toContain(res.statusCode)
      // Switching *to* it still needs payments.
      const other = await seedProject(author.id)
      expect((await put(other.id, author.id, { defaultVisibility: 'subscribers_only' })).statusCode).toBe(400)
    })

    it("rejects defaultVisibility 'private' and unknown values", async () => {
      const author = await seedAuthor({ payments: true })
      const project = await createTestProject(author.id)
      expect((await put(project.id, author.id, { defaultVisibility: 'private' })).statusCode).toBe(400)
      expect((await put(project.id, author.id, { defaultVisibility: 'nope' })).statusCode).toBe(400)
      // The supported way to say "beta readers only".
      const ok = await put(project.id, author.id, { projectVisibility: 'private', defaultVisibility: 'public' })
      expect([200, 201]).toContain(ok.statusCode)
    })

    it('GET reports acceptsSubscriptions and the beta-reader count (project + author-wide, active only)', async () => {
      const author = await seedAuthor()
      const project = await createTestProject(author.id)
      const otherProject = await createTestProject(author.id)
      const [r1, r2, r3, r4] = await Promise.all([createTestUser(), createTestUser(), createTestUser(), createTestUser()])
      await addBeta(author.id, r1!.id) // author-wide
      await addBeta(author.id, r2!.id, project.id) // this project
      await addBeta(author.id, r3!.id, otherProject.id) // a different project: not counted
      await db.insert(betaReaders).values({ authorId: author.id, readerId: r4!.id, isActive: false }) // inactive

      const token = await createTestToken(author.id)
      const res = await app.inject({
        method: 'GET', url: `/api/projects/${project.id}/publish-config`, headers: { authorization: `Bearer ${token}` },
      })
      const body = JSON.parse(res.payload)
      expect(body.betaReaderCount).toBe(2)
      expect(body.acceptsSubscriptions).toBe(false)
    })
  })

  describe('automatic downgrade when subscriptions stop being possible', () => {
    async function putTier(authorId: string, tierId: string, payload: Record<string, unknown>) {
      return app.inject({
        method: 'PUT',
        url: `/api/users/${authorId}/subscription-tiers/${tierId}`,
        headers: { authorization: `Bearer ${await createTestToken(authorId)}` },
        payload,
      })
    }
    const cfg = async (id: string) =>
      (await db.select().from(projectPublishConfig).where(eq(projectPublishConfig.projectId, id)))[0]!

    it('deactivating the last active tier moves the author projects to beta only, notifies once, and leaves others alone', async () => {
      const author = await seedAuthor({ payments: true })
      const bystander = await seedAuthor({ payments: true })
      const a = await seedProject(author.id, { name: 'Alpha', defaultVisibility: 'subscribers_only' })
      const b = await seedProject(author.id, { name: 'Beta', defaultVisibility: 'subscribers_only' })
      const publicOne = await seedProject(author.id, { name: 'Open' })
      const other = await seedProject(bystander.id, { defaultVisibility: 'subscribers_only' })
      const [tier] = await db.select().from(subscriptionTiers).where(eq(subscriptionTiers.authorId, author.id))

      const res = await putTier(author.id, tier!.id, { isActive: false })
      expect(res.statusCode).toBe(200)

      expect(await cfg(a.id)).toMatchObject({ projectVisibility: 'private', defaultVisibility: 'public' })
      expect(await cfg(b.id)).toMatchObject({ projectVisibility: 'private', defaultVisibility: 'public' })
      expect(await cfg(publicOne.id)).toMatchObject({ projectVisibility: 'public', defaultVisibility: 'public' })
      expect(await cfg(other.id)).toMatchObject({ projectVisibility: 'public', defaultVisibility: 'subscribers_only' })

      expect(downgradeEmail).toHaveBeenCalledTimes(1)
      const [, titles, reason] = downgradeEmail.mock.calls[0] as [string, string[], string]
      expect([...titles].sort()).toEqual(['Alpha', 'Beta'])
      expect(reason).toBe('no_active_tiers')

      const notes = await db.select().from(notifications).where(eq(notifications.recipientId, author.id))
      expect(notes).toHaveLength(1)
      expect(notes[0]!.type).toBe('subscribers_downgraded')
      expect([...(notes[0]!.metadata?.projectIds ?? [])].sort()).toEqual([a.id, b.id].sort())

      // The dashboard banner marker, then not for an unrelated project.
      const getCfg = async (id: string) => JSON.parse((await get(`/api/projects/${id}/publish-config`, author.id)).payload)
      expect((await getCfg(a.id)).autoDowngraded).toBe(true)
      expect((await getCfg(publicOne.id)).autoDowngraded).toBe(false)

      // Nothing left to move: no second email or notification.
      expect((await putTier(author.id, tier!.id, { isActive: false })).statusCode).toBe(200)
      expect(downgradeEmail).toHaveBeenCalledTimes(1)
      expect(await db.select().from(notifications).where(eq(notifications.recipientId, author.id))).toHaveLength(1)
    })

    it('does nothing while another active tier remains, and also runs when the last tier is deleted', async () => {
      const author = await seedAuthor({ payments: true })
      const project = await seedProject(author.id, { defaultVisibility: 'subscribers_only' })
      const [first] = await db.select().from(subscriptionTiers).where(eq(subscriptionTiers.authorId, author.id))
      const [second] = await db.insert(subscriptionTiers).values({ authorId: author.id, name: 'Two', tierLevel: 2, priceMonthly: '9.00' }).returning()

      await putTier(author.id, first!.id, { isActive: false })
      expect(await cfg(project.id)).toMatchObject({ defaultVisibility: 'subscribers_only' })
      expect(downgradeEmail).not.toHaveBeenCalled()

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/users/${author.id}/subscription-tiers/${second!.id}`,
        headers: { authorization: `Bearer ${await createTestToken(author.id)}` },
      })
      expect(del.statusCode).toBe(200)
      expect(await cfg(project.id)).toMatchObject({ projectVisibility: 'private', defaultVisibility: 'public' })
      expect(downgradeEmail).toHaveBeenCalledTimes(1)
    })

    it('deleting a tier that has subscriptions deactivates it instead (200, deactivated), and still downgrades', async () => {
      const author = await seedAuthor({ payments: true })
      const project = await seedProject(author.id, { defaultVisibility: 'subscribers_only' })
      const [tier] = await db.select().from(subscriptionTiers).where(eq(subscriptionTiers.authorId, author.id))
      const subscriber = await createTestUser()
      await db.insert(subscriptions).values({
        subscriberId: subscriber.id, authorId: author.id, tierId: tier!.id, status: 'canceled',
        currentPeriodStart: new Date(Date.now() - 60 * DAY), currentPeriodEnd: new Date(Date.now() - 30 * DAY),
      })

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/users/${author.id}/subscription-tiers/${tier!.id}`,
        headers: { authorization: `Bearer ${await createTestToken(author.id)}` },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.deactivated).toBe(true)
      expect(body.message).toMatch(/existing subscribers keep it/i)

      const [after] = await db.select().from(subscriptionTiers).where(eq(subscriptionTiers.id, tier!.id))
      expect(after).toMatchObject({ isActive: false })
      expect(await cfg(project.id)).toMatchObject({ projectVisibility: 'private', defaultVisibility: 'public' })
      expect(downgradeEmail).toHaveBeenCalledTimes(1)
    })

    it('while Stripe has paused payments, an active subscriber keeps reading and the unchanged value can be re-saved', async () => {
      const author = await seedAuthor({ payments: true })
      const project = await seedProject(author.id, { defaultVisibility: 'subscribers_only' })
      const chapter = await publishChapter(project.id, 'Members')
      const [tier] = await db.select().from(subscriptionTiers).where(eq(subscriptionTiers.authorId, author.id))
      const subscriber = await createTestUser()
      const stranger = await createTestUser()
      await db.insert(subscriptions).values({
        subscriberId: subscriber.id, authorId: author.id, tierId: tier!.id, status: 'active',
        currentPeriodStart: new Date(Date.now() - DAY), currentPeriodEnd: new Date(Date.now() + 30 * DAY),
      })
      for (const u of [subscriber, stranger]) await followAuthor(u.id, author.id)

      // account.updated with charges disabled clears this flag (see stripe-webhook.test.ts).
      await db.update(userPaymentConfig).set({ stripeOnboardingComplete: false }).where(eq(userPaymentConfig.userId, author.id))

      const read = async (userId: string) => app.inject({
        method: 'GET', url: `/api/public/chapters/${chapter.id}/reactions`,
        headers: { authorization: `Bearer ${await createTestToken(userId)}` },
      })
      expect((await read(subscriber.id)).statusCode).toBe(200)
      expect((await read(stranger.id)).statusCode).toBe(404)

      const [mine] = await feedOf(subscriber.id)
      expect(mine).toMatchObject({ chapterTitle: 'Members', locked: false })
      expect(await feedOf(stranger.id)).toHaveLength(0) // no way to subscribe right now: hidden, not teased

      const res = await app.inject({
        method: 'PUT', url: `/api/projects/${project.id}/publish-config`,
        headers: { authorization: `Bearer ${await createTestToken(author.id)}` },
        payload: { defaultVisibility: 'subscribers_only' },
      })
      expect([200, 201]).toContain(res.statusCode)
    })

    it('a Stripe disconnect moves projects and reports no_stripe; with nothing to move it stays silent', async () => {
      const author = await seedAuthor({ payments: true })
      const project = await seedProject(author.id, { name: 'Paywalled', defaultVisibility: 'subscribers_only' })

      await db.update(userPaymentConfig).set({ stripeAccountId: null, stripeOnboardingComplete: false })
        .where(eq(userPaymentConfig.userId, author.id))
      const moved = await downgradeUnpayableSubscriberProjects(author.id)
      expect(moved).toEqual([{ id: project.id, name: 'Paywalled' }])
      expect(downgradeEmail).toHaveBeenCalledTimes(1)
      expect((downgradeEmail.mock.calls[0] as unknown[])[2]).toBe('no_stripe')

      expect(await downgradeUnpayableSubscriberProjects(author.id)).toEqual([])
      expect(downgradeEmail).toHaveBeenCalledTimes(1)
    })
  })

  describe('migration 0051 SQL', () => {
    it('moves unpayable subscribers-only and private-default projects to beta only, idempotently', async () => {
      const { readFileSync } = await import('fs')
      const { resolve } = await import('path')
      const { sql } = await import('drizzle-orm')
      const text = readFileSync(
        resolve(__dirname, '../../../../../infra/db/migrations/0051_subscribers_only_without_payments_to_beta.sql'), 'utf-8')
      const statements = text.split('--> statement-breakpoint')

      const payer = await seedAuthor({ payments: true })
      const broke = await seedAuthor()
      const keep = await seedProject(payer.id, { defaultVisibility: 'subscribers_only' })
      const move = await seedProject(broke.id, { defaultVisibility: 'subscribers_only' })
      const legacyPrivate = await seedProject(payer.id, { defaultVisibility: 'private' })

      for (let i = 0; i < 2; i++) for (const st of statements) await db.execute(sql.raw(st))

      const cfg = async (id: string) =>
        (await db.select().from(projectPublishConfig).where(eq(projectPublishConfig.projectId, id)))[0]!
      expect(await cfg(keep.id)).toMatchObject({ defaultVisibility: 'subscribers_only', projectVisibility: 'public' })
      expect(await cfg(move.id)).toMatchObject({ defaultVisibility: 'public', projectVisibility: 'private' })
      expect(await cfg(legacyPrivate.id)).toMatchObject({ defaultVisibility: 'public', projectVisibility: 'private' })
    })
  })
})
