import { describe, it, expect, beforeAll, afterEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { chapterAnnotations, entities, users } from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'

async function seedChapter(projectId: string) {
  const [chapter] = await db.insert(entities).values({
    projectId,
    bobbinId: 'manuscript',
    collectionName: 'content',
    contentType: 'chapter',
    entityData: {
      title: 'Chapter 1 - The Anomaly',
      body: '<p>The reactor hummed, and then it did not.</p>',
      word_count: 9,
    },
  }).returning()
  return chapter!
}

async function seedAnnotation(chapterId: string, projectId: string, authorId: string) {
  const [row] = await db.insert(chapterAnnotations).values({
    chapterId,
    projectId,
    authorId,
    anchorParagraphIndex: 0,
    anchorQuote: 'The reactor hummed',
    annotationType: 'error',
    errorCategory: 'typo',
    content: 'seeded annotation',
    chapterVersion: 1,
  }).returning()
  return row!
}

describe('Public Reader — Annotations', () => {
  let app: any

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterEach(async () => {
    await cleanupAllTestData()
  })

  describe('DELETE /public/chapters/:chapterId/annotations/:annotationId', () => {
    // Regression: this round trip used to 500 in production — an annotation could be
    // created but never retracted, so the author-side inbox could only be dismissed.
    // See docs/BUG_annotation_delete_500.md.
    it('creates an annotation and lets its author delete it', async () => {
      const author = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, author.id))
      const project = await createTestProject(author.id)
      const chapter = await seedChapter(project.id)
      const token = await createTestToken(author.id)

      const created = await app.inject({
        method: 'POST',
        url: `/api/public/chapters/${chapter.id}/annotations`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          projectId: project.id,
          anchorParagraphIndex: 0,
          anchorQuote: 'The reactor hummed',
          annotationType: 'error',
          errorCategory: 'typo',
          content: 'round-trip probe',
          chapterVersion: 1,
        },
      })
      expect(created.statusCode).toBe(201)
      const annotationId = JSON.parse(created.payload).annotation.id

      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/public/chapters/${chapter.id}/annotations/${annotationId}`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(deleted.statusCode).toBe(200)
      expect(JSON.parse(deleted.payload).success).toBe(true)

      // The row is actually gone, not just reported as deleted.
      const remaining = await db
        .select()
        .from(chapterAnnotations)
        .where(eq(chapterAnnotations.id, annotationId))
      expect(remaining).toHaveLength(0)
    })

    // Regression: the real cause of the production 500. Python's urllib (and other
    // clients) set Content-Type: application/json even on a bodyless DELETE. The
    // custom JSON parser in server.ts ran JSON.parse(''), threw, and the resulting
    // error carried no statusCode — so the global error handler turned it into a 500
    // before the route handler ever ran.
    it('deletes normally when the client sends Content-Type: application/json with no body', async () => {
      const author = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, author.id))
      const project = await createTestProject(author.id)
      const chapter = await seedChapter(project.id)
      const annotation = await seedAnnotation(chapter.id, project.id, author.id)
      const token = await createTestToken(author.id)

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/public/chapters/${chapter.id}/annotations/${annotation.id}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
      })

      expect(res.statusCode).toBe(200)

      const remaining = await db
        .select()
        .from(chapterAnnotations)
        .where(eq(chapterAnnotations.id, annotation.id))
      expect(remaining).toHaveLength(0)
    })

    it('returns 401 when unauthenticated', async () => {
      const author = await createTestUser()
      const project = await createTestProject(author.id)
      const chapter = await seedChapter(project.id)
      const annotation = await seedAnnotation(chapter.id, project.id, author.id)

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/public/chapters/${chapter.id}/annotations/${annotation.id}`,
      })

      expect(res.statusCode).toBe(401)
    })

    it('returns 404 for an annotation that does not exist', async () => {
      const author = await createTestUser()
      const project = await createTestProject(author.id)
      const chapter = await seedChapter(project.id)
      const token = await createTestToken(author.id)

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/public/chapters/${chapter.id}/annotations/${crypto.randomUUID()}`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(404)
    })

    it("returns 403 and keeps the row when deleting someone else's annotation", async () => {
      const author = await createTestUser()
      const project = await createTestProject(author.id)
      const chapter = await seedChapter(project.id)

      const reader = await createTestUser()
      const annotation = await seedAnnotation(chapter.id, project.id, reader.id)

      const otherToken = await createTestToken(author.id)
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/public/chapters/${chapter.id}/annotations/${annotation.id}`,
        headers: { authorization: `Bearer ${otherToken}` },
      })

      expect(res.statusCode).toBe(403)

      const remaining = await db
        .select()
        .from(chapterAnnotations)
        .where(eq(chapterAnnotations.id, annotation.id))
      expect(remaining).toHaveLength(1)
    })
  })
})
