import { describe, it, expect, beforeAll, afterEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { chapterAnnotations, entities, users, projectPublishConfig } from '../../db/schema'
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

  describe('PUT|PATCH /projects/:projectId/annotations/:annotationId/status', () => {
    // The route answers to both verbs on purpose: a partial update of one field
    // invites PATCH, and a wrong method here 404s in a way that looks like a
    // missing annotation. See docs/BUG_annotation_delete_500.md.
    it.each(['PUT', 'PATCH'])('accepts %s to update the status', async (method) => {
      const author = await createTestUser()
      const project = await createTestProject(author.id)
      const chapter = await seedChapter(project.id)
      const annotation = await seedAnnotation(chapter.id, project.id, author.id)
      const token = await createTestToken(author.id)

      const res = await app.inject({
        method,
        url: `/api/projects/${project.id}/annotations/${annotation.id}/status`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'dismissed', authorResponse: 'not an issue' },
      })

      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).annotation.status).toBe('dismissed')

      const [row] = await db
        .select()
        .from(chapterAnnotations)
        .where(eq(chapterAnnotations.id, annotation.id))
      expect(row!.status).toBe('dismissed')
      expect(row!.authorResponse).toBe('not an issue')
      expect(row!.resolvedBy).toBe(author.id)
    })

    it('rejects an invalid status', async () => {
      const author = await createTestUser()
      const project = await createTestProject(author.id)
      const chapter = await seedChapter(project.id)
      const annotation = await seedAnnotation(chapter.id, project.id, author.id)
      const token = await createTestToken(author.id)

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${project.id}/annotations/${annotation.id}/status`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'bogus' },
      })

      expect(res.statusCode).toBe(400)
    })

    it('returns 404 for an annotation in another project', async () => {
      const author = await createTestUser()
      const project = await createTestProject(author.id)
      const otherProject = await createTestProject(author.id)
      const chapter = await seedChapter(project.id)
      const annotation = await seedAnnotation(chapter.id, project.id, author.id)
      const token = await createTestToken(author.id)

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${otherProject.id}/annotations/${annotation.id}/status`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'resolved' },
      })

      expect(res.statusCode).toBe(404)
    })
  })
  // Regression: annotations were scoped only by the caller's access to
  // `body.projectId`; the chapter id itself was never checked against that
  // project. A reader of project A could annotate — and, as A's owner, accept a
  // suggestion into — any chapter in project B.
  describe('cross-project chapter ids are rejected', () => {
    it('refuses to create an annotation on a chapter from another project', async () => {
      const attacker = await createTestUser()
      const victim = await createTestUser()
      const attackerProject = await createTestProject(attacker.id)
      const victimProject = await createTestProject(victim.id)
      const victimChapter = await seedChapter(victimProject.id)
      const token = await createTestToken(attacker.id)

      const res = await app.inject({
        method: 'POST',
        url: `/api/public/chapters/${victimChapter.id}/annotations`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          projectId: attackerProject.id,
          anchorQuote: 'The reactor hummed',
          annotationType: 'suggestion',
          content: 'smuggled',
          suggestedText: 'The reactor exploded',
          chapterVersion: 1,
        },
      })

      expect(res.statusCode).toBe(404)
      const rows = await db
        .select()
        .from(chapterAnnotations)
        .where(eq(chapterAnnotations.chapterId, victimChapter.id))
      expect(rows).toHaveLength(0)
    })

    it('does not apply an accepted suggestion to a chapter outside the project', async () => {
      const attacker = await createTestUser()
      const victim = await createTestUser()
      const attackerProject = await createTestProject(attacker.id)
      const victimProject = await createTestProject(victim.id)
      const victimChapter = await seedChapter(victimProject.id)
      const token = await createTestToken(attacker.id)

      // Seed the mismatched row directly — the create route now refuses it.
      const [annotation] = await db.insert(chapterAnnotations).values({
        chapterId: victimChapter.id,
        projectId: attackerProject.id,
        authorId: attacker.id,
        anchorQuote: 'The reactor hummed',
        annotationType: 'suggestion',
        content: 'smuggled',
        suggestedText: 'The reactor exploded',
        chapterVersion: 1,
      }).returning()

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${attackerProject.id}/annotations/${annotation!.id}/accept`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBeLessThan(500)

      const [chapter] = await db
        .select({ entityData: entities.entityData, version: entities.version })
        .from(entities)
        .where(eq(entities.id, victimChapter.id))
      expect((chapter!.entityData as { body: string }).body).toBe('<p>The reactor hummed, and then it did not.</p>')
      expect(chapter!.version).toBe(victimChapter.version)
    })

    it('inserts a suggestion literally even when it contains $-replacement patterns', async () => {
      const author = await createTestUser()
      const project = await createTestProject(author.id)
      const chapter = await seedChapter(project.id)
      const token = await createTestToken(author.id)

      const [annotation] = await db.insert(chapterAnnotations).values({
        chapterId: chapter.id,
        projectId: project.id,
        authorId: author.id,
        anchorQuote: 'The reactor hummed',
        annotationType: 'suggestion',
        content: 'literal dollars',
        // `$&` would re-insert the match and `$$` collapse to `$` under String.replace
        suggestedText: 'It cost $$5 ($&)',
        chapterVersion: 1,
      }).returning()

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/annotations/${annotation!.id}/accept`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(200)

      const [updated] = await db
        .select({ entityData: entities.entityData })
        .from(entities)
        .where(eq(entities.id, chapter.id))
      expect((updated!.entityData as { body: string }).body).toBe('<p>It cost $$5 ($&), and then it did not.</p>')
    })

    it('does not leak other projects\' chapter titles into the author dashboard', async () => {
      const attacker = await createTestUser()
      const victim = await createTestUser()
      const attackerProject = await createTestProject(attacker.id)
      const victimProject = await createTestProject(victim.id)
      const victimChapter = await seedChapter(victimProject.id)
      const token = await createTestToken(attacker.id)

      await db.insert(chapterAnnotations).values({
        chapterId: victimChapter.id,
        projectId: attackerProject.id,
        authorId: attacker.id,
        anchorParagraphIndex: 0,
        anchorQuote: 'The reactor hummed',
        annotationType: 'error',
        content: 'probe',
        chapterVersion: 1,
      })

      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${attackerProject.id}/annotations`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(200)
      const [row] = JSON.parse(res.payload).annotations
      expect(row.chapterTitle).toBeNull()
      expect(row.anchorContext ?? null).toBeNull()
    })
  })

  // Regression: the body was spread straight into `.set()` / `.values()`, and
  // `projectId` is the table's primary key, so a caller could re-point their
  // config row at a project they do not own.
  describe('PUT /projects/:projectId/publish-config', () => {
    it('ignores a projectId smuggled in the body', async () => {
      const owner = await createTestUser()
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, owner.id))
      const victim = await createTestUser()
      const ownProject = await createTestProject(owner.id)
      const victimProject = await createTestProject(victim.id)
      const token = await createTestToken(owner.id)

      const res = await app.inject({
        method: 'PUT',
        url: `/api/projects/${ownProject.id}/publish-config`,
        headers: { authorization: `Bearer ${token}` },
        payload: { projectVisibility: 'public', projectId: victimProject.id },
      })
      expect(res.statusCode).toBe(201)

      const victimRows = await db
        .select()
        .from(projectPublishConfig)
        .where(eq(projectPublishConfig.projectId, victimProject.id))
      expect(victimRows).toHaveLength(0)

      const [own] = await db
        .select()
        .from(projectPublishConfig)
        .where(eq(projectPublishConfig.projectId, ownProject.id))
      expect(own?.projectVisibility).toBe('public')
    })
  })
})
