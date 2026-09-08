import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { db } from '../../db/connection'
import { entities, bobbinsInstalled, comments, reactions, chapterAnnotations } from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData
} from '../../__tests__/test-helpers'

/**
 * Project tags + dashboard aggregate API. Covers apps/api/src/routes/project-tags.ts:
 * content-tag CRUD, and the dashboard aggregate endpoint (chapters, analytics,
 * publish config, and the installed-bobbins projection built from disk manifests).
 */
describe('Project Tags & Dashboard API', () => {
  let app: any

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    await cleanupAllTestData()
  })

  function inject(method: string, url: string, token?: string, payload?: unknown) {
    return app.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload
    })
  }

  async function verifiedUser() {
    const user = await createTestUser()
    return { user, token: await createTestToken(user.id) }
  }

  async function createEntity(projectId: string, overrides: {
    bobbinId?: string
    collectionName?: string
    contentType?: string | null
    entityData?: Record<string, unknown>
    archivedAt?: Date | null
    deletedAt?: Date | null
  } = {}) {
    const [entity] = await db.insert(entities).values({
      projectId,
      bobbinId: overrides.bobbinId ?? 'manuscript',
      collectionName: overrides.collectionName ?? 'content',
      contentType: overrides.contentType === undefined ? 'chapter' : overrides.contentType,
      entityData: overrides.entityData ?? { title: 'Untitled' },
      archivedAt: overrides.archivedAt ?? null,
      deletedAt: overrides.deletedAt ?? null
    }).returning()
    return entity!
  }

  async function installBobbin(projectId: string, bobbinId: string) {
    const [row] = await db.insert(bobbinsInstalled).values({
      projectId,
      bobbinId,
      version: '1.0.0',
      manifestJson: { id: bobbinId }
    }).returning()
    return row!
  }

  // ============================================
  // AUTH: 401 without token, 403 for non-owner
  // ============================================

  describe('authentication and ownership', () => {
    it('returns 401 without a token on every route', async () => {
      const { user } = await verifiedUser()
      const project = await createTestProject(user.id)

      expect((await inject('GET', `/api/projects/${project.id}/tags`)).statusCode).toBe(401)
      expect((await inject('POST', `/api/projects/${project.id}/tags`, undefined, { tagCategory: 'genre', tagName: 'Fantasy' })).statusCode).toBe(401)
      expect((await inject('DELETE', `/api/projects/${project.id}/tags/00000000-0000-0000-0000-000000000000`)).statusCode).toBe(401)
      expect((await inject('GET', `/api/projects/${project.id}/dashboard`)).statusCode).toBe(401)
    })

    it('returns the exact 403 refusal for a non-owner on every route', async () => {
      const { user: owner } = await verifiedUser()
      const project = await createTestProject(owner.id)
      const { token: strangerToken } = await verifiedUser()

      const expected403 = {
        error: 'Forbidden',
        message: 'You do not have permission to access this project'
      }

      const getTags = await inject('GET', `/api/projects/${project.id}/tags`, strangerToken)
      expect(getTags.statusCode).toBe(403)
      expect(JSON.parse(getTags.payload)).toEqual(expected403)

      const postTag = await inject('POST', `/api/projects/${project.id}/tags`, strangerToken, { tagCategory: 'genre', tagName: 'Fantasy' })
      expect(postTag.statusCode).toBe(403)
      expect(JSON.parse(postTag.payload)).toEqual(expected403)

      const delTag = await inject('DELETE', `/api/projects/${project.id}/tags/00000000-0000-0000-0000-000000000000`, strangerToken)
      expect(delTag.statusCode).toBe(403)
      expect(JSON.parse(delTag.payload)).toEqual(expected403)

      const dash = await inject('GET', `/api/projects/${project.id}/dashboard`, strangerToken)
      expect(dash.statusCode).toBe(403)
      expect(JSON.parse(dash.payload)).toEqual(expected403)
    })

    it('returns 400 for a malformed projectId and 404 for a well-formed unknown one', async () => {
      const { token } = await verifiedUser()

      const malformed = await inject('GET', '/api/projects/not-a-uuid/tags', token)
      expect(malformed.statusCode).toBe(400)
      expect(JSON.parse(malformed.payload)).toEqual({ error: 'Invalid project ID format' })

      const unknownId = '00000000-0000-0000-0000-000000000000'
      const unknown = await inject('GET', `/api/projects/${unknownId}/tags`, token)
      expect(unknown.statusCode).toBe(404)
      expect(JSON.parse(unknown.payload)).toEqual({ error: 'Project not found' })

      const dashMalformed = await inject('GET', '/api/projects/not-a-uuid/dashboard', token)
      expect(dashMalformed.statusCode).toBe(400)

      const dashUnknown = await inject('GET', `/api/projects/${unknownId}/dashboard`, token)
      expect(dashUnknown.statusCode).toBe(404)
    })
  })

  // ============================================
  // TAG CRUD
  // ============================================

  describe('tag CRUD', () => {
    it('adds, lists, and removes a tag', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)

      const addRes = await inject('POST', `/api/projects/${project.id}/tags`, token, {
        tagCategory: 'genre',
        tagName: 'Fantasy'
      })
      expect(addRes.statusCode).toBe(201)
      const added = JSON.parse(addRes.payload)
      expect(added.tag).toMatchObject({ tagCategory: 'genre', tagName: 'Fantasy', projectId: project.id })

      const listRes = await inject('GET', `/api/projects/${project.id}/tags`, token)
      expect(listRes.statusCode).toBe(200)
      const listed = JSON.parse(listRes.payload)
      expect(listed.tags).toEqual([
        { id: added.tag.id, tagCategory: 'genre', tagName: 'Fantasy', createdAt: expect.any(String) }
      ])

      const delRes = await inject('DELETE', `/api/projects/${project.id}/tags/${added.tag.id}`, token)
      expect(delRes.statusCode).toBe(200)
      expect(JSON.parse(delRes.payload)).toMatchObject({ success: true })

      const listAfterDelete = await inject('GET', `/api/projects/${project.id}/tags`, token)
      expect(JSON.parse(listAfterDelete.payload).tags).toEqual([])
    })

    it('trims the tag name before storing', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)

      const res = await inject('POST', `/api/projects/${project.id}/tags`, token, {
        tagCategory: 'theme',
        tagName: '  Redemption  '
      })
      expect(res.statusCode).toBe(201)
      expect(JSON.parse(res.payload).tag.tagName).toBe('Redemption')
    })

    it('rejects an invalid tag category with 400', async () => {
      const { token, user } = await verifiedUser()
      const project = await createTestProject(user.id)

      const res = await inject('POST', `/api/projects/${project.id}/tags`, token, {
        tagCategory: 'not-a-category',
        tagName: 'Fantasy'
      })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toMatch(/Invalid tag category/)
    })

    it('rejects an empty tag name with 400', async () => {
      const { token, user } = await verifiedUser()
      const project = await createTestProject(user.id)

      const res = await inject('POST', `/api/projects/${project.id}/tags`, token, {
        tagCategory: 'genre',
        tagName: ''
      })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Tag name is required', correlationId: expect.any(String) })
    })

    it('rejects a whitespace-only tag name with 400', async () => {
      const { token, user } = await verifiedUser()
      const project = await createTestProject(user.id)

      const res = await inject('POST', `/api/projects/${project.id}/tags`, token, {
        tagCategory: 'genre',
        tagName: '    '
      })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('Tag name is required')
    })

    it('rejects a duplicate tag (same project/category/name) with 409', async () => {
      const { token, user } = await verifiedUser()
      const project = await createTestProject(user.id)

      await inject('POST', `/api/projects/${project.id}/tags`, token, { tagCategory: 'genre', tagName: 'Fantasy' })
      const dupRes = await inject('POST', `/api/projects/${project.id}/tags`, token, { tagCategory: 'genre', tagName: 'Fantasy' })
      expect(dupRes.statusCode).toBe(409)
      expect(JSON.parse(dupRes.payload).error).toBe('Tag already exists for this project')

      // Same name under a different category is not a duplicate.
      const diffCategoryRes = await inject('POST', `/api/projects/${project.id}/tags`, token, { tagCategory: 'theme', tagName: 'Fantasy' })
      expect(diffCategoryRes.statusCode).toBe(201)
    })

    it('rejects a tag name longer than the column allows with a 400, and accepts one at the limit', async () => {
      const { token, user } = await verifiedUser()
      const project = await createTestProject(user.id)

      const tooLong = await inject('POST', `/api/projects/${project.id}/tags`, token, {
        tagCategory: 'genre',
        tagName: 'x'.repeat(101)
      })
      expect(tooLong.statusCode).toBe(400)
      expect(JSON.parse(tooLong.payload).error).toBe('Tag name must be 100 characters or fewer')

      const atLimit = await inject('POST', `/api/projects/${project.id}/tags`, token, {
        tagCategory: 'genre',
        tagName: 'x'.repeat(100)
      })
      expect(atLimit.statusCode).toBe(201)
    })

    it('a tag on one project never appears on another, even for the same owner', async () => {
      const { token, user } = await verifiedUser()
      const projectA = await createTestProject(user.id, { name: 'Project A' })
      const projectB = await createTestProject(user.id, { name: 'Project B' })

      await inject('POST', `/api/projects/${projectA.id}/tags`, token, { tagCategory: 'genre', tagName: 'Fantasy' })

      const listB = await inject('GET', `/api/projects/${projectB.id}/tags`, token)
      expect(JSON.parse(listB.payload).tags).toEqual([])
    })

    it('returns 404 deleting a tag that does not exist', async () => {
      const { token, user } = await verifiedUser()
      const project = await createTestProject(user.id)

      const res = await inject('DELETE', `/api/projects/${project.id}/tags/00000000-0000-0000-0000-000000000000`, token)
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload).error).toBe('Tag not found')
    })

    it('returns 404 deleting a real tag through the wrong project', async () => {
      const { token, user } = await verifiedUser()
      const projectA = await createTestProject(user.id, { name: 'Project A' })
      const projectB = await createTestProject(user.id, { name: 'Project B' })

      const addRes = await inject('POST', `/api/projects/${projectA.id}/tags`, token, { tagCategory: 'genre', tagName: 'Fantasy' })
      const tagId = JSON.parse(addRes.payload).tag.id

      // Same owner, but the tag belongs to project A — deleting it by ID
      // through project B's URL must not match (id + projectId are ANDed).
      const res = await inject('DELETE', `/api/projects/${projectB.id}/tags/${tagId}`, token)
      expect(res.statusCode).toBe(404)

      // It's still there on project A.
      const listA = await inject('GET', `/api/projects/${projectA.id}/tags`, token)
      expect(JSON.parse(listA.payload).tags).toHaveLength(1)
    })
  })

  // ============================================
  // DASHBOARD: installed-bobbins projection
  // ============================================

  describe('dashboard bobbins projection', () => {
    it('reflects hasLeftPanel, core, and annotationInbox from each bobbin\'s disk manifest', async () => {
      const { token, user } = await verifiedUser()
      const project = await createTestProject(user.id)

      await installBobbin(project.id, 'manuscript')
      await installBobbin(project.id, 'feedback')

      const res = await inject('GET', `/api/projects/${project.id}/dashboard`, token)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)

      const byId = Object.fromEntries(body.bobbins.map((b: any) => [b.bobbinId, b]))

      // manuscript/manifest.yaml: core: true, a shell.leftPanel contribution,
      // and no capabilities.annotationInbox.
      expect(byId.manuscript.manifest).toMatchObject({
        name: 'Manuscript',
        hasLeftPanel: true,
        core: true,
        annotationInbox: false
      })

      // feedback/manifest.yaml: no `core` field, a shell.rightPanel
      // contribution (not leftPanel), and capabilities.annotationInbox: true.
      expect(byId.feedback.manifest).toMatchObject({
        name: 'Reader Feedback',
        hasLeftPanel: false,
        core: false,
        annotationInbox: true
      })
    })

    it('degrades gracefully instead of throwing when an installed bobbin has no manifest on disk', async () => {
      const { token, user } = await verifiedUser()
      const project = await createTestProject(user.id)

      await installBobbin(project.id, 'ghost-bobbin')

      const res = await inject('GET', `/api/projects/${project.id}/dashboard`, token)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)

      const ghost = body.bobbins.find((b: any) => b.bobbinId === 'ghost-bobbin')
      expect(ghost).toBeDefined()
      // Falls back to the bobbinId as the name, and every manifest-derived
      // flag defaults to false rather than throwing.
      expect(ghost.manifest).toEqual({
        name: 'ghost-bobbin',
        description: '',
        icon: undefined,
        hasLeftPanel: false,
        core: false,
        annotationInbox: false
      })
    })
  })

  // ============================================
  // DASHBOARD: chapter / word-count aggregates
  // ============================================

  describe('dashboard chapter and word-count aggregates', () => {
    it('counts chapters, words, archived, and trashed precisely from seeded data', async () => {
      const { token, user } = await verifiedUser()
      const project = await createTestProject(user.id)

      // 2 live chapters (counted), 1 archived chapter (excluded from
      // narrativeWordCount, counted in archivedCount), 1 trashed chapter
      // (excluded entirely from the default view, counted in trashedCount),
      // and 1 live 'outline' contentType (live, but does not count toward
      // narrativeWordCount).
      await createEntity(project.id, { entityData: { title: 'Ch 1', order: 1, word_count: 1000 } })
      await createEntity(project.id, { entityData: { title: 'Ch 2', order: 2, word_count: 500 } })
      await createEntity(project.id, {
        entityData: { title: 'Archived Ch', order: 3, word_count: 999 },
        archivedAt: new Date()
      })
      await createEntity(project.id, {
        entityData: { title: 'Trashed Ch', order: 4, word_count: 777 },
        deletedAt: new Date()
      })
      await createEntity(project.id, {
        contentType: 'outline',
        entityData: { title: 'Outline', order: 5, word_count: 200 }
      })
      // Non-'content' collection entity must not appear in chapters at all.
      await createEntity(project.id, { collectionName: 'entity_type_definitions', contentType: null })

      const res = await inject('GET', `/api/projects/${project.id}/dashboard`, token)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)

      // Default view: live, non-archived chapters only.
      expect(body.chapters).toHaveLength(3)
      expect(body.chapters.map((c: any) => c.title).sort()).toEqual(['Ch 1', 'Ch 2', 'Outline'])

      expect(body.analytics.archivedCount).toBe(1)
      expect(body.analytics.trashedCount).toBe(1)
      // 1000 + 500 narrative words; the outline's 200 words don't count
      // (outline isn't a NARRATIVE_TYPE) and the archived chapter is excluded.
      expect(body.analytics.narrativeWordCount).toBe(1500)

      // includeArchived=all shows everything live (4: the 2 chapters, the
      // archived one, and the outline) but never the trashed one.
      const allRes = await inject('GET', `/api/projects/${project.id}/dashboard?includeArchived=all`, token)
      const allBody = JSON.parse(allRes.payload)
      expect(allBody.chapters).toHaveLength(4)

      // includeArchived=archived-only shows just the archived chapter.
      const archivedOnlyRes = await inject('GET', `/api/projects/${project.id}/dashboard?includeArchived=archived-only`, token)
      const archivedOnlyBody = JSON.parse(archivedOnlyRes.payload)
      expect(archivedOnlyBody.chapters).toHaveLength(1)
      expect(archivedOnlyBody.chapters[0].title).toBe('Archived Ch')

      // includeDeleted=deleted-only shows just the trashed chapter.
      const deletedOnlyRes = await inject('GET', `/api/projects/${project.id}/dashboard?includeDeleted=deleted-only`, token)
      const deletedOnlyBody = JSON.parse(deletedOnlyRes.payload)
      expect(deletedOnlyBody.chapters).toHaveLength(1)
      expect(deletedOnlyBody.chapters[0].title).toBe('Trashed Ch')
    })

    it('excludes another project\'s chapters entirely', async () => {
      const { token, user } = await verifiedUser()
      const project = await createTestProject(user.id, { name: 'Mine' })
      const otherProject = await createTestProject(user.id, { name: 'Other' })

      await createEntity(project.id, { entityData: { title: 'Mine Ch', order: 1, word_count: 10 } })
      await createEntity(otherProject.id, { entityData: { title: 'Other Ch', order: 1, word_count: 9999 } })

      const res = await inject('GET', `/api/projects/${project.id}/dashboard`, token)
      const body = JSON.parse(res.payload)
      expect(body.chapters).toHaveLength(1)
      expect(body.chapters[0].title).toBe('Mine Ch')
      expect(body.analytics.narrativeWordCount).toBe(10)
    })
  })

  // ============================================
  // DASHBOARD: comment / reaction / annotation counts
  // ============================================

  describe('dashboard comment, reaction, and annotation counts', () => {
    it('attaches per-chapter comment/reaction/annotation counts and project-wide annotation status totals', async () => {
      const { token, user } = await verifiedUser()
      const project = await createTestProject(user.id)
      const reader = await createTestUser()

      const chapter = await createEntity(project.id, { entityData: { title: 'Ch 1', order: 1 } })

      await db.insert(comments).values([
        { chapterId: chapter.id, authorId: reader.id, content: 'Nice!', moderationStatus: 'approved' },
        { chapterId: chapter.id, authorId: reader.id, content: 'Pending', moderationStatus: 'pending' }
      ])
      await db.insert(reactions).values([
        { chapterId: chapter.id, userId: reader.id, reactionType: 'heart' }
      ])
      await db.insert(chapterAnnotations).values([
        {
          chapterId: chapter.id, projectId: project.id, authorId: reader.id,
          anchorQuote: 'quote one', annotationType: 'feedback', status: 'open', chapterVersion: 1,
          content: 'note one'
        },
        {
          chapterId: chapter.id, projectId: project.id, authorId: reader.id,
          anchorQuote: 'quote two', annotationType: 'feedback', status: 'resolved', chapterVersion: 1,
          content: 'note two'
        }
      ])

      const res = await inject('GET', `/api/projects/${project.id}/dashboard`, token)
      const body = JSON.parse(res.payload)
      const ch = body.chapters.find((c: any) => c.id === chapter.id)

      // Only the approved comment counts.
      expect(ch.commentCount).toBe(1)
      expect(ch.reactionCount).toBe(1)
      // Only 'open'/'acknowledged' annotations count per-chapter.
      expect(ch.annotationCount).toBe(1)

      expect(body.annotationStats).toEqual({ open: 1, acknowledged: 0, resolved: 1, dismissed: 0, total: 2 })
    })
  })

  // ============================================
  // DASHBOARD: bobbinStats (per-bobbin entity counts)
  // ============================================

  describe('dashboard bobbinStats', () => {
    it('counts entities per bobbin, excluding schema/template rows and trashed rows', async () => {
      const { token, user } = await verifiedUser()
      const project = await createTestProject(user.id)

      await createEntity(project.id, { bobbinId: 'entities', collectionName: 'characters', contentType: null, entityData: { name: 'Alice' } })
      await createEntity(project.id, { bobbinId: 'entities', collectionName: 'characters', contentType: null, entityData: { name: 'Bob' } })
      // Excluded: schema/template rows for the same bobbin.
      await createEntity(project.id, { bobbinId: 'entities', collectionName: 'entity_type_definitions', contentType: null, entityData: {} })
      await createEntity(project.id, { bobbinId: 'entities', collectionName: 'shared_templates', contentType: null, entityData: {} })
      // Excluded: trashed row for the same bobbin.
      await createEntity(project.id, { bobbinId: 'entities', collectionName: 'characters', contentType: null, entityData: { name: 'Trashed' }, deletedAt: new Date() })

      const res = await inject('GET', `/api/projects/${project.id}/dashboard`, token)
      const body = JSON.parse(res.payload)
      expect(body.bobbinStats.entities).toBe(2)
    })
  })

  // ============================================
  // DASHBOARD: publish config default and project shape
  // ============================================

  describe('dashboard project and publish config shape', () => {
    it('returns default publish config when none exists, and the expected project fields', async () => {
      const { token, user } = await verifiedUser()
      const project = await createTestProject(user.id, { name: 'Shape Test', description: 'A test project' })

      const res = await inject('GET', `/api/projects/${project.id}/dashboard`, token)
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)

      expect(body.project).toMatchObject({
        id: project.id,
        name: 'Shape Test',
        description: 'A test project',
        isArchived: false
      })
      expect(body.publishConfig).toMatchObject({
        projectId: project.id,
        publishingMode: 'draft',
        defaultVisibility: 'public',
        autoReleaseEnabled: false,
        releaseFrequency: 'manual',
        enableComments: true,
        enableReactions: true,
        moderationMode: 'open'
      })
      expect(body.tags).toEqual([])
      expect(body.chapters).toEqual([])
      expect(body.scheduledReleases).toEqual([])
      expect(body.bobbins).toEqual([])
      expect(body.bobbinStats).toEqual({})
    })
  })
})
