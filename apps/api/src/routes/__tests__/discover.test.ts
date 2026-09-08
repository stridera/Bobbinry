import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import {
  entities,
  chapterPublications,
  chapterViews,
  reactions,
  contentTags,
  projects,
  projectPublishConfig,
  userProfiles,
  userFollowers,
  userBadges,
  siteMemberships,
  projectCollections,
  projectCollectionMemberships,
} from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'

let usernameCounter = 0
let shortUrlCounter = 0

/** Author with a claimed username. */
async function seedAuthor(overrides: { username?: string; displayName?: string; bio?: string } = {}) {
  usernameCounter++
  const user = await createTestUser()
  await db.insert(userProfiles).values({
    userId: user.id,
    username: overrides.username ?? `author-${usernameCounter}-${Date.now()}`,
    displayName: overrides.displayName ?? 'Test Author',
    bio: overrides.bio,
  })
  return user
}

/** Project with a claimed shortUrl + a publish config row (defaults to public/live). */
async function seedProject(
  ownerId: string,
  overrides: {
    name?: string
    shortUrl?: string
    projectVisibility?: string
    publishingMode?: string
    defaultVisibility?: string
    updatedAt?: Date
  } = {}
) {
  shortUrlCounter++
  const project = await createTestProject(ownerId, { name: overrides.name ?? 'Test Project' })
  const shortUrl = overrides.shortUrl ?? `project-${shortUrlCounter}-${Date.now()}`
  await db.update(projects).set({ shortUrl, updatedAt: overrides.updatedAt }).where(eq(projects.id, project.id))
  await db.insert(projectPublishConfig).values({
    projectId: project.id,
    publishingMode: overrides.publishingMode ?? 'live',
    projectVisibility: overrides.projectVisibility ?? 'public',
    defaultVisibility: overrides.defaultVisibility ?? 'public',
  })
  return { ...project, shortUrl }
}

/** A `content`-collection chapter entity. */
async function seedChapter(projectId: string, overrides: { title?: string } = {}) {
  const [chapter] = await db.insert(entities).values({
    projectId,
    bobbinId: 'manuscript',
    collectionName: 'content',
    contentType: 'chapter',
    entityData: { title: overrides.title ?? 'Chapter 1', body: '<p>Prose.</p>', word_count: 4 },
  }).returning()
  return chapter!
}

/** Marks a chapter published via a `chapter_publications` row. */
async function publishChapter(
  chapter: { id: string },
  projectId: string,
  overrides: { isPublished?: boolean; viewCount?: number } = {}
) {
  const now = new Date()
  const [row] = await db.insert(chapterPublications).values({
    projectId,
    chapterId: chapter.id,
    publishStatus: 'published',
    isPublished: overrides.isPublished ?? true,
    publishedAt: now,
    publicReleaseDate: now,
    firstPublishedAt: now,
    lastPublishedAt: now,
    viewCount: overrides.viewCount ?? 0,
  }).returning()
  return row!
}

/** Convenience: a fully public, live project with one published chapter. */
async function seedDiscoverableProject(
  ownerId: string,
  overrides: { name?: string; updatedAt?: Date; viewCount?: number; defaultVisibility?: string } = {}
) {
  const project = await seedProject(ownerId, {
    name: overrides.name,
    updatedAt: overrides.updatedAt,
    defaultVisibility: overrides.defaultVisibility,
  })
  const chapter = await seedChapter(project.id)
  const pub = await publishChapter(chapter, project.id, { viewCount: overrides.viewCount })
  return { project, chapter, pub }
}

async function addTag(projectId: string, name: string, category = 'genre') {
  await db.insert(contentTags).values({ projectId, tagName: name, tagCategory: category })
}

async function addChapterView(chapterId: string, startedAt: Date = new Date()) {
  await db.insert(chapterViews).values({ chapterId, startedAt })
}

