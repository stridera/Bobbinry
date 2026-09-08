import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals'
import { eq, and } from 'drizzle-orm'
import { db } from '../../db/connection'
import { users, entities, userBobbinsInstalled, provenanceEvents, entityChanges } from '../../db/schema'
import { decryptSecret } from '../../lib/secret-storage'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData,
} from '../../__tests__/test-helpers'

/**
 * AI Tools routes: config storage (encrypted API key), connection test,
 * synopsis generation + save, structured review generation + persisted
 * lastReview + save, name generation, brainstorming, and timeline flesh-out.
 *
 * Analysis only — never generation of manuscript content. The model call
 * itself (`callAnthropic`/`callOpenAI` in ai-tools.ts) hits `fetch` directly
 * with no wrapper module, so `global.fetch` is the mock boundary. No real
 * network call is ever made.
 *
 * The "provider key" here is not an env var — it's the user's own API key,
 * PUT to /ai-tools/config and stored AES-256-GCM-encrypted in
 * user_bobbins_installed.config. "Not configured" means no such row/key
 * exists for the caller, not an unset env var.
 */
describe('AI Tools routes', () => {
  let app: any
  let originalFetch: typeof global.fetch

  beforeAll(async () => {
    app = await createTestApp()
    originalFetch = global.fetch
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    await cleanupAllTestData()
    global.fetch = originalFetch
  })

  // ---- setup helpers ----

  async function verifiedUser(name?: string) {
    const user = await createTestUser(name ? { name } : {})
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))
    return { user, token: await createTestToken(user.id) }
  }

  async function createChapterEntity(projectId: string, body: string, overrides: Record<string, unknown> = {}) {
    const [row] = await db.insert(entities).values({
      projectId,
      scope: 'project',
      bobbinId: 'manuscript',
      collectionName: 'content',
      contentType: 'chapter',
      entityData: { title: 'Chapter 1', body, ...overrides },
    }).returning()
    return row!
  }

  async function createNoteEntity(projectId: string, content: string, overrides: Record<string, unknown> = {}) {
    const [row] = await db.insert(entities).values({
      projectId,
      scope: 'project',
      bobbinId: 'notes',
      collectionName: 'notes',
      entityData: { title: 'My Note', content, ...overrides },
    }).returning()
    return row!
  }

  async function createCharacterEntity(projectId: string, overrides: Record<string, unknown> = {}) {
    const [row] = await db.insert(entities).values({
      projectId,
      scope: 'project',
      bobbinId: 'entities',
      collectionName: 'characters',
      entityData: { name: 'Aldric', ...overrides },
    }).returning()
    return row!
  }

  async function createTimelineEntity(projectId: string, overrides: Record<string, unknown> = {}) {
    const [row] = await db.insert(entities).values({
      projectId,
      scope: 'project',
      bobbinId: 'timeline',
      collectionName: 'events',
      entityData: { title: 'The Fall of the Keep', description: 'The keep fell after a long siege.', date_label: 'Year 3', ...overrides },
    }).returning()
    return row!
  }

  function inject(token: string | undefined, method: string, url: string, payload?: Record<string, unknown>) {
    return app.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload,
    })
  }

  async function configureAI(token: string, body: Record<string, unknown> = {}) {
    return inject(token, 'PUT', '/api/ai-tools/config', {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key-123',
      ...body,
    })
  }

  // ---- fetch mocks (the model-call boundary) ----

  function mockAnthropicSuccess(text: string, model = 'claude-sonnet-4-20250514') {
    const calls: any[] = []
    global.fetch = jest.fn(async (_url: any, init: any) => {
      calls.push(init)
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text }],
          usage: { input_tokens: 42, output_tokens: 7 },
          model,
        }),
      }
    }) as any
    return calls
  }

  function mockAnthropicHttpError(status: number, body = 'error body') {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status,
      text: async () => body,
    })) as any
  }

  function mockAnthropicMalformed() {
    // ok:true but missing `content` — callAnthropic does
    // `data.content.filter(...)`, which throws a plain TypeError, not an ApiError.
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ usage: { input_tokens: 1, output_tokens: 1 }, model: 'claude-sonnet-4-20250514' }),
    })) as any
  }

  function mockFetchNetworkFailure(message = 'network unreachable') {
    global.fetch = jest.fn(async () => {
      throw new Error(message)
    }) as any
  }

  const LONG_BODY = '<p>' + 'The old keep groaned under the weight of the siege. '.repeat(4) + '</p>' // > 100 chars plain
  const SHORT_BODY = '<p>Too short.</p>'
  const LONG_NOTE = 'A note with enough substance to pass the brainstorm minimum length check easily.'
  const SHORT_NOTE = 'Too short'

  // ============================================================
  // GET/PUT /ai-tools/config
  // ============================================================

  describe('GET/PUT /ai-tools/config', () => {
    it('returns 401 without a token', async () => {
      const res = await inject(undefined, 'GET', '/api/ai-tools/config')
      expect(res.statusCode).toBe(401)
    })

    it('returns not-configured shape with no availableModels when nothing is saved', async () => {
      const { token } = await verifiedUser()
      const res = await inject(token, 'GET', '/api/ai-tools/config')
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({
        configured: false,
        provider: null,
        model: null,
        keyConfigured: false,
      })
    })

    it('PUT rejects missing provider/apiKey with 400', async () => {
      const { token } = await verifiedUser()
      const res = await inject(token, 'PUT', '/api/ai-tools/config', { provider: 'anthropic' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('Provider and API key are required')
    })

    it('PUT rejects an invalid provider with 400', async () => {
      const { token } = await verifiedUser()
      const res = await inject(token, 'PUT', '/api/ai-tools/config', { provider: 'gemini', apiKey: 'x' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('Invalid provider — use "anthropic" or "openai"')
    })

    it('PUT stores the key AES-encrypted (never plaintext) and applies the provider default model', async () => {
      const { user, token } = await verifiedUser()
      const res = await configureAI(token, { model: undefined })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({
        success: true,
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
      })

      const [row] = await db.select().from(userBobbinsInstalled).where(eq(userBobbinsInstalled.userId, user.id))
      const config = row!.config as any
      expect(config.apiKey).not.toBe('sk-ant-test-key-123')
      expect(config.apiKey.startsWith('v1:')).toBe(true)
      expect(decryptSecret(config.apiKey)).toBe('sk-ant-test-key-123')
    })

    it('GET reflects saved config with availableModels', async () => {
      const { token } = await verifiedUser()
      await configureAI(token, { model: 'claude-haiku-4-5-20251001' })
      const res = await inject(token, 'GET', '/api/ai-tools/config')
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body).toEqual({
        configured: true,
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        keyConfigured: true,
        availableModels: {
          anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
          openai: ['gpt-4o', 'gpt-4o-mini'],
        },
      })
    })
  })

  // ============================================================
  // POST /ai-tools/test
  // ============================================================

  describe('POST /ai-tools/test', () => {
    it('returns 401 without a token', async () => {
      const res = await inject(undefined, 'POST', '/api/ai-tools/test')
      expect(res.statusCode).toBe(401)
    })

    it('returns 400 "No API key configured" when nothing is stored and none is provided', async () => {
      const { token } = await verifiedUser()
      const res = await inject(token, 'POST', '/api/ai-tools/test', {})
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('No API key configured')
    })

    it('returns success:true when the mocked call succeeds', async () => {
      const { token } = await verifiedUser()
      mockAnthropicSuccess('Connection successful')
      const res = await inject(token, 'POST', '/api/ai-tools/test', {
        provider: 'anthropic', apiKey: 'sk-ant-abc', model: 'claude-sonnet-4-20250514',
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ success: true })
    })

    it('returns 400 with the upstream error message when the key is rejected', async () => {
      const { token } = await verifiedUser()
      mockAnthropicHttpError(401)
      const res = await inject(token, 'POST', '/api/ai-tools/test', {
        provider: 'anthropic', apiKey: 'sk-ant-bad',
      })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('Invalid API key')
    })
  })

  // ============================================================
  // POST /ai-tools/synopsis
  // ============================================================

  describe('POST /ai-tools/synopsis', () => {
    it('returns 401 without a token', async () => {
      const res = await inject(undefined, 'POST', '/api/ai-tools/synopsis', { projectId: 'x', entityId: 'y' })
      expect(res.statusCode).toBe(401)
    })

    it("returns 403 Forbidden for another author's project", async () => {
      const { token } = await verifiedUser()
      const other = await createTestUser()
      const otherProject = await createTestProject(other.id)
      const res = await inject(token, 'POST', '/api/ai-tools/synopsis', { projectId: otherProject.id, entityId: crypto.randomUUID() })
      expect(res.statusCode).toBe(403)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Forbidden', message: 'You do not have permission to access this project' })
    })

    it('returns 400 when entityId is missing', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const res = await inject(token, 'POST', '/api/ai-tools/synopsis', { projectId: project.id })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('projectId and entityId are required')
    })

    it('returns 400 "not configured" when the caller has no AI key saved', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await createChapterEntity(project.id, LONG_BODY)
      const res = await inject(token, 'POST', '/api/ai-tools/synopsis', { projectId: project.id, entityId: chapter.id })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('AI tools not configured — add your API key')
    })

    it('returns 404 for an entityId that does not exist in the caller\'s own project', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const res = await inject(token, 'POST', '/api/ai-tools/synopsis', { projectId: project.id, entityId: crypto.randomUUID() })
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload).error).toBe('Entity not found')
    })

    it("returns 404 (not a leak) for another author's chapter id even under the caller's own project", async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const other = await verifiedUser()
      const otherProject = await createTestProject(other.user.id)
      const otherChapter = await createChapterEntity(otherProject.id, LONG_BODY)

      const res = await inject(token, 'POST', '/api/ai-tools/synopsis', { projectId: project.id, entityId: otherChapter.id })
      expect(res.statusCode).toBe(404)
    })

    it('returns 400 when the chapter has too little content', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const chapter = await createChapterEntity(project.id, SHORT_BODY)
      const res = await inject(token, 'POST', '/api/ai-tools/synopsis', { projectId: project.id, entityId: chapter.id })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('Chapter needs more content before generating a synopsis')
    })

    it('returns the generated synopsis on the happy path, without persisting anything', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const chapter = await createChapterEntity(project.id, LONG_BODY)
      mockAnthropicSuccess('  The keep falls after a long siege.  ')

      const res = await inject(token, 'POST', '/api/ai-tools/synopsis', { projectId: project.id, entityId: chapter.id })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body).toEqual({
        success: true,
        synopsis: 'The keep falls after a long siege.',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 42,
        outputTokens: 7,
        existingSynopsis: null,
      })

      // The plain synopsis endpoint (as opposed to /synopsis/save) never writes.
      const [row] = await db.select().from(entities).where(eq(entities.id, chapter.id))
      expect((row!.entityData as any).synopsis).toBeUndefined()
    })

    it('surfaces a malformed (non-JSON-shaped) model response as a 502 rather than throwing', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const chapter = await createChapterEntity(project.id, LONG_BODY)
      mockAnthropicMalformed()

      const res = await inject(token, 'POST', '/api/ai-tools/synopsis', { projectId: project.id, entityId: chapter.id })
      expect(res.statusCode).toBe(502)
      const body = JSON.parse(res.payload)
      expect(typeof body.error).toBe('string')
      expect(body.error.length).toBeGreaterThan(0)
    })

    it('surfaces a network failure as a 502 with the underlying error message', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const chapter = await createChapterEntity(project.id, LONG_BODY)
      mockFetchNetworkFailure('network unreachable')

      const res = await inject(token, 'POST', '/api/ai-tools/synopsis', { projectId: project.id, entityId: chapter.id })
      expect(res.statusCode).toBe(502)
      expect(JSON.parse(res.payload).error).toBe('network unreachable')
    })

    it('surfaces an upstream 401 (bad key) as 401 AI_INVALID_API_KEY', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const chapter = await createChapterEntity(project.id, LONG_BODY)
      mockAnthropicHttpError(401)

      const res = await inject(token, 'POST', '/api/ai-tools/synopsis', { projectId: project.id, entityId: chapter.id })
      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Invalid API key', code: 'AI_INVALID_API_KEY' })
    })

    it('surfaces an upstream 429 as 429 AI_RATE_LIMITED', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const chapter = await createChapterEntity(project.id, LONG_BODY)
      mockAnthropicHttpError(429)

      const res = await inject(token, 'POST', '/api/ai-tools/synopsis', { projectId: project.id, entityId: chapter.id })
      expect(res.statusCode).toBe(429)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Rate limit exceeded — try again in a moment', code: 'AI_RATE_LIMITED' })
    })
  })

  // ============================================================
  // POST /ai-tools/synopsis/save
  // ============================================================

  describe('POST /ai-tools/synopsis/save', () => {
    it('returns 401 without a token', async () => {
      const res = await inject(undefined, 'POST', '/api/ai-tools/synopsis/save', { projectId: 'x', entityId: 'y', synopsis: 'z' })
      expect(res.statusCode).toBe(401)
    })

    it("returns 403 Forbidden for another author's project", async () => {
      const { token } = await verifiedUser()
      const other = await createTestUser()
      const otherProject = await createTestProject(other.id)
      const res = await inject(token, 'POST', '/api/ai-tools/synopsis/save', {
        projectId: otherProject.id, entityId: crypto.randomUUID(), synopsis: 'A synopsis.',
      })
      expect(res.statusCode).toBe(403)
    })

    it('returns 400 when synopsis is missing', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await createChapterEntity(project.id, LONG_BODY)
      const res = await inject(token, 'POST', '/api/ai-tools/synopsis/save', { projectId: project.id, entityId: chapter.id })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('projectId, entityId, and synopsis are required')
    })

    it('returns 404 for a non-existent entity', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const res = await inject(token, 'POST', '/api/ai-tools/synopsis/save', {
        projectId: project.id, entityId: crypto.randomUUID(), synopsis: 'A synopsis.',
      })
      expect(res.statusCode).toBe(404)
    })

    it('persists the trimmed synopsis, a provenance event, and an entity-changes row', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await createChapterEntity(project.id, LONG_BODY)

      const res = await inject(token, 'POST', '/api/ai-tools/synopsis/save', {
        projectId: project.id, entityId: chapter.id, synopsis: '  A concise synopsis.  ', model: 'claude-sonnet-4-20250514',
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ success: true })

      const [row] = await db.select().from(entities).where(eq(entities.id, chapter.id))
      expect((row!.entityData as any).synopsis).toBe('A concise synopsis.')

      const [prov] = await db.select().from(provenanceEvents).where(eq(provenanceEvents.projectId, project.id))
      expect(prov!.entityRef).toBe(`${project.id}:manuscript:content:${chapter.id}`)
      expect(prov!.actor).toBe(user.id)
      expect(prov!.action).toBe('ai_assist')
      expect(prov!.metaJson).toEqual({ type: 'synopsis_save', aiModel: 'claude-sonnet-4-20250514', bobbinId: 'ai-tools' })

      const [change] = await db.select().from(entityChanges).where(eq(entityChanges.entityId, chapter.id))
      expect(change!.action).toBe('updated')
      expect(change!.fieldsChanged).toEqual(['synopsis'])
    })

    it('defaults aiModel to "unknown" in the provenance event when no model is given', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await createChapterEntity(project.id, LONG_BODY)

      await inject(token, 'POST', '/api/ai-tools/synopsis/save', {
        projectId: project.id, entityId: chapter.id, synopsis: 'A synopsis.',
      })

      const [prov] = await db.select().from(provenanceEvents).where(eq(provenanceEvents.projectId, project.id))
      expect((prov!.metaJson as any).aiModel).toBe('unknown')
    })
  })

  // ============================================================
  // POST /ai-tools/review
  // ============================================================

  describe('POST /ai-tools/review', () => {
    it('returns 401 without a token', async () => {
      const res = await inject(undefined, 'POST', '/api/ai-tools/review', { projectId: 'x', entityId: 'y' })
      expect(res.statusCode).toBe(401)
    })

    it("returns 403 Forbidden for another author's project", async () => {
      const { token } = await verifiedUser()
      const other = await createTestUser()
      const otherProject = await createTestProject(other.id)
      const res = await inject(token, 'POST', '/api/ai-tools/review', { projectId: otherProject.id, entityId: crypto.randomUUID() })
      expect(res.statusCode).toBe(403)
    })

    it('returns 400 when entityId is missing', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const res = await inject(token, 'POST', '/api/ai-tools/review', { projectId: project.id })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('projectId and entityId are required')
    })

    it('returns 400 "not configured" when the caller has no AI key saved', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await createChapterEntity(project.id, LONG_BODY)
      const res = await inject(token, 'POST', '/api/ai-tools/review', { projectId: project.id, entityId: chapter.id })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('AI tools not configured — add your API key')
    })

    it('returns 404 for a non-existent entity', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const res = await inject(token, 'POST', '/api/ai-tools/review', { projectId: project.id, entityId: crypto.randomUUID() })
      expect(res.statusCode).toBe(404)
    })

    it('returns 400 when the chapter has too little content (100-char floor)', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const chapter = await createChapterEntity(project.id, SHORT_BODY)
      const res = await inject(token, 'POST', '/api/ai-tools/review', { projectId: project.id, entityId: chapter.id })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('Chapter needs more content before generating a review')
    })

    it('generates a review, auto-saves lastReview, writes provenance + entity-changes, and sends the focus in the prompt', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const chapter = await createChapterEntity(project.id, LONG_BODY)
      const calls = mockAnthropicSuccess('**Overall Impression**\nSolid tension.')

      const res = await inject(token, 'POST', '/api/ai-tools/review', {
        projectId: project.id, entityId: chapter.id, focus: 'pacing',
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.success).toBe(true)
      expect(body.review).toBe('**Overall Impression**\nSolid tension.')
      expect(body.model).toBe('claude-sonnet-4-20250514')
      expect(body.focus).toBe('pacing')
      expect(typeof body.generatedAt).toBe('string')
      expect(body.inputTokens).toBe(42)
      expect(body.outputTokens).toBe(7)

      // The requested focus and chapter title reach the outbound prompt.
      const sentBody = JSON.parse(calls[0].body)
      expect(sentBody.system).toContain('pacing')
      expect(sentBody.messages[0].content).toContain('Chapter 1')

      const [row] = await db.select().from(entities).where(eq(entities.id, chapter.id))
      const lastReview = (row!.entityData as any).lastReview
      expect(lastReview.text).toBe('**Overall Impression**\nSolid tension.')
      expect(lastReview.model).toBe('claude-sonnet-4-20250514')
      expect(lastReview.focus).toBe('pacing')

      const [prov] = await db.select().from(provenanceEvents).where(eq(provenanceEvents.projectId, project.id))
      expect(prov!.action).toBe('ai_assist')
      expect(prov!.actor).toBe(user.id)
      expect(prov!.metaJson).toEqual({ type: 'review_save', aiModel: 'claude-sonnet-4-20250514', focus: 'pacing', bobbinId: 'ai-tools' })

      const [change] = await db.select().from(entityChanges).where(eq(entityChanges.entityId, chapter.id))
      expect(change!.fieldsChanged).toEqual(['last_review'])
    })

    it('a malformed model response is a 502 and leaves no half-written lastReview/provenance/entity-changes rows', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const chapter = await createChapterEntity(project.id, LONG_BODY)
      mockAnthropicMalformed()

      const res = await inject(token, 'POST', '/api/ai-tools/review', { projectId: project.id, entityId: chapter.id })
      expect(res.statusCode).toBe(502)

      const [row] = await db.select().from(entities).where(eq(entities.id, chapter.id))
      expect((row!.entityData as any).lastReview).toBeUndefined()
      const provRows = await db.select().from(provenanceEvents).where(eq(provenanceEvents.projectId, project.id))
      expect(provRows).toHaveLength(0)
      const changeRows = await db.select().from(entityChanges).where(eq(entityChanges.entityId, chapter.id))
      expect(changeRows).toHaveLength(0)
    })

    it('a network failure is a 502 and leaves no half-written rows', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const chapter = await createChapterEntity(project.id, LONG_BODY)
      mockFetchNetworkFailure('timed out')

      const res = await inject(token, 'POST', '/api/ai-tools/review', { projectId: project.id, entityId: chapter.id })
      expect(res.statusCode).toBe(502)
      expect(JSON.parse(res.payload).error).toBe('timed out')

      const [row] = await db.select().from(entities).where(eq(entities.id, chapter.id))
      expect((row!.entityData as any).lastReview).toBeUndefined()
    })
  })

  // ============================================================
  // GET /ai-tools/review/existing
  // ============================================================

  describe('GET /ai-tools/review/existing', () => {
    function get(token: string | undefined, query: Record<string, string>) {
      const qs = new URLSearchParams(query).toString()
      return app.inject({
        method: 'GET',
        url: `/api/ai-tools/review/existing?${qs}`,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      })
    }

    it('returns 401 without a token', async () => {
      const res = await get(undefined, { projectId: 'x', entityId: 'y' })
      expect(res.statusCode).toBe(401)
    })

    it("returns 403 Forbidden for another author's project", async () => {
      const { token } = await verifiedUser()
      const other = await createTestUser()
      const otherProject = await createTestProject(other.id)
      const res = await get(token, { projectId: otherProject.id, entityId: crypto.randomUUID() })
      expect(res.statusCode).toBe(403)
    })

    it('returns 400 when entityId is missing', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const res = await get(token, { projectId: project.id, entityId: '' })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('projectId and entityId are required')
    })

    it('returns 404 for a non-existent entity', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const res = await get(token, { projectId: project.id, entityId: crypto.randomUUID() })
      expect(res.statusCode).toBe(404)
    })

    it('returns exists:false when no review has been saved', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await createChapterEntity(project.id, LONG_BODY)
      const res = await get(token, { projectId: project.id, entityId: chapter.id })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ exists: false })
    })

    it('returns the persisted review when one exists', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const chapter = await createChapterEntity(project.id, LONG_BODY, {
        lastReview: { text: 'Great pacing.', model: 'claude-sonnet-4-20250514', focus: 'pacing', generatedAt: '2026-01-01T00:00:00.000Z' },
      })
      const res = await get(token, { projectId: project.id, entityId: chapter.id })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({
        exists: true,
        review: 'Great pacing.',
        model: 'claude-sonnet-4-20250514',
        focus: 'pacing',
        generatedAt: '2026-01-01T00:00:00.000Z',
      })
    })
  })

  // ============================================================
  // POST /ai-tools/names
  // ============================================================

  describe('POST /ai-tools/names', () => {
    it('returns 401 without a token', async () => {
      const res = await inject(undefined, 'POST', '/api/ai-tools/names', { projectId: 'x', entityId: 'y' })
      expect(res.statusCode).toBe(401)
    })

    it("returns 403 Forbidden for another author's project", async () => {
      const { token } = await verifiedUser()
      const other = await createTestUser()
      const otherProject = await createTestProject(other.id)
      const res = await inject(token, 'POST', '/api/ai-tools/names', { projectId: otherProject.id, entityId: crypto.randomUUID() })
      expect(res.statusCode).toBe(403)
    })

    it('returns 400 when entityId is missing', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const res = await inject(token, 'POST', '/api/ai-tools/names', { projectId: project.id })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('projectId and entityId are required')
    })

    it('returns 400 "not configured" when the caller has no AI key saved', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const character = await createCharacterEntity(project.id)
      const res = await inject(token, 'POST', '/api/ai-tools/names', { projectId: project.id, entityId: character.id })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('AI tools not configured — add your API key')
    })

    it('returns 404 for a non-existent entity', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const res = await inject(token, 'POST', '/api/ai-tools/names', { projectId: project.id, entityId: crypto.randomUUID() })
      expect(res.statusCode).toBe(404)
    })

    it('returns parsed name suggestions on the happy path', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const character = await createCharacterEntity(project.id)
      mockAnthropicSuccess('Aldric\nMorwen\n\nThessaly\n')

      const res = await inject(token, 'POST', '/api/ai-tools/names', { projectId: project.id, entityId: character.id, genre: 'gothic' })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({
        success: true,
        names: ['Aldric', 'Morwen', 'Thessaly'],
        model: 'claude-sonnet-4-20250514',
      })
    })

    it('surfaces a model failure as 502 rather than throwing', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const character = await createCharacterEntity(project.id)
      mockFetchNetworkFailure('boom')

      const res = await inject(token, 'POST', '/api/ai-tools/names', { projectId: project.id, entityId: character.id })
      expect(res.statusCode).toBe(502)
      expect(JSON.parse(res.payload).error).toBe('boom')
    })
  })

  // ============================================================
  // POST /ai-tools/brainstorm
  // ============================================================

  describe('POST /ai-tools/brainstorm', () => {
    it('returns 401 without a token', async () => {
      const res = await inject(undefined, 'POST', '/api/ai-tools/brainstorm', { projectId: 'x', entityId: 'y' })
      expect(res.statusCode).toBe(401)
    })

    it("returns 403 Forbidden for another author's project", async () => {
      const { token } = await verifiedUser()
      const other = await createTestUser()
      const otherProject = await createTestProject(other.id)
      const res = await inject(token, 'POST', '/api/ai-tools/brainstorm', { projectId: otherProject.id, entityId: crypto.randomUUID() })
      expect(res.statusCode).toBe(403)
    })

    it('returns 400 when entityId is missing', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const res = await inject(token, 'POST', '/api/ai-tools/brainstorm', { projectId: project.id })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('projectId and entityId are required')
    })

    it('returns 400 "not configured" when the caller has no AI key saved', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const note = await createNoteEntity(project.id, LONG_NOTE)
      const res = await inject(token, 'POST', '/api/ai-tools/brainstorm', { projectId: project.id, entityId: note.id })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('AI tools not configured — add your API key')
    })

    it('returns 404 for a non-existent entity', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const res = await inject(token, 'POST', '/api/ai-tools/brainstorm', { projectId: project.id, entityId: crypto.randomUUID() })
      expect(res.statusCode).toBe(404)
    })

    it('returns 400 when the note has too little content (20-char floor)', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const note = await createNoteEntity(project.id, SHORT_NOTE)
      const res = await inject(token, 'POST', '/api/ai-tools/brainstorm', { projectId: project.id, entityId: note.id })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('Note needs more content before brainstorming')
    })

    it('returns brainstormed ideas on the happy path', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const note = await createNoteEntity(project.id, LONG_NOTE)
      mockAnthropicSuccess('**Ideas & Angles**\nTry a flashback structure.')

      const res = await inject(token, 'POST', '/api/ai-tools/brainstorm', { projectId: project.id, entityId: note.id })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({
        success: true,
        brainstorm: '**Ideas & Angles**\nTry a flashback structure.',
        model: 'claude-sonnet-4-20250514',
      })
    })

    it('surfaces a model failure as 502 rather than throwing', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const note = await createNoteEntity(project.id, LONG_NOTE)
      mockFetchNetworkFailure('boom')

      const res = await inject(token, 'POST', '/api/ai-tools/brainstorm', { projectId: project.id, entityId: note.id })
      expect(res.statusCode).toBe(502)
      expect(JSON.parse(res.payload).error).toBe('boom')
    })
  })

  // ============================================================
  // POST /ai-tools/flesh-out
  // ============================================================

  describe('POST /ai-tools/flesh-out', () => {
    it('returns 401 without a token', async () => {
      const res = await inject(undefined, 'POST', '/api/ai-tools/flesh-out', { projectId: 'x', entityId: 'y' })
      expect(res.statusCode).toBe(401)
    })

    it("returns 403 Forbidden for another author's project", async () => {
      const { token } = await verifiedUser()
      const other = await createTestUser()
      const otherProject = await createTestProject(other.id)
      const res = await inject(token, 'POST', '/api/ai-tools/flesh-out', { projectId: otherProject.id, entityId: crypto.randomUUID() })
      expect(res.statusCode).toBe(403)
    })

    it('returns 400 when entityId is missing', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const res = await inject(token, 'POST', '/api/ai-tools/flesh-out', { projectId: project.id })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('projectId and entityId are required')
    })

    it('returns 400 "not configured" when the caller has no AI key saved', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      const event = await createTimelineEntity(project.id)
      const res = await inject(token, 'POST', '/api/ai-tools/flesh-out', { projectId: project.id, entityId: event.id })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.payload).error).toBe('AI tools not configured — add your API key')
    })

    it('returns 404 for a non-existent entity', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const res = await inject(token, 'POST', '/api/ai-tools/flesh-out', { projectId: project.id, entityId: crypto.randomUUID() })
      expect(res.statusCode).toBe(404)
    })

    it('returns fleshed-out details on the happy path', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const event = await createTimelineEntity(project.id)
      mockAnthropicSuccess('**Expanded Description**\nThe siege lasted three months.')

      const res = await inject(token, 'POST', '/api/ai-tools/flesh-out', { projectId: project.id, entityId: event.id })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({
        success: true,
        details: '**Expanded Description**\nThe siege lasted three months.',
        model: 'claude-sonnet-4-20250514',
      })
    })

    it('surfaces a model failure as 502 rather than throwing', async () => {
      const { user, token } = await verifiedUser()
      const project = await createTestProject(user.id)
      await configureAI(token)
      const event = await createTimelineEntity(project.id)
      mockFetchNetworkFailure('boom')

      const res = await inject(token, 'POST', '/api/ai-tools/flesh-out', { projectId: project.id, entityId: event.id })
      expect(res.statusCode).toBe(502)
      expect(JSON.parse(res.payload).error).toBe('boom')
    })
  })
})
