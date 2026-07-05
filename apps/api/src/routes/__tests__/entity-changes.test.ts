import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import { db } from '../../db/connection'
import { entities, entityChanges, projects } from '../../db/schema'
import { eq } from 'drizzle-orm'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'
import { diffEntityData, extractWordCount, extractTitle, coalesceChanges } from '../../lib/entity-changes'

describe('diffEntityData', () => {
  it('reports all keys as changed on create (null old data)', () => {
    const diff = diffEntityData(null, { title: 'Ch 1', body: '<p>hi</p>', word_count: 1 })
    expect(diff.fieldsChanged).toEqual(['body', 'title'])
    expect(diff.wordCountBefore).toBeNull()
    expect(diff.wordCountAfter).toBe(1)
  })

  it('skips volatile keys and reports word counts separately', () => {
    const oldData = { title: 'Ch 1', body: '<p>one two</p>', word_count: 2, updated_at: 'a' }
    const newData = { title: 'Ch 1', body: '<p>one two three</p>', word_count: 3, updated_at: 'b' }
    const diff = diffEntityData(oldData, newData)
    expect(diff.fieldsChanged).toEqual(['body'])
    expect(diff.wordCountBefore).toBe(2)
    expect(diff.wordCountAfter).toBe(3)
  })

  it('detects notes-only changes', () => {
    const oldData = { title: 'Ch 1', body: '<p>x</p>', notes: 'old', word_count: 1 }
    const newData = { title: 'Ch 1', body: '<p>x</p>', notes: 'new', word_count: 1 }
    const diff = diffEntityData(oldData, newData)
    expect(diff.fieldsChanged).toEqual(['notes'])
    expect(diff.wordCountBefore).toBe(1)
    expect(diff.wordCountAfter).toBe(1)
  })

  it('returns empty diff for identical data (re-save)', () => {
    const data = { title: 'Ch 1', body: '<p>x</p>', word_count: 1 }
    const diff = diffEntityData(data, { ...data, updated_at: 'later' })
    expect(diff.fieldsChanged).toEqual([])
  })

  it('compares nested objects structurally', () => {
    const oldData = { meta: { a: 1 } }
    expect(diffEntityData(oldData, { meta: { a: 1 } }).fieldsChanged).toEqual([])
    expect(diffEntityData(oldData, { meta: { a: 2 } }).fieldsChanged).toEqual(['meta'])
  })

  it('parses string word counts', () => {
    expect(extractWordCount({ word_count: '42' })).toBe(42)
    expect(extractWordCount({ word_count: 42 })).toBe(42)
    expect(extractWordCount({})).toBeNull()
    expect(extractWordCount(null)).toBeNull()
  })

  it('extracts title with name fallback', () => {
    expect(extractTitle({ title: 'Ch 1' })).toBe('Ch 1')
    expect(extractTitle({ name: 'Elena' })).toBe('Elena')
    expect(extractTitle({})).toBeNull()
  })
})

