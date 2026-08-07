/**
 * End-to-end: the change feed tells a bot a chapter was revised, and the diff
 * endpoint tells it what the revision actually was.
 *
 * This is the flow the daily-sync bot runs:
 *   1. GET /projects/:id/changes  — one call, coalesced. Churn + revisionIdFirst.
 *   2. classify: both counts large and delta ~0 → revision pass.
 *   3. GET /entities/:id/diff?from=<revisionIdFirst>&to=live → the prose.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import { db } from '../../db/connection'
import { eq } from 'drizzle-orm'
import { bobbinsInstalled, entities } from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../test-helpers'

describe('Change feed → diff', () => {
  let app: any
  let userId: string
  let projectId: string
  let token: string
  let chapterId: string

  const auth = () => ({ authorization: `Bearer ${token}` })

  const save = (body: string) => app.inject({
    method: 'PUT',
    url: `/api/entities/${chapterId}`,
    headers: auth(),
    payload: { projectId, collection: 'content', data: { body } },
  })

  const coalesced = async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/changes?since=0&collection=content`,
      headers: auth(),
    })
    return res.json().changes.find((c: any) => c.entityId === chapterId)
  }

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await cleanupAllTestData()
    const user = await createTestUser({ name: 'Feed Tester' })
    userId = user.id
    token = await createTestToken(userId)
    const project = await createTestProject(userId, { name: 'Feed Project' })
    projectId = project.id

    await db.insert(bobbinsInstalled).values({
      projectId, bobbinId: 'manuscript', version: '1.0.0',
      manifestJson: { id: 'manuscript', name: 'Manuscript', version: '1.0.0' },
    })

    const [chapter] = await db.insert(entities).values({
      projectId, bobbinId: 'manuscript', collectionName: 'content', contentType: 'chapter',
      entityData: {
        title: 'The Succubus',
        body: '<p>Garron drew his blade and lunged at the succubus.</p><p>She laughed at him.</p>',
        word_count: 13,
        order: 1,
      },
    }).returning()
    chapterId = chapter!.id
  })

  it('reports churn on a revision pass, not just a net delta', async () => {
    await save('<p>Garron leaned in and kissed the succubus.</p><p>She laughed at him.</p>')

    const change = await coalesced()
    expect(change.wordsAdded).toBeGreaterThan(0)
    expect(change.wordsRemoved).toBeGreaterThan(0)
    // Net barely moved — churn is the only signal that anything happened.
    expect(Math.abs(change.wordCountDelta)).toBeLessThan(5)
    expect(change.wordsAdded - change.wordsRemoved).toBe(change.wordCountDelta)
  })

  it('reports new writing as additions with little removal', async () => {
    await save(
      '<p>Garron drew his blade and lunged at the succubus.</p><p>She laughed at him.</p>' +
      '<p>The tower shook. Dust fell from the rafters in long grey ribbons.</p>'
    )
    const change = await coalesced()
    expect(change.wordsAdded).toBeGreaterThan(10)
    expect(change.wordsRemoved).toBe(0)
  })

  it('holds the delta invariant even when the stored word_count has drifted', async () => {
    // Consumers rely on wordsAdded - wordsRemoved === wordCountDelta. Reading
    // the "before" count from the stored word_count would break that whenever
    // it disagreed with the body — an imported row, a direct DB write, or
    // anything predating the tokenizer unification. Both sides come from the
    // same tokenizer pass instead.
    await db.update(entities)
      .set({ entityData: { ...(await db.select().from(entities).where(eq(entities.id, chapterId)))[0]!.entityData as any, word_count: 9999 } })
      .where(eq(entities.id, chapterId))

    await save('<p>Garron leaned in and kissed the succubus.</p><p>She laughed at him.</p>')

    const change = await coalesced()
    expect(change.wordsAdded - change.wordsRemoved).toBe(change.wordCountDelta)
  })

  it('emits nulls, not zeroes, when no delta was computed', async () => {
    // A metadata-only save must be distinguishable from "wrote nothing".
    await app.inject({
      method: 'PUT', url: `/api/entities/${chapterId}`, headers: auth(),
      payload: { projectId, collection: 'content', data: { order: 5 } },
    })
    const change = await coalesced()
    expect(change.wordsAdded).toBeNull()
    expect(change.wordsRemoved).toBeNull()
  })

  it('hands back the prose that changed', async () => {
    await save('<p>Garron leaned in and kissed the succubus.</p><p>She laughed at him.</p>')

    const change = await coalesced()
    expect(change.revisionIdFirst).toBeTruthy()

    const res = await app.inject({
      method: 'GET',
      url: `/api/entities/${chapterId}/diff?from=${change.revisionIdFirst}&to=live`,
      headers: auth(),
    })
    expect(res.statusCode).toBe(200)

    const diff = res.json()
    const replace = diff.hunks.find((h: any) => h.type === 'replace')
    expect(replace).toBeDefined()
    // The whole point of the feature: not "±2 words" but what actually happened.
    expect(replace.before).toContain('lunged at the succubus')
    expect(replace.after).toContain('kissed the succubus')
    // The untouched paragraph stays out of it.
    expect(JSON.stringify(diff.hunks)).not.toContain('She laughed')
  })

  it('spans a whole polling window, not just the last save', async () => {
    // Three saves inside one session collapse onto one revision, so the diff
    // from revisionIdFirst must show the net change across all of them.
    await save('<p>Garron hesitated.</p><p>She laughed at him.</p>')
    await save('<p>Garron hesitated, then smiled.</p><p>She laughed at him.</p>')
    await save('<p>Garron leaned in and kissed the succubus.</p><p>She laughed at him.</p>')

    const change = await coalesced()
    expect(change.eventCount).toBe(3)

    const res = await app.inject({
      method: 'GET',
      url: `/api/entities/${chapterId}/diff?from=${change.revisionIdFirst}&to=live`,
      headers: auth(),
    })
    const replace = res.json().hunks.find((h: any) => h.type === 'replace')
    // Compared against the state before the *window*, not before the last save.
    expect(replace.before).toContain('lunged at the succubus')
    expect(replace.after).toContain('kissed the succubus')
  })

  it('marks a restore so it is not mistaken for a big paste', async () => {
    await save('<p>Garron leaned in and kissed the succubus.</p><p>She laughed at him.</p>')
    const change = await coalesced()

    const restore = await app.inject({
      method: 'POST',
      url: `/api/entities/${chapterId}/revisions/${change.revisionIdFirst}/restore`,
      headers: auth(),
      payload: {},
    })
    expect(restore.statusCode).toBe(200)

    const after = await coalesced()
    expect(after.sources).toContain('restore')
  })

  it('404s a diff whose restore point has been pruned', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/entities/${chapterId}/diff?from=00000000-0000-4000-8000-000000000000&to=live`,
      headers: auth(),
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('REVISION_PRUNED')
  })
})
