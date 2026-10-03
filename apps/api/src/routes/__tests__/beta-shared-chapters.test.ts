import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { eq, and } from 'drizzle-orm'
import { db } from '../../db/connection'
import { users, entities, chapterPublications, projectPublishConfig, subscriptionTiers, betaReaders, betaReaderInvites } from '../../db/schema'
import { createTestApp, createTestToken, createTestUser, createTestProject, cleanupAllTestData } from '../../__tests__/test-helpers'

/**
 * Per-chapter "Share with beta readers" (chapter_publications.beta_shared).
 * An unpublished chapter the author shared is readable by exactly the beta
 * audience (owner, active beta readers, owner viewing as beta) and invisible
 * to everyone else — TOC, totals, fetch, sitemap and SEO metadata included.
 */
describe('beta-shared chapters', () => {
  let app: any
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  afterEach(async () => { await cleanupAllTestData() })

  async function verifiedUser() {
    const user = await createTestUser()
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
    return { user, token: await createTestToken(user.id) }
  }

  async function seedChapter(
    projectId: string,
    title: string,
    pub?: { betaShared?: boolean; published?: boolean; status?: string },
    extra: { order?: number; contentType?: string } = {},
  ) {
    const [chapter] = await db.insert(entities).values({
      projectId,
      bobbinId: 'manuscript',
      collectionName: 'content',
      contentType: extra.contentType ?? 'chapter',
      entityData: { title, body: `<p>${title} body</p>`, word_count: 100, ...(extra.order !== undefined ? { order: extra.order } : {}) },
    }).returning()
    if (pub) {
      const now = new Date()
      await db.insert(chapterPublications).values({
        projectId,
        chapterId: chapter!.id,
        publishStatus: pub.published ? 'published' : (pub.status ?? 'draft'),
        isPublished: !!pub.published || pub.status === 'scheduled',
        betaShared: pub.betaShared ?? false,
        publishedAt: pub.published || pub.status === 'scheduled' ? now : null,
        publicReleaseDate: pub.published || pub.status === 'scheduled' ? now : null,
      })
    }
    return chapter!
  }

  async function addBetaReader(authorId: string, readerId: string, projectId: string | null, isActive = true) {
    await db.insert(betaReaders).values({ authorId, readerId, projectId, isActive })
  }

  const auth = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {})

  function toc(projectId: string, token?: string, query = '') {
    return app.inject({ method: 'GET', url: `/api/public/projects/${projectId}/toc${query}`, headers: auth(token) })
  }

  function fetchChapter(projectId: string, chapterParam: string, token?: string) {
    return app.inject({ method: 'GET', url: `/api/public/projects/${projectId}/chapters/${chapterParam}`, headers: auth(token) })
  }

  function betaShare(projectId: string, chapterId: string, token: string | undefined, body: unknown) {
    return app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/chapters/${chapterId}/beta-share`,
      headers: auth(token),
      payload: body as any,
    })
  }

  /** Response minus the per-request correlation id, for byte-for-byte comparisons. */
  function stable(res: { statusCode: number; payload: string }) {
    const { correlationId: _c, ...body } = JSON.parse(res.payload)
    return { status: res.statusCode, body }
  }

  /** Author + project with one published chapter and one draft shared with beta readers. */
  async function seedScenario() {
    const author = await createTestUser()
    const project = await createTestProject(author.id)
    const published = await seedChapter(project.id, 'Published One', { published: true })
    const shared = await seedChapter(project.id, 'Beta Only', { betaShared: true })
    return { author, project, published, shared }
  }

  describe('beta audience', () => {
    it('shows a project-specific beta reader the chapter in the TOC and serves its body', async () => {
      const { author, project, published, shared } = await seedScenario()
      const reader = await createTestUser()
      await addBetaReader(author.id, reader.id, project.id)
      const token = await createTestToken(reader.id)

      const res = await toc(project.id, token)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.totalChapters).toBe(2)
      expect(body.totalWords).toBe(200)
      expect(body.toc.map((c: any) => c.id)).toEqual([published.id, shared.id])
      const betaRow = body.toc.find((c: any) => c.id === shared.id)
      expect(betaRow.betaOnly).toBe(true)
      expect(betaRow.locked).toBeUndefined()
      // Published rows carry no betaOnly marker at all.
      expect('betaOnly' in body.toc.find((c: any) => c.id === published.id)).toBe(false)

      const chapterRes = await fetchChapter(project.id, shared.id, token)
      expect(chapterRes.statusCode).toBe(200)
      const chapterBody = JSON.parse(chapterRes.payload)
      expect(chapterBody.chapter.content).toContain('Beta Only body')
      // Prev/next navigation includes the beta chapter for this audience.
      expect(chapterBody.navigation.previous.id).toBe(published.id)
    })

    it('treats an author-wide beta reader (NULL project) the same way', async () => {
      const { author, project, shared } = await seedScenario()
      const reader = await createTestUser()
      await addBetaReader(author.id, reader.id, null)
      const token = await createTestToken(reader.id)

      const body = JSON.parse((await toc(project.id, token)).payload)
      expect(body.toc.find((c: any) => c.id === shared.id)?.betaOnly).toBe(true)
      expect((await fetchChapter(project.id, shared.id, token)).statusCode).toBe(200)
    })

    it('shows the owner the chapter, and the owner viewing as beta reader too', async () => {
      const { author, project, shared } = await seedScenario()
      const token = await createTestToken(author.id)

      const body = JSON.parse((await toc(project.id, token)).payload)
      expect(body.toc.find((c: any) => c.id === shared.id)?.betaOnly).toBe(true)
      expect((await fetchChapter(project.id, shared.id, token)).statusCode).toBe(200)

      const asBeta = JSON.parse((await toc(project.id, token, '?viewAs=beta')).payload)
      expect(asBeta.toc.find((c: any) => c.id === shared.id)?.betaOnly).toBe(true)
    })

    it('hides the chapter from the owner viewing as a visitor or a subscriber tier', async () => {
      const { author, project, shared } = await seedScenario()
      const token = await createTestToken(author.id)
      const [tier] = await db.insert(subscriptionTiers).values({
        authorId: author.id, name: 'Patron', tierLevel: 1, earlyAccessDays: 7,
      }).returning()

      for (const viewAs of ['visitor', `tier:${tier!.id}`]) {
        const res = await toc(project.id, token, `?viewAs=${viewAs}`)
        expect(res.statusCode).toBe(200)
        const body = JSON.parse(res.payload)
        expect(body.toc.some((c: any) => c.id === shared.id)).toBe(false)
        expect(body.totalChapters).toBe(1)
      }
    })

    it('serves the chapter by slug as well as by id', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const shared = await seedChapter(project.id, 'Slugged Beta Chapter')
      expect((await betaShare(project.id, shared.id, token, { shared: true })).statusCode).toBe(200)

      const body = JSON.parse((await toc(project.id, token)).payload)
      const slug = body.toc.find((c: any) => c.id === shared.id)?.slug
      expect(typeof slug).toBe('string')
      expect((await fetchChapter(project.id, slug, token)).statusCode).toBe(200)
    })

    it('does not show an unshared draft to a beta reader', async () => {
      const { author, project } = await seedScenario()
      const hidden = await seedChapter(project.id, 'Private Draft', { betaShared: false })
      const reader = await createTestUser()
      await addBetaReader(author.id, reader.id, project.id)
      const token = await createTestToken(reader.id)

      const body = JSON.parse((await toc(project.id, token)).payload)
      expect(body.toc.some((c: any) => c.id === hidden.id)).toBe(false)
      expect((await fetchChapter(project.id, hidden.id, token)).statusCode).toBe(403)
    })

    it('treats an inactive beta reader as an outsider', async () => {
      const { author, project, shared } = await seedScenario()
      const reader = await createTestUser()
      await addBetaReader(author.id, reader.id, project.id, false)
      const token = await createTestToken(reader.id)

      const body = JSON.parse((await toc(project.id, token)).payload)
      expect(body.toc.some((c: any) => c.id === shared.id)).toBe(false)
      expect(body.totalChapters).toBe(1)
      expect((await fetchChapter(project.id, shared.id, token)).statusCode).toBe(403)
    })

    it('does not let a beta reader of another author in', async () => {
      const { project, shared } = await seedScenario()
      const otherAuthor = await createTestUser()
      const reader = await createTestUser()
      await addBetaReader(otherAuthor.id, reader.id, null)
      const token = await createTestToken(reader.id)

      const body = JSON.parse((await toc(project.id, token)).payload)
      expect(body.toc.some((c: any) => c.id === shared.id)).toBe(false)
    })
  })

  describe('everyone else sees no trace', () => {
    it('leaves the TOC byte-identical for anonymous and ordinary logged-in users', async () => {
      const { project, shared } = await seedScenario()
      const outsider = await createTestUser()
      const outsiderToken = await createTestToken(outsider.id)

      // Baseline: the same chapter, not shared.
      await db.update(chapterPublications).set({ betaShared: false }).where(eq(chapterPublications.chapterId, shared.id))
      const baselineAnon = stable(await toc(project.id))
      const baselineUser = stable(await toc(project.id, outsiderToken))

      await db.update(chapterPublications).set({ betaShared: true }).where(eq(chapterPublications.chapterId, shared.id))
      const anon = stable(await toc(project.id))
      const user = stable(await toc(project.id, outsiderToken))

      expect(anon).toEqual(baselineAnon)
      expect(user).toEqual(baselineUser)
      expect(anon.body.totalChapters).toBe(1)
      expect(anon.body.totalWords).toBe(100)
    })

    it('rejects the chapter fetch exactly like any other unpublished chapter', async () => {
      const { project, shared } = await seedScenario()
      const plainDraft = await seedChapter(project.id, 'Plain Draft', { betaShared: false })
      const outsider = await createTestUser()
      const outsiderToken = await createTestToken(outsider.id)

      for (const token of [undefined, outsiderToken]) {
        const sharedRes = await fetchChapter(project.id, shared.id, token)
        const plainRes = await fetchChapter(project.id, plainDraft.id, token)
        expect(sharedRes.statusCode).toBe(403)
        expect(stable(sharedRes)).toEqual(stable(plainRes))
      }
    })

    it('does not serve comments or view tracking on the chapter to outsiders, but does for beta readers', async () => {
      const { author, project, shared } = await seedScenario()
      const outsider = await createTestUser()
      const reader = await createTestUser()
      await addBetaReader(author.id, reader.id, project.id)

      const view = (token?: string) => app.inject({
        method: 'POST',
        url: `/api/public/projects/${project.id}/chapters/${shared.id}/view`,
        headers: auth(token),
        payload: { sessionId: 'sess-1' },
      })
      expect((await view()).statusCode).toBe(404)
      expect((await view(await createTestToken(outsider.id))).statusCode).toBe(404)
      expect((await view(await createTestToken(reader.id))).statusCode).toBe(201)
    })

    it('keeps the chapter out of the sitemap and SEO metadata, even for a beta reader', async () => {
      const { author, project, published, shared } = await seedScenario()
      const reader = await createTestUser()
      await addBetaReader(author.id, reader.id, project.id)

      const sitemap = await app.inject({ method: 'GET', url: `/api/public/projects/${project.id}/sitemap.xml` })
      expect(sitemap.statusCode).toBe(200)
      expect(sitemap.payload).toContain(published.id)
      expect(sitemap.payload).not.toContain(shared.id)

      for (const token of [undefined, await createTestToken(reader.id), await createTestToken(author.id)]) {
        const meta = await app.inject({
          method: 'GET',
          url: `/api/public/projects/${project.id}/chapters/${shared.id}/metadata`,
          headers: auth(token),
        })
        expect(meta.statusCode).toBe(404)
      }
    })

    it('excludes the chapter from the public stats count', async () => {
      const { project } = await seedScenario()
      const res = await app.inject({ method: 'GET', url: `/api/public/projects/${project.id}/stats` })
      expect(Number(JSON.parse(res.payload).stats.totalChapters)).toBe(1)
    })
  })

  describe('private project with a published chapter', () => {
    it('admits a beta reader to the TOC and chapter, 404s an outsider', async () => {
      const author = await createTestUser()
      const project = await createTestProject(author.id)
      await db.insert(projectPublishConfig).values({ projectId: project.id, projectVisibility: 'private' })
      const chapter = await seedChapter(project.id, 'Live Chapter', { published: true })
      const reader = await createTestUser()
      await addBetaReader(author.id, reader.id, project.id)
      const outsider = await createTestUser()

      const readerToken = await createTestToken(reader.id)
      const tocRes = await toc(project.id, readerToken)
      expect(tocRes.statusCode).toBe(200)
      expect(JSON.parse(tocRes.payload).toc.map((c: any) => c.id)).toEqual([chapter.id])
      expect((await fetchChapter(project.id, chapter.id, readerToken)).statusCode).toBe(200)

      const outsiderToken = await createTestToken(outsider.id)
      expect((await toc(project.id, outsiderToken)).statusCode).toBe(404)
      expect((await fetchChapter(project.id, chapter.id, outsiderToken)).statusCode).toBe(404)
      expect((await toc(project.id)).statusCode).toBe(404)
    })
  })

  describe('author-wide beta readers stay inside their own author', () => {
    async function seedPublished(ownerId: string, config: Record<string, unknown>, pub: { publicReleaseDate?: Date } = {}) {
      const project = await createTestProject(ownerId)
      await db.insert(projectPublishConfig).values({ projectId: project.id, ...config })
      const chapter = await seedChapter(project.id, 'Live Chapter', { published: true })
      if (pub.publicReleaseDate) {
        await db.update(chapterPublications).set({ publicReleaseDate: pub.publicReleaseDate })
          .where(eq(chapterPublications.chapterId, chapter.id))
      }
      return { project, chapter }
    }

    it("does not open another author's private project", async () => {
      const authorA = await createTestUser()
      const authorB = await createTestUser()
      const { project, chapter } = await seedPublished(authorB.id, { projectVisibility: 'private' })
      const reader = await createTestUser()
      await addBetaReader(authorA.id, reader.id, null)
      const token = await createTestToken(reader.id)

      expect((await toc(project.id, token)).statusCode).toBe(404)
      expect((await fetchChapter(project.id, chapter.id, token)).statusCode).toBe(404)
    })

    it("does not bypass another author's subscribers-only or embargo gates", async () => {
      const authorA = await createTestUser()
      const authorB = await createTestUser()
      const reader = await createTestUser()
      await addBetaReader(authorA.id, reader.id, null)
      const token = await createTestToken(reader.id)

      const subsOnly = await seedPublished(authorB.id, { defaultVisibility: 'subscribers_only' })
      const embargoed = await seedPublished(authorB.id, {}, { publicReleaseDate: new Date(Date.now() + 7 * 86_400_000) })

      for (const { project, chapter } of [subsOnly, embargoed]) {
        const body = JSON.parse((await toc(project.id, token)).payload)
        expect(body.toc.find((c: any) => c.id === chapter.id)?.locked).toBe(true)
        expect((await fetchChapter(project.id, chapter.id, token)).statusCode).toBe(403)
      }
    })

    it("still gives full access on the same author's projects", async () => {
      const authorA = await createTestUser()
      const reader = await createTestUser()
      await addBetaReader(authorA.id, reader.id, null)
      const token = await createTestToken(reader.id)

      const subsOnly = await seedPublished(authorA.id, { defaultVisibility: 'subscribers_only' })
      const embargoed = await seedPublished(authorA.id, {}, { publicReleaseDate: new Date(Date.now() + 7 * 86_400_000) })
      const priv = await seedPublished(authorA.id, { projectVisibility: 'private' })

      for (const { project, chapter } of [subsOnly, embargoed, priv]) {
        const body = JSON.parse((await toc(project.id, token)).payload)
        expect(body.toc.find((c: any) => c.id === chapter.id)?.locked).toBeUndefined()
        expect((await fetchChapter(project.id, chapter.id, token)).statusCode).toBe(200)
      }
    })

    it('keeps a project-specific row working for that project only', async () => {
      const author = await createTestUser()
      const reader = await createTestUser()
      const token = await createTestToken(reader.id)
      const mine = await seedPublished(author.id, {}, { publicReleaseDate: new Date(Date.now() + 7 * 86_400_000) })
      const other = await seedPublished(author.id, {}, { publicReleaseDate: new Date(Date.now() + 7 * 86_400_000) })
      await addBetaReader(author.id, reader.id, mine.project.id)

      expect((await fetchChapter(mine.project.id, mine.chapter.id, token)).statusCode).toBe(200)
      expect((await fetchChapter(other.project.id, other.chapter.id, token)).statusCode).toBe(403)
    })
  })

  describe('publishing ends beta sharing', () => {
    it('does not re-expose a chapter to beta readers after share -> publish -> unpublish', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await seedChapter(project.id, 'Round Trip')
      const reader = await createTestUser()
      await addBetaReader(user.id, reader.id, project.id)
      const readerToken = await createTestToken(reader.id)

      await betaShare(project.id, chapter.id, token, { shared: true })
      expect((await fetchChapter(project.id, chapter.id, readerToken)).statusCode).toBe(200)

      const post = (action: string, payload?: object) => app.inject({
        method: 'POST', url: `/api/projects/${project.id}/chapters/${chapter.id}/${action}`,
        headers: auth(token), ...(payload ? { payload } : {}),
      })
      expect((await post('publish', { publishStatus: 'published' })).statusCode).toBeLessThan(300)
      expect((await post('unpublish')).statusCode).toBe(200)

      const [row] = await db.select().from(chapterPublications).where(eq(chapterPublications.chapterId, chapter.id))
      expect(row).toMatchObject({ betaShared: false, isPublished: false })
      const body = JSON.parse((await toc(project.id, readerToken)).payload)
      expect(body.toc.some((c: any) => c.id === chapter.id)).toBe(false)
      expect((await fetchChapter(project.id, chapter.id, readerToken)).statusCode).toBe(403)
    })

    it('clears the flag when a chapter is scheduled too', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await seedChapter(project.id, 'Scheduled Later')
      await betaShare(project.id, chapter.id, token, { shared: true })

      const res = await app.inject({
        method: 'POST', url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: auth(token),
        payload: { publishStatus: 'scheduled', scheduledFor: new Date(Date.now() + 86_400_000).toISOString() },
      })
      expect(res.statusCode).toBeLessThan(300)
      const [row] = await db.select().from(chapterPublications).where(eq(chapterPublications.chapterId, chapter.id))
      expect(row).toMatchObject({ betaShared: false, publishStatus: 'scheduled' })
    })
  })

  describe('PUT /projects/:projectId/chapters/beta-share (bulk)', () => {
    function bulkShare(projectId: string, token: string | undefined, body: unknown) {
      return app.inject({
        method: 'PUT', url: `/api/projects/${projectId}/chapters/beta-share`,
        headers: auth(token), payload: body as any,
      })
    }

    const sharedState = async (chapterId: string) => {
      const [row] = await db.select().from(chapterPublications).where(eq(chapterPublications.chapterId, chapterId))
      return row ? row.betaShared : null
    }

    /** One of each state: no row, draft, complete, scheduled, published. */
    async function seedMix(projectId: string) {
      return {
        noRow: await seedChapter(projectId, 'No Row', undefined, { order: 1 }),
        draft: await seedChapter(projectId, 'Draft', {}, { order: 2 }),
        complete: await seedChapter(projectId, 'Complete', { status: 'complete' }, { order: 3 }),
        scheduled: await seedChapter(projectId, 'Scheduled', { status: 'scheduled' }, { order: 4 }),
        published: await seedChapter(projectId, 'Published', { published: true }, { order: 5 }),
      }
    }

    it('shares every unreleased chapter and skips scheduled and published ones', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const c = await seedMix(project.id)

      const res = await bulkShare(project.id, token, { shared: true })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.updated).toBe(3)
      expect(body.skipped).toBe(2) // scheduled + published

      expect(await sharedState(c.noRow.id)).toBe(true)
      expect(await sharedState(c.draft.id)).toBe(true)
      expect(await sharedState(c.complete.id)).toBe(true)
      expect(await sharedState(c.scheduled.id)).toBe(false)
      expect(await sharedState(c.published.id)).toBe(false)

      // The created row is a plain draft, and publish state is untouched elsewhere.
      const [created] = await db.select().from(chapterPublications).where(eq(chapterPublications.chapterId, c.noRow.id))
      expect(created).toMatchObject({ publishStatus: 'draft', isPublished: false, publishedAt: null })
      const [completeRow] = await db.select().from(chapterPublications).where(eq(chapterPublications.chapterId, c.complete.id))
      expect(completeRow).toMatchObject({ publishStatus: 'complete', isPublished: false })
    })

    it('counts released ids passed explicitly as skipped, and ignores ids from another project', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const other = await createTestProject(user.id, { name: 'Other' })
      const c = await seedMix(project.id)
      const foreign = await seedChapter(other.id, 'Foreign')

      const res = await bulkShare(project.id, token, {
        shared: true,
        chapterIds: [c.draft.id, c.scheduled.id, c.published.id, foreign.id],
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toMatchObject({ updated: 1, skipped: 3 })
      expect(await sharedState(c.draft.id)).toBe(true)
      expect(await sharedState(c.noRow.id)).toBeNull() // not in the subset
      expect(await sharedState(c.scheduled.id)).toBe(false)
      // Another project's chapter is never written to.
      expect(await sharedState(foreign.id)).toBeNull()
    })

    it('applies a subset only, and unshares', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const c = await seedMix(project.id)

      await bulkShare(project.id, token, { shared: true })
      const res = await bulkShare(project.id, token, { shared: false, chapterIds: [c.draft.id] })
      expect(JSON.parse(res.payload)).toMatchObject({ updated: 1, skipped: 0 })
      expect(await sharedState(c.draft.id)).toBe(false)
      expect(await sharedState(c.complete.id)).toBe(true)

      const all = await bulkShare(project.id, token, { shared: false })
      expect(JSON.parse(all.payload).updated).toBe(3)
      for (const ch of [c.noRow, c.draft, c.complete]) expect(await sharedState(ch.id)).toBe(false)
    })

    it('does not sweep outlines, supporting docs or archived chapters into share-all', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await seedChapter(project.id, 'Chapter')
      const outline = await seedChapter(project.id, 'Outline', undefined, { contentType: 'outline' })
      const archived = await seedChapter(project.id, 'Archived')
      await db.update(entities).set({ archivedAt: new Date() }).where(eq(entities.id, archived.id))

      const res = await bulkShare(project.id, token, { shared: true })
      expect(JSON.parse(res.payload).updated).toBe(1)
      expect(await sharedState(chapter.id)).toBe(true)
      expect(await sharedState(outline.id)).toBeNull()
      expect(await sharedState(archived.id)).toBeNull()
    })

    it('rejects non-owners, anonymous callers and malformed bodies', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const c = await seedChapter(project.id, 'Mine')
      const { token: strangerToken } = await verifiedUser()

      expect((await bulkShare(project.id, undefined, { shared: true })).statusCode).toBe(401)
      expect([403, 404]).toContain((await bulkShare(project.id, strangerToken, { shared: true })).statusCode)
      expect(await sharedState(c.id)).toBeNull()

      expect((await bulkShare(project.id, token, { shared: 'yes' })).statusCode).toBe(400)
      expect((await bulkShare(project.id, token, { shared: true, chapterIds: ['nope'] })).statusCode).toBe(400)
      expect((await bulkShare(project.id, token, { shared: true, chapterIds: 'x' })).statusCode).toBe(400)
      const tooMany = Array.from({ length: 1001 }, () => '00000000-0000-4000-8000-000000000000')
      expect((await bulkShare(project.id, token, { shared: true, chapterIds: tooMany })).statusCode).toBe(400)
    })

    it('lets a beta reader then see every shared chapter in manuscript order, with slugs', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const c = await seedMix(project.id)
      const reader = await createTestUser()
      await addBetaReader(user.id, reader.id, project.id)

      await bulkShare(project.id, token, { shared: true })

      const body = JSON.parse((await toc(project.id, await createTestToken(reader.id))).payload)
      // Scheduled rows already reach beta readers today, so they appear too; the published one as well.
      expect(body.toc.map((row: any) => row.id)).toEqual([
        c.noRow.id, c.draft.id, c.complete.id, c.scheduled.id, c.published.id,
      ])
      expect(body.toc.filter((row: any) => row.betaOnly).map((row: any) => row.id)).toEqual([
        c.noRow.id, c.draft.id, c.complete.id,
      ])
      for (const id of [c.noRow.id, c.draft.id, c.complete.id]) {
        expect(typeof body.toc.find((row: any) => row.id === id).slug).toBe('string')
      }
    })
  })

  describe('PUT /projects/:projectId/chapters/:chapterId/beta-share', () => {
    it('requires auth and rejects non-owners', async () => {
      const { project, shared } = await seedScenario()
      expect((await betaShare(project.id, shared.id, undefined, { shared: true })).statusCode).toBe(401)

      const { token } = await verifiedUser()
      const res = await betaShare(project.id, shared.id, token, { shared: false })
      expect([403, 404]).toContain(res.statusCode)
      const [row] = await db.select().from(chapterPublications).where(eq(chapterPublications.chapterId, shared.id))
      expect(row!.betaShared).toBe(true)
    })

    it('rejects a non-boolean body', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await seedChapter(project.id, 'Ch')
      expect((await betaShare(project.id, chapter.id, token, { shared: 'yes' })).statusCode).toBe(400)
    })

    it('creates a draft publication row when none exists and does not publish', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await seedChapter(project.id, 'No Row Yet')

      const res = await betaShare(project.id, chapter.id, token, { shared: true })
      expect(res.statusCode).toBe(200)
      const [row] = await db.select().from(chapterPublications).where(eq(chapterPublications.chapterId, chapter.id))
      expect(row).toMatchObject({ betaShared: true, publishStatus: 'draft', isPublished: false, publishedAt: null })
    })

    it('toggles only the flag on an existing row, leaving publish state untouched', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await seedChapter(project.id, 'Ready One')
      await db.insert(chapterPublications).values({
        projectId: project.id, chapterId: chapter.id, publishStatus: 'complete', isPublished: false,
      })

      await betaShare(project.id, chapter.id, token, { shared: true })
      let [row] = await db.select().from(chapterPublications).where(eq(chapterPublications.chapterId, chapter.id))
      expect(row).toMatchObject({ betaShared: true, publishStatus: 'complete', isPublished: false, publishedAt: null })

      await betaShare(project.id, chapter.id, token, { shared: false })
      ;[row] = await db.select().from(chapterPublications).where(eq(chapterPublications.chapterId, chapter.id))
      expect(row).toMatchObject({ betaShared: false, publishStatus: 'complete', isPublished: false })

      // Only the one row exists.
      const rows = await db.select().from(chapterPublications)
        .where(and(eq(chapterPublications.chapterId, chapter.id), eq(chapterPublications.projectId, project.id)))
      expect(rows).toHaveLength(1)
    })

    it('refuses to flag a published or scheduled chapter', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const published = await seedChapter(project.id, 'Live', { published: true })
      const scheduled = await seedChapter(project.id, 'Soon', { status: 'scheduled' })
      for (const ch of [published, scheduled]) {
        expect((await betaShare(project.id, ch.id, token, { shared: true })).statusCode).toBe(409)
        const [row] = await db.select().from(chapterPublications).where(eq(chapterPublications.chapterId, ch.id))
        expect(row!.betaShared).toBe(false)
      }
    })

    it('404s a chapter that does not belong to the project', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const otherProject = await createTestProject(user.id, { name: 'Other' })
      const foreign = await seedChapter(otherProject.id, 'Foreign')
      expect((await betaShare(project.id, foreign.id, token, { shared: true })).statusCode).toBe(404)
    })
  })

  describe('hasBetaAudience on GET /projects/:projectId/publish-config', () => {
    async function hasAudience(projectId: string, token: string) {
      const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/publish-config`, headers: auth(token) })
      expect(res.statusCode).toBe(200)
      return JSON.parse(res.payload).hasBetaAudience
    }

    it('is false with no readers or invites', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      expect(await hasAudience(project.id, token)).toBe(false)
    })

    it('is true with an active reader (project or author-wide), false when inactive', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const reader = await createTestUser()

      await addBetaReader(user.id, reader.id, project.id, false)
      expect(await hasAudience(project.id, token)).toBe(false)

      await db.update(betaReaders).set({ isActive: true }).where(eq(betaReaders.readerId, reader.id))
      expect(await hasAudience(project.id, token)).toBe(true)

      await db.update(betaReaders).set({ projectId: null }).where(eq(betaReaders.readerId, reader.id))
      expect(await hasAudience(project.id, token)).toBe(true)
    })

    it('ignores readers scoped to a different project of the same author', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const other = await createTestProject(user.id, { name: 'Other' })
      await addBetaReader(user.id, (await createTestUser()).id, other.id)
      expect(await hasAudience(project.id, token)).toBe(false)
    })

    it('is true with a usable invite, false once revoked or exhausted', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const [invite] = await db.insert(betaReaderInvites).values({
        authorId: user.id, projectId: project.id, token: `tok-${Date.now()}`, maxUses: 2, useCount: 1,
      }).returning()
      expect(await hasAudience(project.id, token)).toBe(true)

      await db.update(betaReaderInvites).set({ useCount: 2 }).where(eq(betaReaderInvites.id, invite!.id))
      expect(await hasAudience(project.id, token)).toBe(false)

      await db.update(betaReaderInvites).set({ useCount: 0, isActive: false }).where(eq(betaReaderInvites.id, invite!.id))
      expect(await hasAudience(project.id, token)).toBe(false)
    })

    it('carries hasBetaAudience and per-chapter betaShared on the project dashboard', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const noRow = await seedChapter(project.id, 'No Row')
      const shared = await seedChapter(project.id, 'Shared')
      const plain = await seedChapter(project.id, 'Plain', { betaShared: false })
      await betaShare(project.id, shared.id, token, { shared: true })

      const dashboard = async () => JSON.parse((await app.inject({
        method: 'GET', url: `/api/projects/${project.id}/dashboard`, headers: auth(token),
      })).payload)

      let body = await dashboard()
      expect(body.hasBetaAudience).toBe(false)
      const byId = (id: string) => body.chapters.find((c: any) => c.id === id)
      expect(byId(noRow.id).publication).toBeNull()
      expect(byId(shared.id).publication.betaShared).toBe(true)
      expect(byId(plain.id).publication.betaShared).toBe(false)

      await addBetaReader(user.id, (await createTestUser()).id, null)
      body = await dashboard()
      expect(body.hasBetaAudience).toBe(true)
    })

    it('returns betaShared on the author publication endpoints', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await seedChapter(project.id, 'Ch')
      await betaShare(project.id, chapter.id, token, { shared: true })

      const one = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/chapters/${chapter.id}/publication`, headers: auth(token) })
      expect(JSON.parse(one.payload).publication.betaShared).toBe(true)
      const all = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/publications`, headers: auth(token) })
      expect(JSON.parse(all.payload).publications[0].betaShared).toBe(true)
    })
  })
})