describe('coalesceChanges', () => {
  const base = {
    projectId: 'p',
    collection: 'content',
    contentType: 'chapter',
    actor: 'u',
  }
  let seq = 0
  function row(overrides: Record<string, unknown>) {
    seq++
    return {
      seq,
      entityId: 'e1',
      title: 'Ch 1',
      action: 'updated',
      fieldsChanged: [],
      wordCountBefore: null,
      wordCountAfter: null,
      occurredAt: new Date(2026, 0, seq),
      ...base,
      ...overrides,
    } as any
  }

  beforeEach(() => { seq = 0 })

  it('collapses an autosave burst into one net change', () => {
    const changes = coalesceChanges([
      row({ fieldsChanged: ['body'], wordCountBefore: 100, wordCountAfter: 150 }),
      row({ fieldsChanged: ['body'], wordCountBefore: 150, wordCountAfter: 200 }),
      row({ fieldsChanged: ['notes'] }),
      row({ fieldsChanged: ['body'], wordCountBefore: 200, wordCountAfter: 180 }),
    ])
    expect(changes).toHaveLength(1)
    const c = changes[0]!
    expect(c.action).toBe('updated')
    expect(c.fieldsChanged).toEqual(['body', 'notes'])
    expect(c.wordCountBefore).toBe(100)
    expect(c.wordCountAfter).toBe(180)
    expect(c.wordCountDelta).toBe(80)
    expect(c.eventCount).toBe(4)
  })

  it('created + updates nets to created with full delta', () => {
    const changes = coalesceChanges([
      row({ action: 'created', fieldsChanged: ['body', 'title'], wordCountAfter: 50 }),
      row({ fieldsChanged: ['body'], wordCountBefore: 50, wordCountAfter: 900 }),
    ])
    expect(changes).toHaveLength(1)
    expect(changes[0]!.action).toBe('created')
    // wordCountBefore stays null (entity didn't exist) → delta = full 900
    expect(changes[0]!.wordCountDelta).toBe(900)
  })

  it('created then deleted nets to deleted with zero delta', () => {
    const changes = coalesceChanges([
      row({ action: 'created', wordCountAfter: 50 }),
      row({ action: 'deleted', wordCountBefore: 50 }),
    ])
    expect(changes[0]!.action).toBe('deleted')
    // Entity both appeared and vanished inside the window: net contribution 0.
    expect(changes[0]!.wordCountAfter).toBeNull()
    expect(changes[0]!.wordCountDelta).toBe(0)
  })

  it('updated then deleted reports the negative delta of the removed words', () => {
    const changes = coalesceChanges([
      row({ fieldsChanged: ['body'], wordCountBefore: 100, wordCountAfter: 120 }),
      row({ action: 'deleted', wordCountBefore: 120 }),
    ])
    expect(changes[0]!.action).toBe('deleted')
    expect(changes[0]!.wordCountAfter).toBeNull()
    // The entity entered the window holding 100 words and left holding none.
    expect(changes[0]!.wordCountDelta).toBe(-100)
  })

  it('keeps separate entities separate', () => {
    const changes = coalesceChanges([
      row({ entityId: 'a', fieldsChanged: ['body'] }),
      row({ entityId: 'b', fieldsChanged: ['notes'] }),
    ])
    expect(changes).toHaveLength(2)
  })

  it('metadata-only events do not clobber word counts', () => {
    const changes = coalesceChanges([
      row({ fieldsChanged: ['body'], wordCountBefore: 10, wordCountAfter: 90 }),
      row({ fieldsChanged: ['order'] }), // reorder event, wc nulls
    ])
    expect(changes[0]!.wordCountAfter).toBe(90)
    expect(changes[0]!.wordCountDelta).toBe(80)
  })
})