async function addReaction(chapterId: string, userId: string) {
  await db.insert(reactions).values({ chapterId, userId, reactionType: 'heart' })
}

async function makeSupporter(userId: string) {
  await db.insert(siteMemberships).values({ userId, tier: 'supporter', status: 'active' })
}

async function addFollower(followerId: string, followingId: string) {
  await db.insert(userFollowers).values({ followerId, followingId })
}

async function addBadge(userId: string, badge: string, overrides: { isActive?: boolean; expiresAt?: Date | null } = {}) {
  await db.insert(userBadges).values({
    userId,
    badge,
    isActive: overrides.isActive ?? true,
    expiresAt: overrides.expiresAt,
  })
}

async function createCollection(userId: string, name: string) {
  const [coll] = await db.insert(projectCollections).values({ userId, name }).returning()
  return coll!
}

async function addToCollection(collectionId: string, projectId: string) {
  await db.insert(projectCollectionMemberships).values({ collectionId, projectId })
}

describe('Discover routes', () => {
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

  function inject(url: string, token?: string) {
    return app.inject({
      method: 'GET',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  }

  describe('GET /discover/projects', () => {
    it('only lists a public, live project with a published chapter — private, unlisted, chapterless and trashed projects are all hidden', async () => {
      const author = await seedAuthor()
      const { project: visible } = await seedDiscoverableProject(author.id, { name: 'Visible Project' })

      const privateProject = await seedProject(author.id, { name: 'Private Project', projectVisibility: 'private' })
      const privChapter = await seedChapter(privateProject.id)
      await publishChapter(privChapter, privateProject.id)

      const unlistedProject = await seedProject(author.id, { name: 'Unlisted Project', projectVisibility: 'unlisted' })
      const unlChapter = await seedChapter(unlistedProject.id)
      await publishChapter(unlChapter, unlistedProject.id)

      // Public, live, but no published chapter at all.
      const emptyProject = await seedProject(author.id, { name: 'Empty Project' })
      await seedChapter(emptyProject.id) // never published

      // Public, live, chapter exists but explicitly unpublished.
      const unpubProject = await seedProject(author.id, { name: 'Unpublished Chapter Project' })
      const unpubChapter = await seedChapter(unpubProject.id)
      await publishChapter(unpubChapter, unpubProject.id, { isPublished: false })

      // Soft-deleted (trashed) project — otherwise fully public/live/published.
      const { project: trashedProject } = await seedDiscoverableProject(author.id, { name: 'Trashed Project' })
      await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, trashedProject.id))

      // Draft publishing mode — public visibility but not live.
      const draftProject = await seedProject(author.id, { name: 'Draft Project', publishingMode: 'draft' })
      const draftChapter = await seedChapter(draftProject.id)
      await publishChapter(draftChapter, draftProject.id)

      const res = await inject('/api/discover/projects')
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.total).toBe(1)
      expect(body.projects).toHaveLength(1)
      expect(body.projects[0].id).toBe(visible.id)
      expect(body.projects[0].name).toBe('Visible Project')
    })

    describe('search', () => {
      it('matches a project by title (case-insensitive) and returns nothing for a non-matching term', async () => {
        const author = await seedAuthor()
        const { project } = await seedDiscoverableProject(author.id, { name: 'The Dragonfire Chronicles' })

        const hit = await inject('/api/discover/projects?q=DRAGONFIRE')
        const hitBody = JSON.parse(hit.payload)
        expect(hitBody.total).toBe(1)
        expect(hitBody.projects[0].id).toBe(project.id)

        const miss = await inject('/api/discover/projects?q=nonexistentterm')
        expect(miss.statusCode).toBe(200)
        const missBody = JSON.parse(miss.payload)
        expect(missBody).toEqual({ projects: [], total: 0, hasMore: false })
      })

      it('does not return a private project even if the search term matches its title', async () => {
        const author = await seedAuthor()
        const project = await seedProject(author.id, { name: 'Secret Society Diaries', projectVisibility: 'private' })
        const chapter = await seedChapter(project.id)
        await publishChapter(chapter, project.id)

        const res = await inject('/api/discover/projects?q=Secret+Society')
        const body = JSON.parse(res.payload)
        expect(body).toEqual({ projects: [], total: 0, hasMore: false })
      })
    })

    describe('sorting', () => {
      it('sorts "recent" by updatedAt descending', async () => {
        const author = await seedAuthor()
        const base = new Date()
        const older = (mins: number) => new Date(base.getTime() - mins * 60_000)
        const { project: p1 } = await seedDiscoverableProject(author.id, { name: 'Newest', updatedAt: older(0) })
        const { project: p2 } = await seedDiscoverableProject(author.id, { name: 'Middle', updatedAt: older(10) })
        const { project: p3 } = await seedDiscoverableProject(author.id, { name: 'Oldest', updatedAt: older(20) })

        const res = await inject('/api/discover/projects?sort=recent')
        const body = JSON.parse(res.payload)
        expect(body.projects.map((p: any) => p.id)).toEqual([p1.id, p2.id, p3.id])
      })

      it('sorts "popular" by summed chapter view count, boosted 1.2x for active site supporters', async () => {
        const nonSupporter = await seedAuthor({ username: 'plain-author' })
        const supporter = await seedAuthor({ username: 'supporter-author' })
        await makeSupporter(supporter.id)

        // Raw views: A=110, B=100. B is a supporter so its effective score is
        // 100 * 1.2 = 120, which should outrank A's 110.
        const { project: projectA } = await seedDiscoverableProject(nonSupporter.id, { name: 'Higher Raw Views', viewCount: 110 })
        const { project: projectB } = await seedDiscoverableProject(supporter.id, { name: 'Supporter Boosted', viewCount: 100 })

        const res = await inject('/api/discover/projects?sort=popular')
        const body = JSON.parse(res.payload)
        expect(body.projects.map((p: any) => p.id)).toEqual([projectB.id, projectA.id])
      })

      it('sorts "trending" by chapter views recorded in the last 30 days', async () => {
        const author = await seedAuthor()
        const { project: hot, chapter: hotChapter } = await seedDiscoverableProject(author.id, { name: 'Hot Right Now' })
        const { project: cool, chapter: coolChapter } = await seedDiscoverableProject(author.id, { name: 'Barely Read' })

        for (let i = 0; i < 3; i++) await addChapterView(hotChapter.id)
        await addChapterView(coolChapter.id)

        const res = await inject('/api/discover/projects?sort=trending')
        const body = JSON.parse(res.payload)
        expect(body.projects.map((p: any) => p.id)).toEqual([hot.id, cool.id])
      })

      it('sorts "most_liked" by reaction count', async () => {
        const author = await seedAuthor()
        const reader = await createTestUser()
        const { project: loved, chapter: lovedChapter } = await seedDiscoverableProject(author.id, { name: 'Crowd Favorite' })
        const { project: meh, chapter: mehChapter } = await seedDiscoverableProject(author.id, { name: 'Mild Reception' })

        await addReaction(lovedChapter.id, reader.id)
        await addReaction(mehChapter.id, (await createTestUser()).id)
        // give `loved` two more reactions from distinct users
        await addReaction(lovedChapter.id, (await createTestUser()).id)
        await addReaction(lovedChapter.id, (await createTestUser()).id)

        const res = await inject('/api/discover/projects?sort=most_liked')
        const body = JSON.parse(res.payload)
        expect(body.projects.map((p: any) => p.id)).toEqual([loved.id, meh.id])
      })
    })

    describe('pagination', () => {
      async function seedFive(author: { id: string }) {
        const base = new Date()
        const older = (mins: number) => new Date(base.getTime() - mins * 60_000)
        const out = []
        for (let i = 0; i < 5; i++) {
          const { project } = await seedDiscoverableProject(author.id, { name: `Project ${i}`, updatedAt: older(i * 10) })
          out.push(project)
        }
        return out
      }

      it('applies default limit/offset, returns total and hasMore correctly, and paginates in order', async () => {
        const author = await seedAuthor()
        const five = await seedFive(author)

        const def = await inject('/api/discover/projects')
        const defBody = JSON.parse(def.payload)
        expect(defBody.total).toBe(5)
        expect(defBody.projects.map((p: any) => p.id)).toEqual(five.map(p => p.id))
        expect(defBody.hasMore).toBe(false)

        const page1 = await inject('/api/discover/projects?limit=2&offset=0')
        const page1Body = JSON.parse(page1.payload)
        expect(page1Body.projects.map((p: any) => p.id)).toEqual([five[0]!.id, five[1]!.id])
        expect(page1Body.hasMore).toBe(true)

        const page2 = await inject('/api/discover/projects?limit=2&offset=2')
        const page2Body = JSON.parse(page2.payload)
        expect(page2Body.projects.map((p: any) => p.id)).toEqual([five[2]!.id, five[3]!.id])
        expect(page2Body.hasMore).toBe(true)

        const page3 = await inject('/api/discover/projects?limit=2&offset=4')
        const page3Body = JSON.parse(page3.payload)
        expect(page3Body.projects.map((p: any) => p.id)).toEqual([five[4]!.id])
        expect(page3Body.hasMore).toBe(false)
      })

      it('clamps a negative limit up to 1, and negative offset up to 0', async () => {
        const author = await seedAuthor()
        const five = await seedFive(author)

        // limit=0 is falsy, so `parseInt(limitStr) || 20` falls through to the
        // *default* of 20 rather than clamping to the floor of 1 — a negative
        // value is needed to actually exercise Math.max(..., 1).
        const negLimit = await inject('/api/discover/projects?limit=-3')
        const negLimitBody = JSON.parse(negLimit.payload)
        expect(negLimitBody.projects).toHaveLength(1)
        expect(negLimitBody.projects[0].id).toBe(five[0]!.id)

        const zeroLimit = await inject('/api/discover/projects?limit=0')
        expect(JSON.parse(zeroLimit.payload).projects.map((p: any) => p.id)).toEqual(five.map(p => p.id))

        const negOffset = await inject('/api/discover/projects?offset=-10')
        expect(JSON.parse(negOffset.payload).projects.map((p: any) => p.id)).toEqual(five.map(p => p.id))
      })
    })

    describe('genre filter', () => {
      it('returns a project with the matching genre tag, excludes one without it, and returns an empty envelope for an unknown tag', async () => {
        const author = await seedAuthor()
        const { project: fantasyProject } = await seedDiscoverableProject(author.id, { name: 'Fantasy Book' })
        await addTag(fantasyProject.id, 'fantasy', 'genre')
        const { project: romanceProject } = await seedDiscoverableProject(author.id, { name: 'Romance Book' })
        await addTag(romanceProject.id, 'romance', 'genre')

        const match = await inject('/api/discover/projects?genre=fantasy')
        const matchBody = JSON.parse(match.payload)
        expect(matchBody.total).toBe(1)
        expect(matchBody.projects[0].id).toBe(fantasyProject.id)

        const unknown = await inject('/api/discover/projects?genre=nonexistent-genre')
        expect(JSON.parse(unknown.payload)).toEqual({ projects: [], total: 0, hasMore: false })
      })

      it('matches genre case-insensitively but requires an exact tag name, not a substring', async () => {
        const author = await seedAuthor()
        const { project } = await seedDiscoverableProject(author.id, { name: 'Sci-fi Book' })
        await addTag(project.id, 'sci-fi', 'genre')

        const caseInsensitive = await inject('/api/discover/projects?genre=SCI-FI')
        expect(JSON.parse(caseInsensitive.payload).total).toBe(1)

        const substring = await inject('/api/discover/projects?genre=sci')
        expect(JSON.parse(substring.payload)).toEqual({ projects: [], total: 0, hasMore: false })
      })
    })

    describe('response enrichment', () => {
      it('reports tags, chapterCount and totalViews for a project', async () => {
        const author = await seedAuthor()
        const project = await seedProject(author.id, { name: 'Enriched Project' })
        const ch1 = await seedChapter(project.id, { title: 'Ch 1' })
        const ch2 = await seedChapter(project.id, { title: 'Ch 2' })
        await publishChapter(ch1, project.id, { viewCount: 5 })
        await publishChapter(ch2, project.id, { viewCount: 7 })
        await addTag(project.id, 'fantasy', 'genre')
        await addTag(project.id, 'slow-burn', 'trope')

        const res = await inject('/api/discover/projects')
        const body = JSON.parse(res.payload)
        expect(body.projects).toHaveLength(1)
        const p = body.projects[0]
        expect(p.chapterCount).toBe(2)
        expect(p.totalViews).toBe(12)
        expect(p.tags.sort()).toEqual(['fantasy', 'slow-burn'])
        expect(p.tagDetails).toEqual(
          expect.arrayContaining([
            { name: 'fantasy', category: 'genre' },
            { name: 'slow-burn', category: 'trope' },
          ])
        )
      })

      // enrichProjects sums ALL chapter_publications rows for the project,
      // not just published ones — a chapter that was unpublished still
      // counts toward chapterCount/totalViews as long as one other chapter
      // keeps the project visible on discover. Documenting actual behavior,
      // not endorsing it.
      it('counts only published chapters toward chapterCount/totalViews', async () => {
        const author = await seedAuthor()
        const project = await seedProject(author.id, { name: 'Partially Published' })
        const published = await seedChapter(project.id, { title: 'Published' })
        await publishChapter(published, project.id, { viewCount: 5 })
        const unpublished = await seedChapter(project.id, { title: 'Unpublished' })
        await publishChapter(unpublished, project.id, { isPublished: false, viewCount: 3 })

        const res = await inject('/api/discover/projects')
        const body = JSON.parse(res.payload)
        expect(body.projects).toHaveLength(1)
        expect(body.projects[0].chapterCount).toBe(1)
        expect(body.projects[0].totalViews).toBe(5)
      })

      it('sets subscriberOnly from projectPublishConfig.defaultVisibility, independent of discoverability', async () => {
        const author = await seedAuthor()
        const { project } = await seedDiscoverableProject(author.id, {
          name: 'Members Only Chapters',
          defaultVisibility: 'subscribers_only',
        })

        const res = await inject('/api/discover/projects')
        const body = JSON.parse(res.payload)
        expect(body.projects[0].id).toBe(project.id)
        expect(body.projects[0].subscriberOnly).toBe(true)
      })

      it('includes collectionId/collectionName only when the collection has 2+ published projects', async () => {
        const author = await seedAuthor()
        const collection = await createCollection(author.id, 'The Saga Series')
        const { project: p1 } = await seedDiscoverableProject(author.id, { name: 'Book One' })
        const { project: p2 } = await seedDiscoverableProject(author.id, { name: 'Book Two' })
        await addToCollection(collection.id, p1.id)
        await addToCollection(collection.id, p2.id)

        const soloCollection = await createCollection(author.id, 'Standalone Group')
        const { project: solo } = await seedDiscoverableProject(author.id, { name: 'Solo Book' })
        await addToCollection(soloCollection.id, solo.id)

        const res = await inject('/api/discover/projects')
        const body = JSON.parse(res.payload)
        const byId = new Map(body.projects.map((p: any) => [p.id, p]))
        expect((byId.get(p1.id) as any).collectionId).toBe(collection.id)
        expect((byId.get(p1.id) as any).collectionName).toBe('The Saga Series')
        expect((byId.get(p2.id) as any).collectionId).toBe(collection.id)
        expect((byId.get(solo.id) as any).collectionId).toBeNull()
        expect((byId.get(solo.id) as any).collectionName).toBeNull()
      })
    })

    it('returns the same public set to an anonymous caller, a signed-in outsider, and the private project’s own owner', async () => {
      const author = await seedAuthor()
      const { project: publicProject } = await seedDiscoverableProject(author.id, { name: 'Public One' })
      const privateProject = await seedProject(author.id, { name: 'Private One', projectVisibility: 'private' })
      const privChapter = await seedChapter(privateProject.id)
      await publishChapter(privChapter, privateProject.id)

      const outsider = await createTestUser()
      const outsiderToken = await createTestToken(outsider.id)
      const ownerToken = await createTestToken(author.id)

      const anon = JSON.parse((await inject('/api/discover/projects')).payload)
      const asOutsider = JSON.parse((await inject('/api/discover/projects', outsiderToken)).payload)
      const asOwner = JSON.parse((await inject('/api/discover/projects', ownerToken)).payload)

      for (const body of [anon, asOutsider, asOwner]) {
        expect(body.projects.map((p: any) => p.id)).toEqual([publicProject.id])
      }
    })
  })

  describe('GET /discover/authors', () => {
    it('lists only authors with at least one public/live project with a published chapter', async () => {
      const published = await seedAuthor({ username: 'published-author' })
      await seedDiscoverableProject(published.id)

      const privateOnly = await seedAuthor({ username: 'private-only-author' })
      const privProject = await seedProject(privateOnly.id, { projectVisibility: 'private' })
      const privChapter = await seedChapter(privProject.id)
      await publishChapter(privChapter, privProject.id)

      const res = await inject('/api/discover/authors')
      const body = JSON.parse(res.payload)
      expect(body.total).toBe(1)
      expect(body.authors).toHaveLength(1)
      expect(body.authors[0].userId).toBe(published.id)
    })

    describe('search', () => {
      it('matches by username, displayName or bio, case-insensitively, and returns empty for no match', async () => {
        const author = await seedAuthor({ username: 'quillwright', displayName: 'Quill Wright', bio: 'Writes about dragons' })
        await seedDiscoverableProject(author.id)

        const byUsername = await inject('/api/discover/authors?q=QUILLWRIGHT')
        expect(JSON.parse(byUsername.payload).total).toBe(1)

        const byDisplayName = await inject('/api/discover/authors?q=Quill')
        expect(JSON.parse(byDisplayName.payload).total).toBe(1)

        const byBio = await inject('/api/discover/authors?q=dragons')
        expect(JSON.parse(byBio.payload).total).toBe(1)

        const noMatch = await inject('/api/discover/authors?q=nonexistentterm')
        const noMatchBody = JSON.parse(noMatch.payload)
        expect(noMatchBody).toEqual({ authors: [], total: 0, hasMore: false })
      })
    })

    describe('sorting', () => {
      it('sorts "alphabetical" by displayName ascending', async () => {
        const a = await seedAuthor({ username: 'user-a', displayName: 'Alice Author' })
        await seedDiscoverableProject(a.id)
        const b = await seedAuthor({ username: 'user-b', displayName: 'Bob Author' })
        await seedDiscoverableProject(b.id)
        const c = await seedAuthor({ username: 'user-c', displayName: 'Carol Author' })
        await seedDiscoverableProject(c.id)

        const res = await inject('/api/discover/authors?sort=alphabetical')
        const body = JSON.parse(res.payload)
        expect(body.authors.map((x: any) => x.userId)).toEqual([a.id, b.id, c.id])
      })

      it('sorts "recent" by profile updatedAt descending', async () => {
        const base = new Date()
        const older = (mins: number) => new Date(base.getTime() - mins * 60_000)

        const a = await seedAuthor({ username: 'recent-a' })
        await seedDiscoverableProject(a.id)
        await db.update(userProfiles).set({ updatedAt: older(0) }).where(eq(userProfiles.userId, a.id))

        const b = await seedAuthor({ username: 'recent-b' })
        await seedDiscoverableProject(b.id)
        await db.update(userProfiles).set({ updatedAt: older(10) }).where(eq(userProfiles.userId, b.id))

        const res = await inject('/api/discover/authors?sort=recent')
        const body = JSON.parse(res.payload)
        expect(body.authors.map((x: any) => x.userId)).toEqual([a.id, b.id])
      })

      it('sorts "popular" by follower count descending', async () => {
        const popular = await seedAuthor({ username: 'popular-author' })
        await seedDiscoverableProject(popular.id)
        const unpopular = await seedAuthor({ username: 'unpopular-author' })
        await seedDiscoverableProject(unpopular.id)

        for (let i = 0; i < 3; i++) {
          await addFollower((await createTestUser()).id, popular.id)
        }
        await addFollower((await createTestUser()).id, unpopular.id)

        const res = await inject('/api/discover/authors?sort=popular')
        const body = JSON.parse(res.payload)
        expect(body.authors.map((x: any) => x.userId)).toEqual([popular.id, unpopular.id])
        expect(body.authors[0].followerCount).toBe(3)
        expect(body.authors[1].followerCount).toBe(1)
      })
    })

    it('reports followerCount and publishedProjectCount matching the seeded numbers', async () => {
      const author = await seedAuthor()
      await seedDiscoverableProject(author.id, { name: 'Project A' })
      await seedDiscoverableProject(author.id, { name: 'Project B' })
      // A private project should not count toward publishedProjectCount.
      const priv = await seedProject(author.id, { projectVisibility: 'private' })
      const privChapter = await seedChapter(priv.id)
      await publishChapter(privChapter, priv.id)

      await addFollower((await createTestUser()).id, author.id)
      await addFollower((await createTestUser()).id, author.id)

      const res = await inject('/api/discover/authors')
      const body = JSON.parse(res.payload)
      expect(body.authors[0].followerCount).toBe(2)
      expect(body.authors[0].publishedProjectCount).toBe(2)
    })

    it('includes only active, non-expired badges', async () => {
      const author = await seedAuthor()
      await seedDiscoverableProject(author.id)

      await addBadge(author.id, 'contributor')
      await addBadge(author.id, 'beta_tester', { isActive: false })
      await addBadge(author.id, 'moderator', { expiresAt: new Date(Date.now() - 60_000) })
      await addBadge(author.id, 'supporter', { expiresAt: new Date(Date.now() + 60_000) })

      const res = await inject('/api/discover/authors')
      const body = JSON.parse(res.payload)
      expect(body.authors[0].badges.sort()).toEqual(['contributor', 'supporter'])
    })

    it('paginates with default limit/offset and respects limit/offset/hasMore', async () => {
      const authors = []
      for (let i = 0; i < 3; i++) {
        const author = await seedAuthor({ username: `page-author-${i}`, displayName: `Author ${i}` })
        await seedDiscoverableProject(author.id)
        authors.push(author)
      }

      const page1 = await inject('/api/discover/authors?sort=alphabetical&limit=2&offset=0')
      const page1Body = JSON.parse(page1.payload)
      expect(page1Body.authors).toHaveLength(2)
      expect(page1Body.hasMore).toBe(true)
      expect(page1Body.total).toBe(3)

      const page2 = await inject('/api/discover/authors?sort=alphabetical&limit=2&offset=2')
      const page2Body = JSON.parse(page2.payload)
      expect(page2Body.authors).toHaveLength(1)
      expect(page2Body.hasMore).toBe(false)
    })

    it('returns the same public author set to anonymous and signed-in callers', async () => {
      const author = await seedAuthor()
      await seedDiscoverableProject(author.id)
      const outsider = await createTestUser()
      const token = await createTestToken(outsider.id)

      const anon = JSON.parse((await inject('/api/discover/authors')).payload)
      const asOutsider = JSON.parse((await inject('/api/discover/authors', token)).payload)
      expect(anon.authors.map((a: any) => a.userId)).toEqual(asOutsider.authors.map((a: any) => a.userId))
      expect(anon.authors.map((a: any) => a.userId)).toEqual([author.id])
    })
  })

  describe('GET /discover/tags', () => {
    it('only counts tags belonging to public/live projects with a published chapter', async () => {
      const author = await seedAuthor()
      const { project: pub } = await seedDiscoverableProject(author.id)
      await addTag(pub.id, 'fantasy', 'genre')

      const privateProject = await seedProject(author.id, { projectVisibility: 'private' })
      const privChapter = await seedChapter(privateProject.id)
      await publishChapter(privChapter, privateProject.id)
      await addTag(privateProject.id, 'hidden-tag', 'genre')

      const res = await inject('/api/discover/tags')
      const body = JSON.parse(res.payload)
      const names = body.tags.map((t: any) => t.name)
      expect(names).toContain('fantasy')
      expect(names).not.toContain('hidden-tag')
    })

    it('filters by category and reports projectCount as the distinct number of matching projects', async () => {
      const author = await seedAuthor()
      const { project: p1 } = await seedDiscoverableProject(author.id, { name: 'Tagged One' })
      const { project: p2 } = await seedDiscoverableProject(author.id, { name: 'Tagged Two' })
      await addTag(p1.id, 'fantasy', 'genre')
      await addTag(p2.id, 'fantasy', 'genre')
      await addTag(p1.id, 'fantasy', 'theme') // same name, different category

      const genreOnly = await inject('/api/discover/tags?category=genre')
      const genreBody = JSON.parse(genreOnly.payload)
      const fantasyGenre = genreBody.tags.find((t: any) => t.name === 'fantasy' && t.category === 'genre')
      expect(fantasyGenre).toBeDefined()
      expect(fantasyGenre.projectCount).toBe(2)
      expect(genreBody.tags.every((t: any) => t.category === 'genre')).toBe(true)

      const themeOnly = await inject('/api/discover/tags?category=theme')
      const themeBody = JSON.parse(themeOnly.payload)
      const fantasyTheme = themeBody.tags.find((t: any) => t.name === 'fantasy' && t.category === 'theme')
      expect(fantasyTheme).toBeDefined()
      expect(fantasyTheme.projectCount).toBe(1)
    })

    it('clamps a negative limit up to 1 and orders by projectCount descending', async () => {
      const author = await seedAuthor()
      const { project: p1 } = await seedDiscoverableProject(author.id, { name: 'Popular Tag Project' })
      const { project: p2 } = await seedDiscoverableProject(author.id, { name: 'Second Popular Tag Project' })
      const { project: p3 } = await seedDiscoverableProject(author.id, { name: 'Rare Tag Project' })
      await addTag(p1.id, 'common', 'genre')
      await addTag(p2.id, 'common', 'genre')
      await addTag(p3.id, 'rare', 'genre')

      // limit=0 is falsy so it falls through to the default (30), not the
      // clamp floor — use a negative value to exercise Math.max(..., 1).
      const res = await inject('/api/discover/tags?limit=-5')
      const body = JSON.parse(res.payload)
      expect(body.tags).toHaveLength(1)
      expect(body.tags[0].name).toBe('common')
      expect(body.tags[0].projectCount).toBe(2)
    })

    it('is reachable anonymously with no token', async () => {
      const author = await seedAuthor()
      const { project } = await seedDiscoverableProject(author.id)
      await addTag(project.id, 'no-auth-needed', 'genre')

      const res = await inject('/api/discover/tags')
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).tags.map((t: any) => t.name)).toContain('no-auth-needed')
    })
  })
})
