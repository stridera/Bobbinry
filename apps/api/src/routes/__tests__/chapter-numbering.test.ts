import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { entities, chapterPublications } from '../../db/schema'
import { createTestApp, createTestToken, createTestUser, createTestProject, cleanupAllTestData } from '../../__tests__/test-helpers'

/**
 * Automatic chapter numbering: a display-only transform derived from manuscript
 * order. Titles in the database never change; the reader, SEO, RSS and export
 * surfaces render "Chapter N: Title" from the current order.
 */
describe('automatic chapter numbering', () => {
  let app: any
  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  afterEach(async () => { await cleanupAllTestData() })

  const auth = (token: string) => ({ authorization: `Bearer ${token}` })

  async function seedContainer(projectId: string, title: string, order: number, parentId?: string) {
    const [row] = await db.insert(entities).values({
      projectId,
      bobbinId: 'manuscript',
      collectionName: 'containers',
      entityData: { title, order, type: 'folder', ...(parentId ? { parent_id: parentId } : {}) },
    }).returning()
    return row!
  }

  async function seedChapter(
    projectId: string,
    title: string,
    order: number,
    opts: { containerId?: string; published?: boolean } = {},
  ) {
    const [chapter] = await db.insert(entities).values({
      projectId,
      bobbinId: 'manuscript',
      collectionName: 'content',
      contentType: 'chapter',
      entityData: {
        title, body: `<p>${title} body</p>`, word_count: 10, order,
        ...(opts.containerId ? { container_id: opts.containerId } : {}),
      },
    }).returning()
    if (opts.published !== false) {
      const now = new Date()
      await db.insert(chapterPublications).values({
        projectId, chapterId: chapter!.id, publishStatus: 'published',
        isPublished: true, publishedAt: now, publicReleaseDate: now,
      })
    }
    return chapter!
  }

  async function setProjectNumbering(projectId: string, token: string, chapterNumbering: string | null) {
    return app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/manuscript-display-settings`,
      headers: auth(token),
      payload: { chapterNumbering },
    })
  }

  const toc = (projectId: string) =>
    app.inject({ method: 'GET', url: `/api/public/projects/${projectId}/toc` })
  const chapterRes = (projectId: string, id: string) =>
    app.inject({ method: 'GET', url: `/api/public/projects/${projectId}/chapters/${id}` })

  async function tocTitles(projectId: string): Promise<string[]> {
    const res = await toc(projectId)
    expect(res.statusCode).toBe(200)
    return JSON.parse(res.payload).toc.map((c: any) => c.title)
  }

  async function scenario() {
    const author = await createTestUser()
    const token = await createTestToken(author.id)
    const project = await createTestProject(author.id)
    return { author, token, project }
  }

  it('leaves titles alone by default', async () => {
    const { project } = await scenario()
    await seedChapter(project.id, 'Storm', 100)
    await seedChapter(project.id, 'Calm', 200)
    expect(await tocTitles(project.id)).toEqual(['Storm', 'Calm'])
  })

  it('numbers the TOC and chapter page, and renumbers when order changes, without touching stored titles', async () => {
    const { token, project } = await scenario()
    const a = await seedChapter(project.id, 'Storm', 100)
    const b = await seedChapter(project.id, 'Chapter 9 - Calm', 200)
    const c = await seedChapter(project.id, '', 300)

    expect([200, 201]).toContain((await setProjectNumbering(project.id, token, 'continuous')).statusCode)

    expect(await tocTitles(project.id)).toEqual(['Chapter 1: Storm', 'Chapter 2: Calm', 'Chapter 3'])
    const tocBody = JSON.parse((await toc(project.id)).payload)
    expect(tocBody.toc[1].rawTitle).toBe('Chapter 9 - Calm')

    const page = JSON.parse((await chapterRes(project.id, b.id)).payload)
    expect(page.chapter.title).toBe('Chapter 2: Calm')
    expect(page.chapter.rawTitle).toBe('Chapter 9 - Calm')
    expect(page.resolvedDisplay.chapterNumbering).toBe('continuous')

    // Move "Calm" to the front by changing only its order.
    await db.update(entities)
      .set({ entityData: { title: 'Chapter 9 - Calm', body: '<p>x</p>', word_count: 10, order: 50 } })
      .where(eq(entities.id, b.id))

    expect(await tocTitles(project.id)).toEqual(['Chapter 1: Calm', 'Chapter 2: Storm', 'Chapter 3'])
    const moved = JSON.parse((await chapterRes(project.id, b.id)).payload)
    expect(moved.chapter.title).toBe('Chapter 1: Calm')

    // Stored titles are untouched, so slugs and URLs stay put.
    const [stored] = await db.select().from(entities).where(eq(entities.id, a.id))
    expect((stored!.entityData as any).title).toBe('Storm')
    expect(c.id).toBeDefined()
  })

  it('restarts in each top-level folder when per-book', async () => {
    const { token, project } = await scenario()
    const book1 = await seedContainer(project.id, 'Book One', 100)
    const act = await seedContainer(project.id, 'Act I', 100, book1.id)
    const book2 = await seedContainer(project.id, 'Book Two', 200)
    await seedChapter(project.id, 'Alpha', 100, { containerId: act.id })
    await seedChapter(project.id, 'Beta', 200, { containerId: book1.id })
    await seedChapter(project.id, 'Gamma', 100, { containerId: book2.id })

    await setProjectNumbering(project.id, token, 'per-book')
    expect(await tocTitles(project.id)).toEqual(['Chapter 1: Alpha', 'Chapter 2: Beta', 'Chapter 1: Gamma'])

    await setProjectNumbering(project.id, token, 'continuous')
    expect(await tocTitles(project.id)).toEqual(['Chapter 1: Alpha', 'Chapter 2: Beta', 'Chapter 3: Gamma'])
  })

  it('numbers among published chapters so readers never see a gap', async () => {
    const { token, project } = await scenario()
    await seedChapter(project.id, 'One', 100)
    await seedChapter(project.id, 'Hidden draft', 200, { published: false })
    const three = await seedChapter(project.id, 'Three', 300)
    await setProjectNumbering(project.id, token, 'continuous')

    expect(await tocTitles(project.id)).toEqual(['Chapter 1: One', 'Chapter 2: Three'])
    const page = JSON.parse((await chapterRes(project.id, three.id)).payload)
    expect(page.chapter.title).toBe('Chapter 2: Three')

    const meta = await app.inject({ method: 'GET', url: `/api/public/projects/${project.id}/chapters/${three.id}/metadata` })
    if (meta.statusCode === 200) {
      expect(JSON.parse(meta.payload).metadata.openGraph.title).toBe('Chapter 2: Three')
    }
  })

  it('inherits the author default and lets the project override it', async () => {
    const { token, project } = await scenario()
    await seedChapter(project.id, 'Alpha', 100)

    const put = await app.inject({
      method: 'PUT', url: '/api/users/me/manuscript-display-settings',
      headers: auth(token), payload: { chapterNumbering: 'continuous' },
    })
    expect([200, 201]).toContain(put.statusCode)
    expect(await tocTitles(project.id)).toEqual(['Chapter 1: Alpha'])

    await setProjectNumbering(project.id, token, 'off')
    expect(await tocTitles(project.id)).toEqual(['Alpha'])

    await setProjectNumbering(project.id, token, null)
    expect(await tocTitles(project.id)).toEqual(['Chapter 1: Alpha'])
  })

  it('rejects unknown modes', async () => {
    const { token, project } = await scenario()
    expect((await setProjectNumbering(project.id, token, 'roman')).statusCode).toBe(400)
    const bad = await app.inject({
      method: 'PUT', url: '/api/users/me/manuscript-display-settings',
      headers: auth(token), payload: { chapterNumbering: null },
    })
    expect(bad.statusCode).toBe(400)
  })

  it('numbers export headings across every chapter, drafts included', async () => {
    const { token, project } = await scenario()
    await seedChapter(project.id, 'One', 100)
    await seedChapter(project.id, 'Draft two', 200, { published: false })
    await setProjectNumbering(project.id, token, 'continuous')

    const res = await app.inject({
      method: 'GET', url: `/api/projects/${project.id}/export/markdown`, headers: auth(token),
    })
    expect(res.statusCode).toBe(200)
    expect(res.payload).toContain('# Chapter 1: One')
    expect(res.payload).toContain('# Chapter 2: Draft two')
  })
})
