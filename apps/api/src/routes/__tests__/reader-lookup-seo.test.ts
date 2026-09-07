import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { entities, chapterPublications, projects, projectPublishConfig, userProfiles } from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'

let usernameCounter = 0
let shortUrlCounter = 0

/** Author with a claimed username (reader routes resolve authors by username). */
async function seedAuthor(overrides: { username?: string } = {}) {
  usernameCounter++
  const user = await createTestUser()
  await db.insert(userProfiles).values({
    userId: user.id,
    username: overrides.username ?? `author-${usernameCounter}-${Date.now()}`,
    displayName: 'Test Author',
  })
  return user
}

/** Project with a claimed shortUrl + a publish config row (defaults to public/live). */
async function seedProject(
  ownerId: string,
  overrides: { name?: string; shortUrl?: string; projectVisibility?: string; publishingMode?: string; defaultVisibility?: string } = {}
) {
  shortUrlCounter++
  const project = await createTestProject(ownerId, { name: overrides.name ?? 'Test Project' })
  const shortUrl = overrides.shortUrl ?? `project-${shortUrlCounter}-${Date.now()}`
  await db.update(projects).set({ shortUrl }).where(eq(projects.id, project.id))
  await db.insert(projectPublishConfig).values({
    projectId: project.id,
    publishingMode: overrides.publishingMode ?? 'live',
    projectVisibility: overrides.projectVisibility ?? 'public',
    defaultVisibility: overrides.defaultVisibility ?? 'public',
  })
  return { ...project, shortUrl }
}

/** A `content`-collection chapter entity, unpublished by default. */
async function seedChapter(projectId: string, overrides: { title?: string; body?: string } = {}) {
  const [chapter] = await db.insert(entities).values({
    projectId,
    bobbinId: 'manuscript',
    collectionName: 'content',
    contentType: 'chapter',
    entityData: {
      title: overrides.title ?? 'Chapter 1',
      body: overrides.body ?? '<p>Some prose here.</p>',
      word_count: 4,
    },
  }).returning()
  return chapter!
}

/** Marks a chapter published via a `chapter_publications` row. */
async function publishChapter(
  chapter: { id: string },
  projectId: string,
  overrides: { publishedAt?: Date; publicReleaseDate?: Date | null; isPublished?: boolean } = {}
) {
  const now = overrides.publishedAt ?? new Date()
  const [row] = await db.insert(chapterPublications).values({
    projectId,
    chapterId: chapter.id,
    publishStatus: 'published',
    isPublished: overrides.isPublished ?? true,
    publishedAt: now,
    publicReleaseDate: overrides.publicReleaseDate === undefined ? now : overrides.publicReleaseDate,
    firstPublishedAt: now,
    lastPublishedAt: now,
  }).returning()
  return row!
}