describe('GET /api/projects/:projectId/changes', () => {
  let app: any
  let user: any
  let token: string
  let project: any

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await cleanupAllTestData()
    await app.close()
  })

  beforeEach(async () => {
    await cleanupAllTestData()
    user = await createTestUser()
    token = await createTestToken(user.id)
    project = await createTestProject(user.id)
  })

  async function seedChapter(data: Record<string, unknown> = {}) {
    const [row] = await db.insert(entities).values({
      id: crypto.randomUUID(),
      projectId: project.id,
      scope: 'project',
      bobbinId: 'manuscript',
      collectionName: 'content',
      contentType: 'chapter',
      entityData: {
        title: 'Chapter 1',
        body: '<p>one two three</p>',
        word_count: 3,
        order: 100,
        ...data,
      },
    }).returning()
    return row!
  }

  function get(path: string) {
    return app.inject({
      method: 'GET',
      url: path,
      headers: { authorization: `Bearer ${token}` },
    })
  }

  it('bootstraps with the current cursor and no changes', async () => {
    const res = await get(`/api/projects/${project.id}/changes`)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.changes).toEqual([])
    expect(typeof body.cursor).toBe('number')
    expect(body.hasMore).toBe(false)
  })

  it('bootstrap honors coalesce=false response shape', async () => {
    const res = (await get(`/api/projects/${project.id}/changes?coalesce=false`)).json()
    expect(res.events).toEqual([])
    expect(res.changes).toBeUndefined()
  })

  it('records a feed event on entity update and returns it coalesced', async () => {
    const chapter = await seedChapter()

    const boot = (await get(`/api/projects/${project.id}/changes`)).json()

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/entities/${chapter.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        collection: 'content',
        projectId: project.id,
        data: { title: 'Chapter 1', body: '<p>one two three four five</p>' },
      },
    })
    expect(putRes.statusCode).toBe(200)

    const res = await get(`/api/projects/${project.id}/changes?since=${boot.cursor}`)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.changes).toHaveLength(1)
    const change = body.changes[0]
    expect(change.entityId).toBe(chapter.id)
    expect(change.action).toBe('updated')
    expect(change.fieldsChanged).toContain('body')
    expect(change.wordCountBefore).toBe(3)
    expect(change.wordCountAfter).toBe(5)
    expect(change.wordCountDelta).toBe(2)
    expect(change.contentType).toBe('chapter')
    expect(body.cursor).toBeGreaterThan(boot.cursor)
  })

  it('records nothing for a no-op re-save', async () => {
    const chapter = await seedChapter()
    const boot = (await get(`/api/projects/${project.id}/changes`)).json()

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/entities/${chapter.id}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        collection: 'content',
        projectId: project.id,
        data: { title: 'Chapter 1', body: '<p>one two three</p>', word_count: 3 },
      },
    })
    expect(putRes.statusCode).toBe(200)

    const res = (await get(`/api/projects/${project.id}/changes?since=${boot.cursor}`)).json()
    expect(res.changes).toEqual([])
  })

  it('records a deleted event with the final word count', async () => {
    const chapter = await seedChapter({ word_count: 1234 })
    const boot = (await get(`/api/projects/${project.id}/changes`)).json()

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/entities/${chapter.id}?projectId=${project.id}&collection=content`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(delRes.statusCode).toBe(200)

    const res = (await get(`/api/projects/${project.id}/changes?since=${boot.cursor}`)).json()
    expect(res.changes).toHaveLength(1)
    expect(res.changes[0].action).toBe('deleted')
    expect(res.changes[0].wordCountBefore).toBe(1234)
    expect(res.changes[0].title).toBe('Chapter 1')
  })

  it('filters by collection and advances the cursor past filtered rows', async () => {
    await db.insert(entityChanges).values([
      { projectId: project.id, entityId: crypto.randomUUID(), collection: 'content', action: 'updated', fieldsChanged: ['body'] },
      { projectId: project.id, entityId: crypto.randomUUID(), collection: 'characters', action: 'updated', fieldsChanged: ['name'] },
    ])

    const res = (await get(`/api/projects/${project.id}/changes?since=0&collection=content`)).json()
    expect(res.changes).toHaveLength(1)
    expect(res.changes[0].collection).toBe('content')

    // Cursor covers the filtered-out row too — next poll starts fresh.
    const next = (await get(`/api/projects/${project.id}/changes?since=${res.cursor}&collection=content`)).json()
    expect(next.changes).toEqual([])
  })

  it('returns raw events with coalesce=false', async () => {
    const entityId = crypto.randomUUID()
    await db.insert(entityChanges).values([
      { projectId: project.id, entityId, collection: 'content', action: 'updated', fieldsChanged: ['body'], wordCountBefore: 1, wordCountAfter: 2 },
      { projectId: project.id, entityId, collection: 'content', action: 'updated', fieldsChanged: ['body'], wordCountBefore: 2, wordCountAfter: 3 },
    ])

    const res = (await get(`/api/projects/${project.id}/changes?since=0&coalesce=false`)).json()
    expect(res.events).toHaveLength(2)
    expect(res.events[0].seq).toBeLessThan(res.events[1].seq)
  })

  it('pages with hasMore when the window exceeds limit', async () => {
    const entityId = crypto.randomUUID()
    await db.insert(entityChanges).values(
      Array.from({ length: 5 }, () => ({
        projectId: project.id,
        entityId,
        collection: 'content',
        action: 'updated' as const,
        fieldsChanged: ['body'],
      }))
    )

    const page1 = (await get(`/api/projects/${project.id}/changes?since=0&limit=3&coalesce=false`)).json()
    expect(page1.events).toHaveLength(3)
    expect(page1.hasMore).toBe(true)

    const page2 = (await get(`/api/projects/${project.id}/changes?since=${page1.cursor}&limit=3&coalesce=false`)).json()
    expect(page2.events).toHaveLength(2)
    expect(page2.hasMore).toBe(false)
  })

  it('never leaks another project into the feed', async () => {
    const otherOwner = await createTestUser()
    const otherProject = await createTestProject(otherOwner.id)
    await db.insert(entityChanges).values({
      projectId: otherProject.id,
      entityId: crypto.randomUUID(),
      collection: 'content',
      action: 'updated',
      fieldsChanged: ['body'],
    })

    const res = (await get(`/api/projects/${project.id}/changes?since=0`)).json()
    expect(res.changes).toEqual([])
  })

  it('rejects a non-owner with 403', async () => {
    const stranger = await createTestUser()
    const strangerToken = await createTestToken(stranger.id)
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/changes`,
      headers: { authorization: `Bearer ${strangerToken}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('cascades feed rows away when the project is hard-deleted', async () => {
    // FK is ON DELETE CASCADE — sanity check the constraint wiring.
    await db.insert(entityChanges).values({
      projectId: project.id,
      entityId: crypto.randomUUID(),
      collection: 'content',
      action: 'updated',
      fieldsChanged: ['body'],
    })
    await db.delete(entities).where(eq(entities.projectId, project.id))
    await db.delete(projects).where(eq(projects.id, project.id))
    const rows = await db.select().from(entityChanges).where(eq(entityChanges.projectId, project.id))
    expect(rows).toHaveLength(0)
  })
})
