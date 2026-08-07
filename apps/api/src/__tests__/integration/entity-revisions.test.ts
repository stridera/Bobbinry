/**
 * Revision history integration tests.
 *
 * The session-bucket upsert is the part most likely to be subtly wrong, so most
 * of this file is about *how many rows* a sequence of saves produces and *which
 * state* they hold — not about the endpoints' response shapes.
 *
 * Runs with a 2-second window (REVISION_WINDOW_MS) so bucket rollover is
 * observable without sleeping for fifteen minutes.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import { asc, eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { bobbinsInstalled, entities, entityRevisions } from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../test-helpers'

const WINDOW_MS = 2000

describe('Entity revisions', () => {
  let app: any
  let userId: string
  let projectId: string
  let token: string
  let chapterId: string

  const auth = () => ({ authorization: `Bearer ${token}` })

  const save = (body: string, extra: Record<string, unknown> = {}) => app.inject({
    method: 'PUT',
    url: `/api/entities/${chapterId}`,
    headers: auth(),
    payload: { projectId, collection: 'content', data: { body, ...extra } },
  })

  const revisions = () => db
    .select()
    .from(entityRevisions)
    .where(eq(entityRevisions.entityId, chapterId))
    .orderBy(asc(entityRevisions.sessionStartedAt), asc(entityRevisions.id))

  const liveBody = async () => {
    const [row] = await db.select().from(entities).where(eq(entities.id, chapterId))
    return (row!.entityData as any).body as string
  }

  beforeAll(async () => {
    process.env['REVISION_WINDOW_MS'] = String(WINDOW_MS)
    app = await createTestApp()
  })

  afterAll(async () => {
    delete process.env['REVISION_WINDOW_MS']
    await app.close()
  })

  beforeEach(async () => {
    await cleanupAllTestData()

    const user = await createTestUser({ name: 'Revision Tester' })
    userId = user.id
    token = await createTestToken(userId)

    const project = await createTestProject(userId, { name: 'Revision Project' })
    projectId = project.id

    await db.insert(bobbinsInstalled).values({
      projectId, bobbinId: 'manuscript', version: '1.0.0',
      manifestJson: { id: 'manuscript', name: 'Manuscript', version: '1.0.0' },
    })

    const [chapter] = await db.insert(entities).values({
      projectId, bobbinId: 'manuscript', collectionName: 'content', contentType: 'chapter',
      entityData: {
        title: 'Chapter One',
        body: '<p>Garron drew his blade and lunged at the succubus.</p>',
        word_count: 9,
        order: 1,
      },
    }).returning()
    chapterId = chapter!.id
  })

  describe('session windows', () => {
    it('collapses many saves in one window onto a single row', async () => {
      await save('<p>Garron drew his blade and lunged at the succubus. One.</p>')
      await save('<p>Garron drew his blade and lunged at the succubus. Two.</p>')
      await save('<p>Garron drew his blade and lunged at the succubus. Three.</p>')

      const rows = await revisions()
      expect(rows).toHaveLength(1)
      expect(rows[0]!.saveCount).toBe(3)
    })

    it('keeps the pre-session state, not the latest', async () => {
      // The row must describe the boundary. If it tracked the newest save it
      // would duplicate the live row and be useless for undo — and it would
      // rewrite the toasted column on every autosave.
      await save('<p>First edit.</p>')
      await save('<p>Second edit.</p>')

      const rows = await revisions()
      expect(rows).toHaveLength(1)
      expect((rows[0]!.snapshot as any).body).toContain('lunged at the succubus')
      expect((rows[0]!.snapshot as any).body).not.toContain('Second edit')
    })

    it('tracks the version span the row covers', async () => {
      await save('<p>One.</p>')
      await save('<p>Two.</p>')

      const [row] = await revisions()
      expect(row!.entityVersion).toBe(1)
      // Two saves past the snapshot's version.
      expect(row!.entityVersionEnd).toBe(3)
    })

    it('opens a new row once the window rolls over', async () => {
      await save('<p>Session one.</p>')
      await new Promise(r => setTimeout(r, WINDOW_MS + 250))
      await save('<p>Session two.</p>')

      const rows = await revisions()
      expect(rows).toHaveLength(2)
      // Row 1 = pre-session-one state; row 2 = end of session one.
      expect((rows[0]!.snapshot as any).body).toContain('succubus')
      expect((rows[1]!.snapshot as any).body).toContain('Session one')
    })

    it('records the first-ever edit, so no session is unrecoverable', async () => {
      await save('<p>The very first change.</p>')
      const rows = await revisions()
      expect(rows).toHaveLength(1)
      expect((rows[0]!.snapshot as any).body).toContain('succubus')
    })

    it('does not fan out under concurrent saves', async () => {
      // Only one of these wins the optimistic-lock CAS, but both reach the
      // capture path in principle; the partial unique index is what keeps this
      // to a single row rather than a check-then-act race.
      await Promise.all([
        save('<p>Racer A.</p>'),
        save('<p>Racer B.</p>'),
        save('<p>Racer C.</p>'),
      ])

      const rows = await revisions()
      expect(rows).toHaveLength(1)
    })
  })

  describe('what does and does not earn a restore point', () => {
    it('ignores saves that touch no restorable field', async () => {
      await app.inject({
        method: 'PUT',
        url: `/api/entities/${chapterId}`,
        headers: auth(),
        payload: { projectId, collection: 'content', data: { order: 99 } },
      })
      expect(await revisions()).toHaveLength(0)
    })

    it('captures a notes-only edit', async () => {
      await app.inject({
        method: 'PUT',
        url: `/api/entities/${chapterId}`,
        headers: auth(),
        payload: { projectId, collection: 'content', data: { notes: 'remember the kiss' } },
      })
      expect(await revisions()).toHaveLength(1)
    })

    it('ignores a no-op re-save', async () => {
      await save('<p>Garron drew his blade and lunged at the succubus.</p>')
      expect(await revisions()).toHaveLength(0)
    })
  })

  describe('manual checkpoints', () => {
    it('always inserts and never joins a session bucket', async () => {
      await save('<p>Working.</p>')
      const res = await app.inject({
        method: 'POST',
        url: `/api/entities/${chapterId}/revisions`,
        headers: auth(),
        payload: { note: 'before the big rewrite' },
      })
      expect(res.statusCode).toBe(201)

      const rows = await revisions()
      expect(rows).toHaveLength(2)
      const manual = rows.find(r => r.label === 'manual')!
      expect(manual.sessionBucket).toBeNull()
      expect(manual.labelNote).toBe('before the big rewrite')

      // A second checkpoint in the same window must also insert.
      await app.inject({
        method: 'POST', url: `/api/entities/${chapterId}/revisions`, headers: auth(), payload: {},
      })
      expect((await revisions()).filter(r => r.label === 'manual')).toHaveLength(2)
    })
  })

  describe('listing', () => {
    it('returns metadata without shipping snapshot bodies', async () => {
      await save('<p>Something new.</p>')
      const res = await app.inject({
        method: 'GET', url: `/api/entities/${chapterId}/revisions`, headers: auth(),
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().revisions).toHaveLength(1)
      // The list is the one place a hundred full chapter bodies could sneak out.
      expect(res.payload).not.toContain('succubus')
    })

    it('404s for another user', async () => {
      const other = await createTestUser({ name: 'Nosy' })
      const otherToken = await createTestToken(other.id)
      const res = await app.inject({
        method: 'GET',
        url: `/api/entities/${chapterId}/revisions`,
        headers: { authorization: `Bearer ${otherToken}` },
      })
      expect([403, 404]).toContain(res.statusCode)
    })
  })

  describe('restore', () => {
    async function firstRevisionId(): Promise<string> {
      const rows = await revisions()
      return rows[0]!.id
    }

    it('puts the old text back and moves the version forward', async () => {
      await save('<p>Garron leaned in and kissed the succubus.</p>')
      const revId = await firstRevisionId()

      const [before] = await db.select().from(entities).where(eq(entities.id, chapterId))

      const res = await app.inject({
        method: 'POST',
        url: `/api/entities/${chapterId}/revisions/${revId}/restore`,
        headers: auth(),
        payload: {},
      })
      expect(res.statusCode).toBe(200)

      expect(await liveBody()).toContain('lunged at the succubus')

      // Forward, never rewound — an open editor must 409 and resync rather than
      // clobber the restore with its pending autosave.
      const body = res.json()
      expect(body._meta.version).toBe(before!.version + 1)
    })

    it('recomputes word_count rather than trusting the snapshot', async () => {
      await save('<p>Short.</p>')
      const revId = await firstRevisionId()

      // Poison the stored count. A snapshot can predate a tokenizer change, so
      // restoring must recount the body rather than copy a number forward.
      const [rev] = await db.select().from(entityRevisions).where(eq(entityRevisions.id, revId))
      await db.update(entityRevisions)
        .set({ snapshot: { ...(rev!.snapshot as any), word_count: 9999 } })
        .where(eq(entityRevisions.id, revId))

      await app.inject({
        method: 'POST', url: `/api/entities/${chapterId}/revisions/${revId}/restore`,
        headers: auth(), payload: {},
      })

      const [row] = await db.select().from(entities).where(eq(entities.id, chapterId))
      // "Garron drew his blade and lunged at the succubus." — nine words.
      expect((row!.entityData as any).word_count).toBe(9)
    })

    it('does not revert structural fields', async () => {
      // Reverting text must not also move the chapter back to its old position.
      await save('<p>New text.</p>', {})
      await app.inject({
        method: 'PUT', url: `/api/entities/${chapterId}`, headers: auth(),
        payload: { projectId, collection: 'content', data: { order: 42 } },
      })

      const revId = await firstRevisionId()
      await app.inject({
        method: 'POST', url: `/api/entities/${chapterId}/revisions/${revId}/restore`,
        headers: auth(), payload: {},
      })

      const [row] = await db.select().from(entities).where(eq(entities.id, chapterId))
      expect((row!.entityData as any).order).toBe(42)
      expect((row!.entityData as any).body).toContain('lunged')
    })

    it('checkpoints the current state so the restore is itself undoable', async () => {
      await save('<p>Garron leaned in and kissed the succubus.</p>')
      const revId = await firstRevisionId()

      await app.inject({
        method: 'POST', url: `/api/entities/${chapterId}/revisions/${revId}/restore`,
        headers: auth(), payload: {},
      })

      const pre = (await revisions()).find(r => r.label === 'pre_restore')
      expect(pre).toBeDefined()
      expect((pre!.snapshot as any).body).toContain('kissed the succubus')

      // ...and restoring that undoes the restore.
      await app.inject({
        method: 'POST', url: `/api/entities/${chapterId}/revisions/${pre!.id}/restore`,
        headers: auth(), payload: {},
      })
      expect(await liveBody()).toContain('kissed the succubus')
    })

    it('409s on a stale expectedVersion', async () => {
      await save('<p>Changed.</p>')
      const revId = await firstRevisionId()
      const res = await app.inject({
        method: 'POST', url: `/api/entities/${chapterId}/revisions/${revId}/restore`,
        headers: auth(), payload: { expectedVersion: 1 },
      })
      expect(res.statusCode).toBe(409)
    })

    it('reports a pruned restore point distinguishably', async () => {
      await save('<p>Changed.</p>')
      const revId = await firstRevisionId()
      await db.delete(entityRevisions).where(eq(entityRevisions.id, revId))

      const res = await app.inject({
        method: 'POST', url: `/api/entities/${chapterId}/revisions/${revId}/restore`,
        headers: auth(), payload: {},
      })
      expect(res.statusCode).toBe(404)
      expect(res.json().code).toBe('REVISION_PRUNED')
    })

    it('emits a change-feed event', async () => {
      await save('<p>Garron leaned in and kissed the succubus.</p>')
      const revId = await firstRevisionId()
      await app.inject({
        method: 'POST', url: `/api/entities/${chapterId}/revisions/${revId}/restore`,
        headers: auth(), payload: {},
      })

      const feed = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/changes?since=0&coalesce=false`,
        headers: auth(),
      })
      const events = feed.json().events.filter((e: any) => e.entityId === chapterId)
      expect(events.at(-1).fieldsChanged).toContain('body')
    })
  })

  describe('lifecycle', () => {
    it('purging an entity takes its revisions with it', async () => {
      await save('<p>Doomed.</p>')
      expect((await revisions()).length).toBeGreaterThan(0)

      await app.inject({
        method: 'POST', url: '/api/entities/bulk-delete', headers: auth(),
        payload: { projectId, ids: [chapterId] },
      })
      // Trashed, not purged — revisions must survive the window.
      expect((await revisions()).length).toBeGreaterThan(0)

      await app.inject({
        method: 'POST', url: '/api/entities/bulk-delete-permanent', headers: auth(),
        payload: { projectId, ids: [chapterId] },
      })
      expect(await revisions()).toHaveLength(0)
    })
  })
})
