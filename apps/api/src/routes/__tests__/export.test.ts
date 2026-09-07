import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { entities, users } from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'

/**
 * Seeds a manuscript chapter as an `entities` row in the `content`
 * collection — this mirrors the shape export.ts's getSnapshot() reads
 * (bobbinId 'manuscript', collectionName 'content', entityData carrying
 * title/body/order/status/word_count). Matches seedChapter() in
 * reader-annotations.test.ts.
 */
async function seedChapter(
  projectId: string,
  overrides: { title?: string; body?: string; order?: number } = {},
) {
  const [chapter] = await db.insert(entities).values({
    projectId,
    bobbinId: 'manuscript',
    collectionName: 'content',
    contentType: 'chapter',
    entityData: {
      title: overrides.title ?? 'Chapter 1 - The Anomaly',
      body: overrides.body ?? '<p>The reactor hummed, and then it did not.</p>',
      order: overrides.order ?? 100,
      word_count: 9,
    },
  }).returning()
  return chapter!
}

describe('export routes', () => {
  let app: any

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  afterEach(async () => { await cleanupAllTestData() })

  async function verifiedUser() {
    const user = await createTestUser()
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
    return { user, token: await createTestToken(user.id) }
  }

  function exportReq(token: string | null, projectId: string, format: string, query = '') {
    const headers: Record<string, string> = {}
    if (token) headers.authorization = `Bearer ${token}`
    return app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/export/${format}${query}`,
      headers,
    })
  }

  // --- Auth / ownership ---

  it('returns 401 without a token', async () => {
    const { user, token } = await verifiedUser()
    const project = await createTestProject(user.id)
    await seedChapter(project.id)
    // token unused for this assertion — request goes out with no auth header
    void token

    const res = await exportReq(null, project.id, 'txt')
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when the caller does not own the project', async () => {
    const owner = await createTestUser()
    const project = await createTestProject(owner.id)
    await seedChapter(project.id)

    const { token: intruderToken } = await verifiedUser()
    const res = await exportReq(intruderToken, project.id, 'txt')
    expect(res.statusCode).toBe(403)
  })

  it('returns 404 for a project that does not exist', async () => {
    const { token } = await verifiedUser()
    const res = await exportReq(token, '00000000-0000-0000-0000-000000000000', 'txt')
    expect(res.statusCode).toBe(404)
  })

  // --- Format validation ---

  it('returns 400 for an unsupported format, listing the supported ones', async () => {
    const { user, token } = await verifiedUser()
    const project = await createTestProject(user.id)
    await seedChapter(project.id)

    const res = await exportReq(token, project.id, 'xml')
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body.error).toContain('Invalid format "xml"')
    expect(body.error).toContain('pdf')
    expect(body.error).toContain('epub')
    expect(body.error).toContain('docx')
    expect(body.error).toContain('markdown')
    expect(body.error).toContain('txt')
  })

  it('returns 404 when the project has no manuscript content', async () => {
    const { user, token } = await verifiedUser()
    const project = await createTestProject(user.id)

    const res = await exportReq(token, project.id, 'txt')
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.payload).error).toMatch(/No manuscript content found/)
  })

  // --- Text formats ---

  const textFormats: Array<{ format: string; contentType: RegExp }> = [
    { format: 'txt', contentType: /^text\/plain/ },
    { format: 'markdown', contentType: /^text\/markdown/ },
  ]

  for (const { format, contentType } of textFormats) {
    it(`exports ${format} with 200, the right Content-Type, an attachment disposition, and the chapter content`, async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await seedChapter(project.id, {
        title: 'The Anomaly',
        body: '<p>The reactor hummed, and then it did not.</p>',
      })

      const res = await exportReq(token, project.id, format)
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toMatch(contentType)
      expect(res.headers['content-disposition']).toMatch(/^attachment;/)
      // txt uppercases the chapter title as a heading (chapterToPlainText);
      // markdown keeps the original case (`# Title`) — compare case-insensitively.
      expect(res.payload.toLowerCase()).toContain('the anomaly')
      expect(res.payload).toContain('The reactor hummed, and then it did not.')
    })
  }

  // --- Binary formats ---

  const binaryFormats: Array<{ format: string; contentType: string }> = [
    { format: 'docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { format: 'epub', contentType: 'application/epub+zip' },
    { format: 'pdf', contentType: 'application/pdf' },
  ]

  for (const { format, contentType } of binaryFormats) {
    it(`exports ${format} with 200, the right Content-Type, and a non-empty binary payload`, async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await seedChapter(project.id)

      const res = await exportReq(token, project.id, format)
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toBe(contentType)
      expect(res.headers['content-disposition']).toMatch(/^attachment;/)
      expect(res.rawPayload.length).toBeGreaterThan(0)
    }, 20000)
  }

  // --- Chapter ordering ---

  it('orders chapters by manuscript order in the exported text', async () => {
    const { user, token } = await verifiedUser()
    const project = await createTestProject(user.id)
    await seedChapter(project.id, { title: 'Second Chapter Title', body: '<p>Second body.</p>', order: 200 })
    await seedChapter(project.id, { title: 'First Chapter Title', body: '<p>First body.</p>', order: 100 })

    const res = await exportReq(token, project.id, 'txt')
    expect(res.statusCode).toBe(200)

    const payload = res.payload.toLowerCase()
    const firstIdx = payload.indexOf('first chapter title')
    const secondIdx = payload.indexOf('second chapter title')
    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(secondIdx).toBeGreaterThanOrEqual(0)
    expect(firstIdx).toBeLessThan(secondIdx)
  })

  // --- Trash exclusion ---

  it('excludes a trashed chapter from the export', async () => {
    const { user, token } = await verifiedUser()
    const project = await createTestProject(user.id)
    const kept = await seedChapter(project.id, { title: 'Kept Chapter', body: '<p>Kept body.</p>', order: 100 })
    const trashed = await seedChapter(project.id, { title: 'Trashed Chapter', body: '<p>Trashed body.</p>', order: 200 })

    await db.update(entities).set({ deletedAt: new Date() }).where(eq(entities.id, trashed.id))

    const res = await exportReq(token, project.id, 'txt')
    expect(res.statusCode).toBe(200)
    const payload = res.payload.toLowerCase()
    expect(payload).toContain('kept chapter')
    expect(payload).not.toContain('trashed chapter')

    // Sanity: the kept chapter row itself is untouched.
    const [row] = await db.select().from(entities).where(eq(entities.id, kept.id))
    expect(row!.deletedAt).toBeNull()
  })
})
