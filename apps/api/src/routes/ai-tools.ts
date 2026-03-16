/**
 * AI Tools Routes (User-Scoped)
 *
 * Handles AI config storage, synopsis generation, and review feedback.
 * Config stored in user_bobbins_installed, provenance logged on synopsis save.
 */

import { FastifyPluginAsync } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/connection'
import { entities, userBobbinsInstalled, provenanceEvents } from '../db/schema'
import { requireAuth, requireProjectOwnership } from '../middleware/auth'

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
    if (response.status === 401) throw new Error('Invalid API key')
    if (response.status === 429) throw new Error('Rate limit exceeded — try again in a moment')
    throw new Error(`Anthropic API error (${response.status}): ${errBody}`)
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
    if (response.status === 401) throw new Error('Invalid API key')
    if (response.status === 429) throw new Error('Rate limit exceeded — try again in a moment')
    throw new Error(`OpenAI API error (${response.status}): ${errBody}`)
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

// --- Prompts ---

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

const REVIEW_SYSTEM_PROMPT = `You are a thoughtful beta reader providing structured feedback on a chapter of fiction. You analyze — you do not rewrite or generate content.

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

Rules:
- Be honest but constructive
- Cite specific passages when possible
- Never rewrite sentences for the author
- Focus on craft observations, not plot preferences
- Respect the author's voice and style`

function buildReviewPrompt(title: string, bodyText: string): string {
  const truncated = bodyText.length > 12000 ? bodyText.slice(0, 12000) + '\n\n[Content truncated]' : bodyText
  return `Please provide structured feedback on this chapter.\n\nTitle: ${title}\n\nContent:\n${truncated}`
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
   * Generate structured review for an entity (ephemeral, no save)
   */
  fastify.post<{ Body: { projectId: string; entityId: string } }>(
    '/ai-tools/review',
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

      if (plainText.length < 100) {
        return reply.status(400).send({ error: 'Chapter needs more content before generating a review' })
      }

      try {
        const result = await generateText(
          config.provider as AIProvider,
          config.apiKey,
          config.model || getDefaultModel(config.provider),
          REVIEW_SYSTEM_PROMPT,
          buildReviewPrompt(title, plainText)
        )

        return reply.send({
          success: true,
          review: result.text.trim(),
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        })
      } catch (error) {
        fastify.log.error({ error, entityId }, 'Review generation failed')
        return reply.status(502).send({
          error: error instanceof Error ? error.message : 'AI generation failed',
        })
      }
    }
  )
}

export default aiToolsPlugin
