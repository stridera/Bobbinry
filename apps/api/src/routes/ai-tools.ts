/**
 * AI Tools Routes (User-Scoped)
 *
 * Handles AI config storage, synopsis generation, review feedback,
 * name generation, brainstorming, and timeline flesh-out.
 * Config stored in user_bobbins_installed, provenance logged on synopsis/review save.
 */

import { FastifyPluginAsync } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/connection'
import { entities, userBobbinsInstalled, provenanceEvents } from '../db/schema'
import { requireAuth, requireProjectOwnership } from '../middleware/auth'
import { ApiError } from '../lib/errors'

// --- AI Provider types and constants (inlined to stay within rootDir) ---

type AIProvider = 'anthropic' | 'openai'

const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
}

const AVAILABLE_MODELS: Record<AIProvider, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
}

function getDefaultModel(provider: AIProvider): string {
  return DEFAULT_MODELS[provider]
}

// --- Minimal AI client ---

interface AIResponse {
  text: string
  inputTokens?: number
  outputTokens?: number
  model: string
}

async function callAnthropic(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<AIResponse> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!response.ok) {
    const errBody = await response.text()
    if (response.status === 401) throw new ApiError('Invalid API key', 401, 'AI_INVALID_API_KEY')
    if (response.status === 429) throw new ApiError('Rate limit exceeded — try again in a moment', 429, 'AI_RATE_LIMITED')
    throw new ApiError(`Anthropic API error (${response.status}): ${errBody}`, 502, 'AI_UPSTREAM_ERROR')
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>
    usage: { input_tokens: number; output_tokens: number }
    model: string
  }

  return {
    text: data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
    model: data.model,
  }
}

async function callOpenAI(apiKey: string, model: string, systemPrompt: string, userPrompt: string): Promise<AIResponse> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    const errBody = await response.text()
    if (response.status === 401) throw new ApiError('Invalid API key', 401, 'AI_INVALID_API_KEY')
    if (response.status === 429) throw new ApiError('Rate limit exceeded — try again in a moment', 429, 'AI_RATE_LIMITED')
    throw new ApiError(`OpenAI API error (${response.status}): ${errBody}`, 502, 'AI_UPSTREAM_ERROR')
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>
    usage: { prompt_tokens: number; completion_tokens: number }
    model: string
  }

  return {
    text: data.choices?.[0]?.message?.content || '',
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
    model: data.model,
  }
}

