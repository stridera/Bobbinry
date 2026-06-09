/**
 * Search & Replace Integration Tests
 *
 * Exercises POST /api/projects/:projectId/search-replace/preview and
 * /apply through the real Fastify stack + Postgres.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import { eq } from 'drizzle-orm'
import { db } from '../../db/connection'
import { bobbinsInstalled, entities } from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../test-helpers'

type Match = {
  id: string
  entityId: string
  collection: string
  field: string
  index: number
  matchText: string
  contextBefore: string
  contextAfter: string
}

describe('Search & Replace', () => {
  let app: any
  let userId: string
  let projectId: string
  let token: string
  let chapterId: string
  let containerId: string
  let entityId: string

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await cleanupAllTestData()

    const user = await createTestUser({ name: 'Search Tester' })
    userId = user.id
    token = await createTestToken(userId)

    const project = await createTestProject(userId, { name: 'Search Project' })
    projectId = project.id

    // Install both bobbins so the search endpoints can find their rows.
    await db.insert(bobbinsInstalled).values([
      {
        projectId,
        bobbinId: 'manuscript',
        version: '1.0.0',
        manifestJson: { id: 'manuscript', name: 'Manuscript', version: '1.0.0' },
      },
      {
        projectId,
        bobbinId: 'entities',
        version: '1.0.0',
        manifestJson: { id: 'entities', name: 'Entities', version: '1.0.0' },
      },
    ])

    const [chapter] = await db.insert(entities).values({
      projectId,
      bobbinId: 'manuscript',
      collectionName: 'content',
      contentType: 'chapter',
      entityData: {
        title: 'Caelan returns',
        synopsis: 'A short note about Caelan.',
        body: '<p><strong>Caelan</strong> walked into the room.</p><p>The themes of Caelan&apos;s journey grew darker.</p>',
        word_count: 16,
      },
    }).returning()
    chapterId = chapter!.id

    const [container] = await db.insert(entities).values({
      projectId,
      bobbinId: 'manuscript',
      collectionName: 'containers',
      entityData: { title: 'Act 1: Caelan rises', order: 1 },
    }).returning()
    containerId = container!.id

    const [character] = await db.insert(entities).values({
      projectId,
      bobbinId: 'entities',
      collectionName: 'character',
      entityData: {
        name: 'Caelan',
        description: '<p>A wandering Caelan, last of his line.</p>',
      },
    }).returning()
    entityId = character!.id
  })

  it('previews matches across chapter, container, and entity', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/search-replace/preview`,
      headers: { authorization: `Bearer ${token}` },
      payload: { query: 'Caelan', caseSensitive: true, wholeWord: false, scope: { type: 'project' } },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload) as { matches: Match[]; entityVersions: Record<string, number> }

    const collectionsHit = new Set(body.matches.map(m => m.collection))
    expect(collectionsHit.has('content')).toBe(true)
    expect(collectionsHit.has('containers')).toBe(true)
    expect(collectionsHit.has('character')).toBe(true)

    // 'theme' inside 'themes' should not be confused with 'Caelan' — sanity check
    // that the engine isn't matching attribute strings or unrelated content.
    const allMatchTexts = body.matches.map(m => m.matchText)
    expect(allMatchTexts.every(t => t === 'Caelan')).toBe(true)

    // entityVersions present for every row with a match.
    expect(body.entityVersions[chapterId]).toBe(1)
    expect(body.entityVersions[containerId]).toBe(1)
    expect(body.entityVersions[entityId]).toBe(1)
  })

  it('whole-word avoids matching inside HTML attributes', async () => {
    // Seed an extra chapter where 'the' appears only inside a class= attribute
    // — so the only legitimate body-text 'the' is in "the bird".
    const [extra] = await db.insert(entities).values({
      projectId,
      bobbinId: 'manuscript',
      collectionName: 'content',
      contentType: 'chapter',
      entityData: {
        title: 'theme study',
        body: '<p class="theme">the bird flew</p>',
        word_count: 3,
      },
    }).returning()

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/search-replace/preview`,
      headers: { authorization: `Bearer ${token}` },
      payload: { query: 'the', caseSensitive: false, wholeWord: true, scope: { type: 'project' } },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload) as { matches: Match[] }
    // Scope assertion to the extra chapter so unrelated 'the/The' in the
    // seeded chapter body don't muddy the signal.
    const bodyMatches = body.matches.filter(m => m.entityId === extra!.id && m.field === 'body')
    expect(bodyMatches).toHaveLength(1)
    expect(bodyMatches[0]!.matchText.toLowerCase()).toBe('the')
    expect(bodyMatches[0]!.contextAfter).toBe(' bird flew')
  })

  it('scoped to a single chapter only returns matches for that chapter', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/search-replace/preview`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        query: 'Caelan',
        caseSensitive: true,
        wholeWord: false,
        scope: { type: 'chapter', chapterId },
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.payload) as { matches: Match[] }
    expect(body.matches.length).toBeGreaterThan(0)
    expect(body.matches.every(m => m.entityId === chapterId)).toBe(true)
  })

  it('applies replacements across all selected matches, refreshes word_count, bumps version', async () => {
    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/search-replace/preview`,
      headers: { authorization: `Bearer ${token}` },
      payload: { query: 'Caelan', caseSensitive: true, wholeWord: false, scope: { type: 'project' } },
    })
    const previewBody = JSON.parse(preview.payload) as { matches: Match[]; entityVersions: Record<string, number> }

    const applyRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/search-replace/apply`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        query: 'Caelan',
        caseSensitive: true,
        wholeWord: false,
        replacement: 'Cael',
        scope: { type: 'project' },
        selectedMatchIds: previewBody.matches.map(m => m.id),
        entityVersions: previewBody.entityVersions,
      },
    })
    expect(applyRes.statusCode).toBe(200)
    const applyBody = JSON.parse(applyRes.payload) as {
      applied: string[]
      stale: string[]
      notFound: string[]
    }
    expect(applyBody.stale).toEqual([])
    expect(applyBody.notFound).toEqual([])
    expect(new Set(applyBody.applied)).toEqual(new Set([chapterId, containerId, entityId]))

    // Verify DB state.
    const [chapter] = await db.select().from(entities).where(eq(entities.id, chapterId))
    const cdata = chapter!.entityData as Record<string, unknown>
    expect(cdata.title).toBe('Cael returns')
    expect((cdata.body as string).includes('Caelan')).toBe(false)
    expect((cdata.body as string).includes('<strong>Cael</strong>')).toBe(true)
    // Markup preserved around the replacement.
    expect((cdata.body as string).includes('<p>')).toBe(true)
    // word_count updated.
    expect(typeof cdata.word_count).toBe('number')
    expect(chapter!.version).toBe(2)

    const [container] = await db.select().from(entities).where(eq(entities.id, containerId))
    expect((container!.entityData as any).title).toBe('Act 1: Cael rises')

    const [character] = await db.select().from(entities).where(eq(entities.id, entityId))
    expect((character!.entityData as any).name).toBe('Cael')
    expect((character!.entityData as any).description).toContain('Cael')
    expect((character!.entityData as any).description).not.toContain('Caelan')
  })

  it('reports entities with stale versions and applies the rest', async () => {
    const preview = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/search-replace/preview`,
      headers: { authorization: `Bearer ${token}` },
      payload: { query: 'Caelan', caseSensitive: true, wholeWord: false, scope: { type: 'project' } },
    })
    const previewBody = JSON.parse(preview.payload) as { matches: Match[]; entityVersions: Record<string, number> }

    // Simulate someone else editing the chapter — bump its version directly.
    await db.update(entities)
      .set({ version: 99 })
      .where(eq(entities.id, chapterId))

    const applyRes = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/search-replace/apply`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        query: 'Caelan',
        caseSensitive: true,
        wholeWord: false,
        replacement: 'Cael',
        scope: { type: 'project' },
        selectedMatchIds: previewBody.matches.map(m => m.id),
        entityVersions: previewBody.entityVersions,
      },
    })
    expect(applyRes.statusCode).toBe(200)
    const applyBody = JSON.parse(applyRes.payload) as { applied: string[]; stale: string[] }
    expect(applyBody.stale).toContain(chapterId)
    expect(applyBody.applied).toContain(containerId)
    expect(applyBody.applied).toContain(entityId)

    // The chapter must not have been touched (still version 99, body intact).
    const [chapter] = await db.select().from(entities).where(eq(entities.id, chapterId))
    expect(chapter!.version).toBe(99)
    expect((chapter!.entityData as any).title).toBe('Caelan returns')
  })

  it('rejects requests from non-owner users', async () => {
    const otherUser = await createTestUser({ name: 'Outsider' })
    const otherToken = await createTestToken(otherUser.id)

    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/search-replace/preview`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { query: 'Caelan', caseSensitive: false, wholeWord: false, scope: { type: 'project' } },
    })
    expect(res.statusCode).toBe(403)
  })
})