describe('Public Reader — lookup & SEO routes', () => {
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

  describe('GET /public/projects/by-author-and-slug/:username/:projectSlug', () => {
    it('resolves a public project by username + slug', async () => {
      const author = await seedAuthor({ username: 'novelist-one' })
      const project = await seedProject(author.id, { name: 'The Long Road', shortUrl: 'long-road' })

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/by-author-and-slug/novelist-one/${project.shortUrl}`,
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.project.id).toBe(project.id)
      expect(body.project.name).toBe('The Long Road')
      expect(body.project.shortUrl).toBe('long-road')
      expect(body.project.ownerId).toBe(author.id)
      expect(body.project.projectVisibility).toBe('public')
      expect(body.project.defaultVisibility).toBe('public')
      expect(body.author.userId).toBe(author.id)
      expect(body.author.username).toBe('novelist-one')
      expect(body.collection).toBeNull()
    })

    // A UUID-shaped identifier that matches no user_profiles row exercises the
    // resolveAuthor() 404 path cleanly. (A plain non-UUID string like
    // "no-such-author" instead 500s — see resolveAuthor's step 2 in shared.ts,
    // reported separately.)
    it('404s for an unknown author, whether the identifier looks like a username or a uuid', async () => {
      // A plain unknown username used to reach the uuid lookups and crash with
      // "invalid input syntax for type uuid" (a 500 on anonymous traffic).
      for (const identifier of ['no-such-author', crypto.randomUUID()]) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/public/projects/by-author-and-slug/${identifier}/some-slug`,
        })
        expect(res.statusCode).toBe(404)
        expect(JSON.parse(res.payload).error).toBe('Author not found')
      }
    })

    it('404s for a known author with an unknown project slug', async () => {
      const author = await seedAuthor({ username: 'novelist-two' })

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/by-author-and-slug/novelist-two/does-not-exist`,
      })

      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload).error).toBe('Project not found')
    })
  })

  describe('project visibility gating', () => {
    it('hides a private project from anonymous callers', async () => {
      const author = await seedAuthor({ username: 'private-author' })
      const project = await seedProject(author.id, { shortUrl: 'secret-project', projectVisibility: 'private' })

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/by-author-and-slug/private-author/${project.shortUrl}`,
      })

      expect(res.statusCode).toBe(404)
    })

    it('hides a private project from a signed-in non-owner', async () => {
      const author = await seedAuthor({ username: 'private-author-2' })
      const project = await seedProject(author.id, { shortUrl: 'secret-project-2', projectVisibility: 'private' })
      const outsider = await createTestUser()
      const token = await createTestToken(outsider.id)

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/by-author-and-slug/private-author-2/${project.shortUrl}`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(404)
    })

    it('shows a private project to its owner', async () => {
      const author = await seedAuthor({ username: 'private-author-3' })
      const project = await seedProject(author.id, { shortUrl: 'secret-project-3', projectVisibility: 'private' })
      const token = await createTestToken(author.id)

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/by-author-and-slug/private-author-3/${project.shortUrl}`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).project.id).toBe(project.id)
    })

    it('lets anonymous callers reach an unlisted project by its URL', async () => {
      const author = await seedAuthor({ username: 'unlisted-author' })
      const project = await seedProject(author.id, { shortUrl: 'hidden-gem', projectVisibility: 'unlisted' })

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/by-author-and-slug/unlisted-author/${project.shortUrl}`,
      })

      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).project.id).toBe(project.id)
    })
  })

  describe('GET /public/projects/:projectId/feed.xml', () => {
    it('serves a well-formed RSS feed with one item per published chapter', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id, { shortUrl: 'feed-project' })
      const published = await seedChapter(project.id, { title: 'Chapter One', body: '<p>Some prose here.</p>' })
      await publishChapter(published, project.id)
      const draft = await seedChapter(project.id, { title: 'Unpublished Chapter', body: '<p>Secret draft text.</p>' })
      // draft has no chapter_publications row at all — never submitted for publishing

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/feed.xml`,
      })

      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('application/rss+xml')

      const body = res.payload
      const itemCount = (body.match(/<item>/g) || []).length
      expect(itemCount).toBe(1)
      expect(body).toContain('Chapter One')
      expect(body).not.toContain('Unpublished Chapter')
      expect(body).not.toContain('Secret draft text')
      expect(draft.id).toBeDefined()
    })

    it('excludes a chapter marked isPublished: false', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id, { shortUrl: 'feed-project-unpub' })
      const chapter = await seedChapter(project.id, { title: 'Not Really Published' })
      await publishChapter(chapter, project.id, { isPublished: false })

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/feed.xml`,
      })

      expect(res.statusCode).toBe(200)
      expect(res.payload).not.toContain('Not Really Published')
      expect((res.payload.match(/<item>/g) || []).length).toBe(0)
    })

    it('renders the description as a plain-text excerpt with no <p> tag', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id, { shortUrl: 'feed-project-plain' })
      const chapter = await seedChapter(project.id, {
        title: 'Prose Chapter',
        body: '<p>The reactor hummed, and then it did not.</p>',
      })
      await publishChapter(chapter, project.id)

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/feed.xml`,
      })

      // Scope to the <item> block — the channel itself also has a <description>
      // (the project description), which isn't what we're checking here.
      const itemMatch = res.payload.match(/<item>([\s\S]*?)<\/item>/)
      expect(itemMatch).not.toBeNull()
      const descMatch = itemMatch![1]!.match(/<description>([\s\S]*?)<\/description>/)
      expect(descMatch).not.toBeNull()
      const description = descMatch![1]!
      expect(description).toContain('The reactor hummed, and then it did not.')
      expect(description).not.toContain('<p>')
      expect(description).not.toContain('</p>')
    })

    it('XML-escapes chapter titles containing & and <', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id, { shortUrl: 'feed-project-escape' })
      const chapter = await seedChapter(project.id, {
        title: 'Bugs & <Features>',
        body: '<p>Body text.</p>',
      })
      await publishChapter(chapter, project.id)

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/feed.xml`,
      })

      const itemMatch = res.payload.match(/<item>([\s\S]*?)<\/item>/)
      expect(itemMatch).not.toBeNull()
      const item = itemMatch![1]!
      const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/)
      expect(titleMatch).not.toBeNull()
      const titleText = titleMatch![1]!

      expect(titleText).toBe('Bugs &amp; &lt;Features&gt;')
      expect(titleText).not.toContain('&<')
      // The raw ampersand only ever appears as part of an entity reference.
      expect(titleText.replace(/&(amp|lt|gt|quot|apos);/g, '')).not.toContain('&')
      expect(titleText).not.toContain('<Features>')
    })

    it('404s for a private project', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id, { shortUrl: 'feed-private', projectVisibility: 'private' })

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/feed.xml`,
      })

      expect(res.statusCode).toBe(404)
    })
  })

  describe('GET /public/projects/:projectId/sitemap.xml', () => {
    it('lists only published chapters, in reader order', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id, { shortUrl: 'sitemap-project' })
      const published = await seedChapter(project.id, { title: 'Published Chapter' })
      await publishChapter(published, project.id)
      await seedChapter(project.id, { title: 'Draft Chapter' })

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/sitemap.xml`,
      })

      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('application/xml')
      const urlCount = (res.payload.match(/<url>/g) || []).length
      // one <url> for the project root + one for the single published chapter
      expect(urlCount).toBe(2)
      expect(res.payload).toContain(published.id)
    })

    it('404s for a private project', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id, { shortUrl: 'sitemap-private', projectVisibility: 'private' })

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/sitemap.xml`,
      })

      expect(res.statusCode).toBe(404)
    })
  })

  describe('GET /public/projects/:projectId/chapters/:chapterId/metadata', () => {
    it('returns title combining chapter and project titles, and a plain-text description', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id, { name: 'The Saga', shortUrl: 'meta-project' })
      const chapter = await seedChapter(project.id, {
        title: 'The Beginning',
        body: '<p>Once upon a time, in a <em>faraway</em> land.</p>',
      })
      await publishChapter(chapter, project.id)

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/chapters/${chapter.id}/metadata`,
      })

      expect(res.statusCode).toBe(200)
      const { metadata } = JSON.parse(res.payload)
      expect(metadata.title).toBe('The Beginning - The Saga')
      expect(metadata.description).not.toContain('<')
      expect(metadata.description).toContain('Once upon a time, in a faraway land.')
      expect(metadata.openGraph.type).toBe('article')
      expect(metadata.openGraph.title).toBe('The Beginning')
      expect(metadata.twitter.description).not.toContain('<')
    })

    it('404s for an unpublished chapter', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id, { shortUrl: 'meta-project-draft' })
      const chapter = await seedChapter(project.id, { title: 'Still Drafting' })
      // no chapter_publications row — never published

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/chapters/${chapter.id}/metadata`,
      })

      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload).error).toBe('Chapter not found')
    })

    it('404s for a chapter published but then explicitly unpublished (isPublished: false)', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id, { shortUrl: 'meta-project-unpub' })
      const chapter = await seedChapter(project.id, { title: 'Retracted' })
      await publishChapter(chapter, project.id, { isPublished: false })

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/chapters/${chapter.id}/metadata`,
      })

      expect(res.statusCode).toBe(404)
    })

    it('404s for a chapter in a private project', async () => {
      const author = await seedAuthor()
      const project = await seedProject(author.id, { shortUrl: 'meta-project-private', projectVisibility: 'private' })
      const chapter = await seedChapter(project.id, { title: 'Hidden' })
      await publishChapter(chapter, project.id)

      const res = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/chapters/${chapter.id}/metadata`,
      })

      expect(res.statusCode).toBe(404)
    })
  })
})