async function generateText(
  provider: AIProvider,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<AIResponse> {
  if (provider === 'anthropic') {
    return callAnthropic(apiKey, model, systemPrompt, userPrompt)
  }
  return callOpenAI(apiKey, model, systemPrompt, userPrompt)
}

async function testConnection(provider: AIProvider, apiKey: string, model: string): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await generateText(
      provider,
      apiKey,
      model,
      'You are a test assistant.',
      'Reply with exactly: "Connection successful"'
    )
    return { success: result.text.length > 0 }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// --- Prompts (inlined for rootDir constraints) ---

const SYNOPSIS_SYSTEM_PROMPT = `You are a writing assistant that creates concise synopses. Your job is to summarize what happens in a chapter, not to rewrite or improve it.

Rules:
- Write 1-3 sentences that capture the key events and emotional arc
- Use present tense
- Focus on what happens, not how well it's written
- Do not include opinions, suggestions, or commentary
- Do not use flowery or promotional language
- Match the tone of the source material
- Return ONLY the synopsis text, no labels or prefixes`

function buildSynopsisPrompt(title: string, bodyText: string): string {
  const truncated = bodyText.length > 8000 ? bodyText.slice(0, 8000) + '\n\n[Content truncated]' : bodyText
  return `Write a synopsis for this chapter.\n\nTitle: ${title}\n\nContent:\n${truncated}`
}

const REVIEW_BASE_RULES = `Rules:
- Be honest but constructive
- Cite specific passages when possible
- Never rewrite sentences for the author
- Focus on craft observations, not plot preferences
- Respect the author's voice and style`

const REVIEW_DEFAULT_SYSTEM_PROMPT = `You are a thoughtful beta reader providing structured feedback on a chapter of fiction. You analyze — you do not rewrite or generate content.

Provide feedback in these sections:

**Overall Impression** (2-3 sentences)
Your gut reaction as a reader. What worked, what the chapter accomplishes.

**Pacing**
Is the chapter well-paced? Are there sections that drag or feel rushed? Be specific about which parts.

**Character Voice**
Do the characters sound distinct? Is dialogue natural? Do character actions feel consistent?

**Prose Quality**
Note any patterns — overuse of adverbs, repetitive sentence structures, passive voice, telling vs showing. Cite specific examples.

**Suggestions** (bulleted list)
3-5 specific, actionable suggestions. Frame as observations, not commands.

${REVIEW_BASE_RULES}`

function buildReviewSystemPrompt(focus?: string): string {
  if (!focus?.trim()) return REVIEW_DEFAULT_SYSTEM_PROMPT

  return `You are a thoughtful beta reader providing structured feedback on a chapter of fiction. You analyze — you do not rewrite or generate content.

The author has requested feedback focused on: "${focus.trim()}".

Provide your feedback with this focus as the primary lens. Structure with clear **bold** section headers relevant to the requested focus. You may briefly note anything else significant, but keep the majority on the requested focus.

${REVIEW_BASE_RULES}`
}

function buildReviewPrompt(title: string, bodyText: string, focus?: string): string {
  const truncated = bodyText.length > 12000 ? bodyText.slice(0, 12000) + '\n\n[Content truncated]' : bodyText
  const focusLine = focus?.trim() ? `\nFocus: ${focus.trim()}\n` : ''
  return `Please provide structured feedback on this chapter.\n\nTitle: ${title}${focusLine}\n\nContent:\n${truncated}`
}

const NAMES_SYSTEM_PROMPT = `You are a creative name generator for fiction. Generate exactly 8 names.

Rules:
- Each name on its own line, no numbering or bullets
- Varied styles (some common, some unusual, some culturally inspired)
- If a genre/setting is specified, match the cultural and tonal feel
- No explanations or descriptions, just the names`

function buildNamesPrompt(collectionName: string, existingName?: string, genre?: string): string {
  let prompt = `Generate 8 names for a ${collectionName.replace(/s$/, '')}`
  if (genre?.trim()) prompt += ` in a ${genre.trim()} setting`
  prompt += '.'
  if (existingName?.trim()) prompt += `\n\nThe current name is "${existingName.trim()}" — provide alternatives in a similar or complementary style.`
  return prompt
}

const BRAINSTORM_SYSTEM_PROMPT = `You are a creative writing brainstorming partner. Your job is to expand on the author's notes with fresh ideas — not to rewrite or restructure.

Provide:
**Ideas & Angles** — 3-5 directions the author could take this
**Questions to Consider** — 3-5 questions that might deepen the concept
**Connections** — any themes, tropes, or narrative possibilities you notice

Rules:
- Be generative, not prescriptive
- Respect what the author already has
- Offer variety — don't just elaborate on one angle`

function buildBrainstormPrompt(title: string, content: string): string {
  const truncated = content.length > 8000 ? content.slice(0, 8000) + '\n\n[Content truncated]' : content
  return `Brainstorm ideas based on this note.\n\nTitle: ${title}\n\nContent:\n${truncated}`
}

const FLESH_OUT_SYSTEM_PROMPT = `You are a worldbuilding assistant helping flesh out timeline events for fiction.

Provide:
**Expanded Description** — 2-3 sentences adding detail and atmosphere
**Consequences** — what this event likely causes or changes
**Story Hooks** — 2-3 narrative opportunities this event creates

Rules:
- Stay consistent with the event's existing details
- Don't contradict what the author wrote
- Frame suggestions as possibilities, not requirements`

function buildFleshOutPrompt(title: string, description?: string, dateLabel?: string): string {
  let prompt = `Flesh out this timeline event.\n\nTitle: ${title}`
  if (dateLabel?.trim()) prompt += `\nDate: ${dateLabel.trim()}`
  if (description?.trim()) prompt += `\n\nDescription:\n${description.trim()}`
  return prompt
}

// --- Helpers ---

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Look up user's AI tools bobbin installation */
async function getUserAIBobbin(userId: string) {
  const [bobbin] = await db
    .select()
    .from(userBobbinsInstalled)
    .where(
      and(
        eq(userBobbinsInstalled.userId, userId),
        eq(userBobbinsInstalled.bobbinId, 'ai-tools'),
        eq(userBobbinsInstalled.bobbinType, 'ai_tools')
      )
    )
    .limit(1)
  return bobbin
}

// --- Plugin ---

const aiToolsPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /ai-tools/config
   * Returns config status (never the actual key)
   */
  fastify.get(
    '/ai-tools/config',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.id
      const bobbin = await getUserAIBobbin(userId)

      if (!bobbin) {
        return reply.send({
          configured: false,
          provider: null,
          model: null,
          keyConfigured: false,
        })
      }

      const config = bobbin.config as any
      return reply.send({
        configured: !!config?.apiKey,
        provider: config?.provider || null,
        model: config?.model || null,
        keyConfigured: !!config?.apiKey,
        availableModels: AVAILABLE_MODELS,
      })
    }
  )

  /**
   * PUT /ai-tools/config
   * Save API key + provider + model
   */
  fastify.put<{ Body: { provider: AIProvider; apiKey: string; model?: string } }>(
    '/ai-tools/config',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.id
      const { provider, apiKey, model } = request.body || {}

      if (!provider || !apiKey) {
        return reply.status(400).send({ error: 'Provider and API key are required' })
      }

      if (!['anthropic', 'openai'].includes(provider)) {
        return reply.status(400).send({ error: 'Invalid provider — use "anthropic" or "openai"' })
      }

      const effectiveModel = model || getDefaultModel(provider)

      const existing = await getUserAIBobbin(userId)
      const bobbinConfig = { provider, apiKey, model: effectiveModel }

      if (existing) {
        await db
          .update(userBobbinsInstalled)
          .set({
            config: bobbinConfig,
            isEnabled: true,
            updatedAt: new Date(),
          })
          .where(eq(userBobbinsInstalled.id, existing.id))
      } else {
        await db.insert(userBobbinsInstalled).values({
          userId,
          bobbinId: 'ai-tools',
          bobbinType: 'ai_tools',
          config: bobbinConfig,
          isEnabled: true,
        })
      }

      return reply.send({ success: true, provider, model: effectiveModel })
    }
  )

  /**
   * POST /ai-tools/test
   * Validate API key with a minimal LLM call
   */
  fastify.post<{ Body: { provider?: AIProvider; apiKey?: string; model?: string } }>(
    '/ai-tools/test',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { provider, apiKey, model } = request.body || {}

      let testProvider = provider
      let testKey = apiKey
      let testModel = model

      if (!testProvider || !testKey) {
        const bobbin = await getUserAIBobbin(request.user!.id)
        const config = bobbin?.config as any
        if (!config?.apiKey) {
          return reply.status(400).send({ error: 'No API key configured' })
        }
        testProvider = testProvider || config.provider
        testKey = testKey || config.apiKey
        testModel = testModel || config.model
      }

      const result = await testConnection(
        testProvider! as AIProvider,
        testKey!,
        testModel || getDefaultModel(testProvider! as AIProvider)
      )

      if (!result.success) {
        return reply.status(400).send({ error: result.error || 'Connection test failed' })
      }

      return reply.send({ success: true })
    }
  )

  /**
   * POST /ai-tools/synopsis
   * Generate a synopsis for an entity
   */
  fastify.post<{ Body: { projectId: string; entityId: string } }>(
    '/ai-tools/synopsis',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.id
      const { projectId, entityId } = request.body || {}

      if (!projectId || !entityId) {
        return reply.status(400).send({ error: 'projectId and entityId are required' })
      }

      const isOwner = await requireProjectOwnership(request, reply, projectId)
      if (!isOwner) return

      const bobbin = await getUserAIBobbin(userId)
      const config = bobbin?.config as any
      if (!config?.apiKey) {
        return reply.status(400).send({ error: 'AI tools not configured — add your API key' })
      }

      const [entity] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.id, entityId), eq(entities.projectId, projectId)))
        .limit(1)

      if (!entity) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      const data = entity.entityData as any
      const title = data?.title || 'Untitled'
      const body = data?.body || ''
      const plainText = stripHtml(body)

      if (plainText.length < 50) {
        return reply.status(400).send({ error: 'Chapter needs more content before generating a synopsis' })
      }

      try {
        const result = await generateText(
          config.provider as AIProvider,
          config.apiKey,
          config.model || getDefaultModel(config.provider),
          SYNOPSIS_SYSTEM_PROMPT,
          buildSynopsisPrompt(title, plainText)
        )

        return reply.send({
          success: true,
          synopsis: result.text.trim(),
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          existingSynopsis: data?.synopsis || null,
        })
      } catch (error) {
        fastify.log.error({ error, entityId }, 'Synopsis generation failed')
        if (error instanceof ApiError) {
          return reply.status(error.statusCode).send({ error: error.message, code: error.code })
        }
        return reply.status(502).send({
          error: error instanceof Error ? error.message : 'AI generation failed',
        })
      }
    }
  )

  /**
   * POST /ai-tools/synopsis/save
   * Save synopsis to entity + write provenance event
   */
  fastify.post<{ Body: { projectId: string; entityId: string; synopsis: string; model?: string } }>(
    '/ai-tools/synopsis/save',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.id
      const { projectId, entityId, synopsis, model } = request.body || {}

      if (!projectId || !entityId || !synopsis) {
        return reply.status(400).send({ error: 'projectId, entityId, and synopsis are required' })
      }

      const isOwner = await requireProjectOwnership(request, reply, projectId)
      if (!isOwner) return

      const [entity] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.id, entityId), eq(entities.projectId, projectId)))
        .limit(1)

      if (!entity) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      const currentData = entity.entityData as any

      await db
        .update(entities)
        .set({
          entityData: { ...currentData, synopsis: synopsis.trim() },
          updatedAt: new Date(),
        })
        .where(eq(entities.id, entityId))

      await db.insert(provenanceEvents).values({
        projectId,
        entityRef: `${projectId}:manuscript:content:${entityId}`,
        actor: userId,
        action: 'ai_assist',
        metaJson: {
          type: 'synopsis_save',
          aiModel: model || 'unknown',
          bobbinId: 'ai-tools',
        },
      })

      return reply.send({ success: true })
    }
  )

  /**
   * POST /ai-tools/review
   * Generate structured review for a chapter, auto-save to entityData.lastReview
   */
  fastify.post<{ Body: { projectId: string; entityId: string; focus?: string } }>(
    '/ai-tools/review',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.id
      const { projectId, entityId, focus } = request.body || {}

      if (!projectId || !entityId) {
        return reply.status(400).send({ error: 'projectId and entityId are required' })
      }

      const isOwner = await requireProjectOwnership(request, reply, projectId)
      if (!isOwner) return

      const bobbin = await getUserAIBobbin(userId)
      const config = bobbin?.config as any
      if (!config?.apiKey) {
        return reply.status(400).send({ error: 'AI tools not configured — add your API key' })
      }

      const [entity] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.id, entityId), eq(entities.projectId, projectId)))
        .limit(1)

      if (!entity) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      const data = entity.entityData as any
      const title = data?.title || 'Untitled'
      const body = data?.body || ''
      const plainText = stripHtml(body)

      if (plainText.length < 100) {
        return reply.status(400).send({ error: 'Chapter needs more content before generating a review' })
      }

      try {
        const result = await generateText(
          config.provider as AIProvider,
          config.apiKey,
          config.model || getDefaultModel(config.provider),
          buildReviewSystemPrompt(focus),
          buildReviewPrompt(title, plainText, focus)
        )

        const generatedAt = new Date().toISOString()

        // Re-fetch entity to avoid stale data, then auto-save review
        const [freshEntity] = await db
          .select()
          .from(entities)
          .where(and(eq(entities.id, entityId), eq(entities.projectId, projectId)))
          .limit(1)

        if (freshEntity) {
          const currentData = freshEntity.entityData as any
          await db
            .update(entities)
            .set({
              entityData: {
                ...currentData,
                lastReview: {
                  text: result.text.trim(),
                  model: result.model,
                  focus: focus?.trim() || null,
                  generatedAt,
                },
              },
              updatedAt: new Date(),
            })
            .where(eq(entities.id, entityId))

          await db.insert(provenanceEvents).values({
            projectId,
            entityRef: `${projectId}:manuscript:content:${entityId}`,
            actor: userId,
            action: 'ai_assist',
            metaJson: {
              type: 'review_save',
              aiModel: result.model,
              focus: focus?.trim() || null,
              bobbinId: 'ai-tools',
            },
          })
        }

        return reply.send({
          success: true,
          review: result.text.trim(),
          model: result.model,
          focus: focus?.trim() || null,
          generatedAt,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        })
      } catch (error) {
        fastify.log.error({ error, entityId }, 'Review generation failed')
        if (error instanceof ApiError) {
          return reply.status(error.statusCode).send({ error: error.message, code: error.code })
        }
        return reply.status(502).send({
          error: error instanceof Error ? error.message : 'AI generation failed',
        })
      }
    }
  )

  /**
   * GET /ai-tools/review/existing
   * Load persisted review from entityData.lastReview
   */
  fastify.get<{ Querystring: { projectId: string; entityId: string } }>(
    '/ai-tools/review/existing',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { projectId, entityId } = request.query || {}

      if (!projectId || !entityId) {
        return reply.status(400).send({ error: 'projectId and entityId are required' })
      }

      const isOwner = await requireProjectOwnership(request, reply, projectId)
      if (!isOwner) return

      const [entity] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.id, entityId), eq(entities.projectId, projectId)))
        .limit(1)

      if (!entity) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      const data = entity.entityData as any
      const lastReview = data?.lastReview

      if (!lastReview) {
        return reply.send({ exists: false })
      }

      return reply.send({
        exists: true,
        review: lastReview.text,
        model: lastReview.model,
        focus: lastReview.focus || null,
        generatedAt: lastReview.generatedAt,
      })
    }
  )

  /**
   * POST /ai-tools/names
   * Generate name suggestions for an entity
   */
  fastify.post<{ Body: { projectId: string; entityId: string; genre?: string } }>(
    '/ai-tools/names',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.id
      const { projectId, entityId, genre } = request.body || {}

      if (!projectId || !entityId) {
        return reply.status(400).send({ error: 'projectId and entityId are required' })
      }

      const isOwner = await requireProjectOwnership(request, reply, projectId)
      if (!isOwner) return

      const bobbin = await getUserAIBobbin(userId)
      const config = bobbin?.config as any
      if (!config?.apiKey) {
        return reply.status(400).send({ error: 'AI tools not configured — add your API key' })
      }

      const [entity] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.id, entityId), eq(entities.projectId, projectId)))
        .limit(1)

      if (!entity) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      const data = entity.entityData as any
      const existingName = data?.name || ''
      const collectionName = entity.collectionName || 'characters'

      try {
        const result = await generateText(
          config.provider as AIProvider,
          config.apiKey,
          config.model || getDefaultModel(config.provider),
          NAMES_SYSTEM_PROMPT,
          buildNamesPrompt(collectionName, existingName, genre)
        )

        const names = result.text
          .trim()
          .split('\n')
          .map((n) => n.trim())
          .filter((n) => n.length > 0)

        return reply.send({
          success: true,
          names,
          model: result.model,
        })
      } catch (error) {
        fastify.log.error({ error, entityId }, 'Name generation failed')
        if (error instanceof ApiError) {
          return reply.status(error.statusCode).send({ error: error.message, code: error.code })
        }
        return reply.status(502).send({
          error: error instanceof Error ? error.message : 'AI generation failed',
        })
      }
    }
  )

  /**
   * POST /ai-tools/brainstorm
   * Brainstorm ideas from a note's content
   */
  fastify.post<{ Body: { projectId: string; entityId: string } }>(
    '/ai-tools/brainstorm',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.id
      const { projectId, entityId } = request.body || {}

      if (!projectId || !entityId) {
        return reply.status(400).send({ error: 'projectId and entityId are required' })
      }

      const isOwner = await requireProjectOwnership(request, reply, projectId)
      if (!isOwner) return

      const bobbin = await getUserAIBobbin(userId)
      const config = bobbin?.config as any
      if (!config?.apiKey) {
        return reply.status(400).send({ error: 'AI tools not configured — add your API key' })
      }

      const [entity] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.id, entityId), eq(entities.projectId, projectId)))
        .limit(1)

      if (!entity) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      const data = entity.entityData as any
      const title = data?.title || 'Untitled'
      const content = data?.content || ''
      const plainContent = stripHtml(content)

      if (plainContent.length < 20) {
        return reply.status(400).send({ error: 'Note needs more content before brainstorming' })
      }

      try {
        const result = await generateText(
          config.provider as AIProvider,
          config.apiKey,
          config.model || getDefaultModel(config.provider),
          BRAINSTORM_SYSTEM_PROMPT,
          buildBrainstormPrompt(title, plainContent)
        )

        return reply.send({
          success: true,
          brainstorm: result.text.trim(),
          model: result.model,
        })
      } catch (error) {
        fastify.log.error({ error, entityId }, 'Brainstorm generation failed')
        if (error instanceof ApiError) {
          return reply.status(error.statusCode).send({ error: error.message, code: error.code })
        }
        return reply.status(502).send({
          error: error instanceof Error ? error.message : 'AI generation failed',
        })
      }
    }
  )

  /**
   * POST /ai-tools/flesh-out
   * Flesh out a timeline event with details, consequences, and story hooks
   */
  fastify.post<{ Body: { projectId: string; entityId: string } }>(
    '/ai-tools/flesh-out',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.user!.id
      const { projectId, entityId } = request.body || {}

      if (!projectId || !entityId) {
        return reply.status(400).send({ error: 'projectId and entityId are required' })
      }

      const isOwner = await requireProjectOwnership(request, reply, projectId)
      if (!isOwner) return

      const bobbin = await getUserAIBobbin(userId)
      const config = bobbin?.config as any
      if (!config?.apiKey) {
        return reply.status(400).send({ error: 'AI tools not configured — add your API key' })
      }

      const [entity] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.id, entityId), eq(entities.projectId, projectId)))
        .limit(1)

      if (!entity) {
        return reply.status(404).send({ error: 'Entity not found' })
      }

      const data = entity.entityData as any
      const title = data?.title || 'Untitled'
      const description = data?.description || ''
      const dateLabel = data?.date_label || ''

      try {
        const result = await generateText(
          config.provider as AIProvider,
          config.apiKey,
          config.model || getDefaultModel(config.provider),
          FLESH_OUT_SYSTEM_PROMPT,
          buildFleshOutPrompt(title, description, dateLabel)
        )

        return reply.send({
          success: true,
          details: result.text.trim(),
          model: result.model,
        })
      } catch (error) {
        fastify.log.error({ error, entityId }, 'Flesh-out generation failed')
        if (error instanceof ApiError) {
          return reply.status(error.statusCode).send({ error: error.message, code: error.code })
        }
        return reply.status(502).send({
          error: error instanceof Error ? error.message : 'AI generation failed',
        })
      }
    }
  )
}

export default aiToolsPlugin
