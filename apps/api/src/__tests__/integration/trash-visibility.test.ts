/**
 * Trash visibility — the safety net for entity soft delete.
 *
 * `entities.deleted_at` keeps trashed rows in place so their comments,
 * annotations and publications survive a restore. The price is that ~77
 * `from(entities)` sites across the API must each exclude them, and a single
 * miss means a chapter the author deleted stays readable — worst case on the
 * public reader.
 *
 * This file exists so that a miss fails CI instead of shipping. **When you add
 * a read surface over entities, add a case here.**
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db/connection'
import {
  bobbinsInstalled,
  chapterPublications,
  comments,
  entities,
  projects,
} from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../test-helpers'

describe('Trash visibility', () => {
  let app: any
  let userId: string
  let projectId: string
  let token: string
  let keptId: string
  let doomedId: string

  const auth = () => ({ authorization: `Bearer ${token}` })

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await cleanupAllTestData()

    const user = await createTestUser({ name: 'Trash Tester' })
    userId = user.id
    token = await createTestToken(userId)

    const project = await createTestProject(userId, { name: 'Trash Project' })
    projectId = project.id

    // Public reader surfaces require the project to be discoverable.
    await db.update(projects)
      .set({ shortUrl: `trash-${Date.now()}`, isPublic: true })
      .where(eq(projects.id, projectId))

    await db.insert(bobbinsInstalled).values([
      { projectId, bobbinId: 'manuscript', version: '1.0.0', manifestJson: { id: 'manuscript', name: 'Manuscript', version: '1.0.0' } },
      { projectId, bobbinId: 'entities', version: '1.0.0', manifestJson: { id: 'entities', name: 'Entities', version: '1.0.0' } },
    ])

    const rows = await db.insert(entities).values([
      {
        projectId, bobbinId: 'manuscript', collectionName: 'content', contentType: 'chapter',
        isPublished: true,
        entityData: { title: 'Kept Chapter', body: '<p>The kept words survive.</p>', word_count: 4, order: 1 },
      },
      {
        projectId, bobbinId: 'manuscript', collectionName: 'content', contentType: 'chapter',
        isPublished: true,
        entityData: { title: 'Doomed Chapter', body: '<p>Garron kissed the succubus.</p>', word_count: 4, order: 2 },
      },
    ]).returning()
    keptId = rows[0]!.id
    doomedId = rows[1]!.id

    // Both published, so the public reader would serve them.
    await db.insert(chapterPublications).values([
      { projectId, chapterId: keptId, isPublished: true, publishStatus: 'published', publishedAt: new Date() },
      { projectId, chapterId: doomedId, isPublished: true, publishStatus: 'published', publishedAt: new Date() },
    ])
  })

  /** Delete through the real endpoint, not a direct UPDATE. */
  async function trashDoomed() {
    const res = await app.inject({
      method: 'POST',
      url: '/api/entities/bulk-delete',
      headers: auth(),
      payload: { projectId, ids: [doomedId] },
    })
    expect(res.statusCode).toBe(200)
    return res.json()
  }

  it('keeps the row and its relations rather than deleting them', async () => {
    await trashDoomed()

    const [row] = await db.select().from(entities).where(eq(entities.id, doomedId))
    expect(row).toBeDefined()
    expect(row!.deletedAt).not.toBeNull()
    expect(row!.deletedBatchId).not.toBeNull()
    expect(row!.deletedBy).toBe(userId)
    // The body is still there — that is what makes restore lossless.
    expect((row!.entityData as any).body).toContain('Garron')

    const pubs = await db.select().from(chapterPublications)
      .where(eq(chapterPublications.chapterId, doomedId))
    expect(pubs).toHaveLength(1)
  })

  it('hides it from every read surface', async () => {
    await trashDoomed()

    const surfaces: Array<[string, string]> = [
      ['dashboard', `/api/projects/${projectId}/dashboard`],
      ['entity list', `/api/entities?projectId=${projectId}&collection=content`],
      ['export', `/api/projects/${projectId}/export?format=markdown`],
      ['public reader chapters', `/api/reader/projects/${projectId}/chapters`],
      ['sitemap', `/api/reader/projects/${projectId}/sitemap`],
    ]

    for (const [label, url] of surfaces) {
      const res = await app.inject({ method: 'GET', url, headers: auth() })
      // A surface that 404s or 400s for unrelated reasons still can't leak.
      const body = res.payload
      expect(`${label}: ${body.includes('Doomed Chapter')}`).toBe(`${label}: false`)
      expect(`${label}: ${body.includes('succubus')}`).toBe(`${label}: false`)
    }

    // The kept chapter must still be there — a filter that hides everything
    // would pass every assertion above.
    const dash = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/dashboard`, headers: auth() })
    expect(dash.payload).toContain('Kept Chapter')
  })

  it('404s a direct fetch of a trashed entity', async () => {
    await trashDoomed()
    const res = await app.inject({
      method: 'GET',
      url: `/api/entities/${doomedId}?projectId=${projectId}&collection=content`,
      headers: auth(),
    })
    expect(res.statusCode).toBe(404)
  })

  it('refuses to write to a trashed entity', async () => {
    await trashDoomed()
    const res = await app.inject({
      method: 'PUT',
      url: `/api/entities/${doomedId}`,
      headers: auth(),
      payload: { projectId, collection: 'content', data: { body: '<p>edited after deletion</p>' } },
    })
    expect(res.statusCode).toBe(404)

    const [row] = await db.select().from(entities).where(eq(entities.id, doomedId))
    expect((row!.entityData as any).body).not.toContain('edited after deletion')
  })

  it('excludes it from the project word count', async () => {
    const before = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/dashboard`, headers: auth() })).json()
    await trashDoomed()
    const after = (await app.inject({ method: 'GET', url: `/api/projects/${projectId}/dashboard`, headers: auth() })).json()

    expect(after.analytics.narrativeWordCount).toBe(before.analytics.narrativeWordCount - 4)
    expect(after.analytics.trashedCount).toBe(1)
  })

  it('lists it in the project trash with a purge date', async () => {
    await trashDoomed()
    const res = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/trash`, headers: auth() })
    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(body.retentionDays).toBe(30)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: doomedId, title: 'Doomed Chapter' })
    expect(new Date(body.items[0].autoDeleteAt).getTime())
      .toBeGreaterThan(new Date(body.items[0].deletedAt).getTime())
    // Metadata only — the trash list must never ship chapter bodies.
    expect(res.payload).not.toContain('succubus')
  })

  it('restores it with its relations intact', async () => {
    // A comment, to prove relations survive the round trip. This is the whole
    // reason for a deleted_at column over a copy-to-trash-table design.
    await db.insert(comments).values({
      chapterId: doomedId, authorId: userId,
      content: 'I liked this chapter', moderationStatus: 'approved',
    })

    await trashDoomed()

    const restore = await app.inject({
      method: 'POST',
      url: '/api/entities/bulk-untrash',
      headers: auth(),
      payload: { projectId, ids: [doomedId] },
    })
    expect(restore.statusCode).toBe(200)
    expect(restore.json().restored).toBe(1)

    const [row] = await db.select().from(entities).where(eq(entities.id, doomedId))
    expect(row!.deletedAt).toBeNull()
    expect(row!.deletedBatchId).toBeNull()
    expect((row!.entityData as any).body).toContain('Garron')

    const kept = await db.select().from(comments).where(eq(comments.chapterId, doomedId))
    expect(kept).toHaveLength(1)

    const dash = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/dashboard`, headers: auth() })
    expect(dash.payload).toContain('Doomed Chapter')
  })

  describe('container cascade', () => {
    let containerId: string
    let childId: string

    beforeEach(async () => {
      const [container] = await db.insert(entities).values({
        projectId, bobbinId: 'manuscript', collectionName: 'containers',
        entityData: { title: 'Act One', order: 1 },
      }).returning()
      containerId = container!.id

      const [child] = await db.insert(entities).values({
        projectId, bobbinId: 'manuscript', collectionName: 'content', contentType: 'chapter',
        entityData: { title: 'Child Chapter', body: '<p>Inside the act.</p>', word_count: 3, order: 3, container_id: containerId },
      }).returning()
      childId = child!.id
    })

    it('trashes children with the container, under one batch', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/entities/bulk-delete', headers: auth(),
        payload: { projectId, ids: [containerId] },
      })
      expect(res.statusCode).toBe(200)

      const rows = await db.select().from(entities)
        .where(and(eq(entities.projectId, projectId), isNull(entities.deletedAt)))
      const liveIds = rows.map(r => r.id)
      expect(liveIds).not.toContain(containerId)
      expect(liveIds).not.toContain(childId)

      const [c] = await db.select().from(entities).where(eq(entities.id, containerId))
      const [k] = await db.select().from(entities).where(eq(entities.id, childId))
      expect(c!.deletedBatchId).toBe(k!.deletedBatchId)
    })

    it('restores the whole batch when one member is restored', async () => {
      await app.inject({
        method: 'POST', url: '/api/entities/bulk-delete', headers: auth(),
        payload: { projectId, ids: [containerId] },
      })

      // Restore only the container — the chapter must come back with it, or
      // the author is left with an act they cannot see the contents of.
      const res = await app.inject({
        method: 'POST', url: '/api/entities/bulk-untrash', headers: auth(),
        payload: { projectId, ids: [containerId] },
      })
      expect(res.statusCode).toBe(200)

      const [c] = await db.select().from(entities).where(eq(entities.id, containerId))
      const [k] = await db.select().from(entities).where(eq(entities.id, childId))
      expect(c!.deletedAt).toBeNull()
      expect(k!.deletedAt).toBeNull()
    })

    it('leaves separately-trashed rows on their own clock', async () => {
      // Chapter trashed on its own first...
      await trashDoomed()
      const [before] = await db.select().from(entities).where(eq(entities.id, doomedId))

      // ...then a container trashed later must not adopt it into its batch,
      // or restoring the container would silently resurrect it too.
      await app.inject({
        method: 'POST', url: '/api/entities/bulk-delete', headers: auth(),
        payload: { projectId, ids: [containerId] },
      })

      const [after] = await db.select().from(entities).where(eq(entities.id, doomedId))
      expect(after!.deletedBatchId).toBe(before!.deletedBatchId)

      const [container] = await db.select().from(entities).where(eq(entities.id, containerId))
      expect(container!.deletedBatchId).not.toBe(after!.deletedBatchId)
    })
  })

  describe('permanent delete', () => {
    it('removes a trashed row for good', async () => {
      await trashDoomed()
      const res = await app.inject({
        method: 'POST', url: '/api/entities/bulk-delete-permanent', headers: auth(),
        payload: { projectId, ids: [doomedId] },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().deleted).toBe(1)

      const rows = await db.select().from(entities).where(eq(entities.id, doomedId))
      expect(rows).toHaveLength(0)
    })

    it('refuses to touch a live row', async () => {
      // There must be no path from live to gone that skips the trash.
      const res = await app.inject({
        method: 'POST', url: '/api/entities/bulk-delete-permanent', headers: auth(),
        payload: { projectId, ids: [keptId] },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().deleted).toBe(0)

      const rows = await db.select().from(entities).where(eq(entities.id, keptId))
      expect(rows).toHaveLength(1)
    })
  })

  describe('change feed', () => {
    const feed = async (since = 0) => (await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/changes?since=${since}&coalesce=false`,
      headers: auth(),
    })).json()

    it('reports a trash as deleted/trashed and a restore as created/untrashed', async () => {
      await trashDoomed()
      const trashed = (await feed()).events.filter((e: any) => e.entityId === doomedId)
      expect(trashed.at(-1)).toMatchObject({ action: 'deleted', lifecycle: 'trashed' })

      await app.inject({
        method: 'POST', url: '/api/entities/bulk-untrash', headers: auth(),
        payload: { projectId, ids: [doomedId] },
      })
      const restored = (await feed()).events.filter((e: any) => e.entityId === doomedId)
      expect(restored.at(-1)).toMatchObject({ action: 'created', lifecycle: 'untrashed' })
    })

    it('does not coalesce a trash-then-restore into a delete', async () => {
      // Both events land in one polling window. Netting out to `deleted` would
      // tell a sync bot to drop a chapter that still exists, and — since the
      // feed is cursor-based — it would never hear about it again.
      await trashDoomed()
      await app.inject({
        method: 'POST', url: '/api/entities/bulk-untrash', headers: auth(),
        payload: { projectId, ids: [doomedId] },
      })

      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/changes?since=0`,
        headers: auth(),
      })
      const change = res.json().changes.find((c: any) => c.entityId === doomedId)
      expect(change.action).not.toBe('deleted')
      expect(change.lifecycle).toBe('untrashed')
    })
  })
})
