import type { ActionContext, ActionResult, ActionRuntimeHost } from '@bobbinry/action-runtime'
import { AIClient, type AIProvider } from './ai-service'
import {
  SYNOPSIS_SYSTEM_PROMPT,
  buildSynopsisUserPrompt,
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
  NAMES_SYSTEM_PROMPT,
  buildNamesUserPrompt,
  BRAINSTORM_SYSTEM_PROMPT,
  buildBrainstormUserPrompt,
  FLESH_OUT_SYSTEM_PROMPT,
  buildFleshOutUserPrompt,
} from './prompts'

/**
 * Lazy DB imports to avoid resolver conflicts.
 * The API compiles this with its own Drizzle instance.
 */
async function createDbCallbacks() {
  const { db } = await import('../../../apps/api/src/db/connection')
  const { entities, userBobbinsInstalled, provenanceEvents } = await import(
    '../../../apps/api/src/db/schema'
  )
  const { eq, and } = await import('drizzle-orm')

  return { db, entities, userBobbinsInstalled, provenanceEvents, eq, and }
}

/** Fetch the user's AI config from user_bobbins_installed */
async function getUserAIConfig(userId: string) {
  const { db, userBobbinsInstalled, eq, and } = await createDbCallbacks()

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

/** Build an AIClient from user config */
function buildClient(config: any): AIClient {
  return new AIClient({
    provider: config.provider as AIProvider,
    apiKey: config.apiKey,
    model: config.model,
  })
}

/** Strip HTML tags to plain text */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function generateSynopsis(
  params: { entityId: string; projectId: string },
  context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const bobbin = await getUserAIConfig(context.userId)
    if (!bobbin?.config || !(bobbin.config as any).apiKey) {
      return { success: false, error: 'AI tools not configured — add your API key in settings' }
    }

    const { db, entities, eq } = await createDbCallbacks()
    const [entity] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, params.entityId))
      .limit(1)

    if (!entity) {
      return { success: false, error: 'Entity not found' }
    }

    const data = entity.entityData as any
    const title = data?.title || 'Untitled'
    const body = data?.body || ''

    if (!body || stripHtml(body).length < 50) {
      return { success: false, error: 'Chapter needs more content before generating a synopsis' }
    }

    const plainText = stripHtml(body)
    const client = buildClient(bobbin.config)

    const result = await client.generateText(
      SYNOPSIS_SYSTEM_PROMPT,
      buildSynopsisUserPrompt(title, plainText)
    )

    return {
      success: true,
      data: {
        synopsis: result.text.trim(),
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    }
  } catch (error) {
    runtime.log.error({ error }, 'generateSynopsis failed')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function generateReview(
  params: { entityId: string; projectId: string; focus?: string },
  context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const bobbin = await getUserAIConfig(context.userId)
    if (!bobbin?.config || !(bobbin.config as any).apiKey) {
      return { success: false, error: 'AI tools not configured — add your API key in settings' }
    }

    const { db, entities, eq } = await createDbCallbacks()
    const [entity] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, params.entityId))
      .limit(1)

    if (!entity) {
      return { success: false, error: 'Entity not found' }
    }

    const data = entity.entityData as any
    const title = data?.title || 'Untitled'
    const body = data?.body || ''

    if (!body || stripHtml(body).length < 100) {
      return { success: false, error: 'Chapter needs more content before generating a review' }
    }

    const plainText = stripHtml(body)
    const client = buildClient(bobbin.config)

    const result = await client.generateText(
      buildReviewSystemPrompt(params.focus),
      buildReviewUserPrompt(title, plainText, params.focus)
    )

    // Auto-save to entityData.lastReview
    const { provenanceEvents } = await createDbCallbacks()
    const generatedAt = new Date().toISOString()

    // Re-fetch to avoid stale data
    const [freshEntity] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, params.entityId))
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
              focus: params.focus?.trim() || null,
              generatedAt,
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(entities.id, params.entityId))

      await db.insert(provenanceEvents).values({
        projectId: params.projectId,
        entityRef: `${params.projectId}:manuscript:content:${params.entityId}`,
        actor: context.userId,
        action: 'ai_assist',
        metaJson: {
          type: 'review_save',
          aiModel: result.model,
          focus: params.focus?.trim() || null,
          bobbinId: 'ai-tools',
        },
      })
    }

    return {
      success: true,
      data: {
        review: result.text.trim(),
        model: result.model,
        focus: params.focus?.trim() || null,
        generatedAt,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    }
  } catch (error) {
    runtime.log.error({ error }, 'generateReview failed')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function generateNames(
  params: { entityId: string; projectId: string; genre?: string },
  context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const bobbin = await getUserAIConfig(context.userId)
    if (!bobbin?.config || !(bobbin.config as any).apiKey) {
      return { success: false, error: 'AI tools not configured — add your API key in settings' }
    }

    const { db, entities, eq } = await createDbCallbacks()
    const [entity] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, params.entityId))
      .limit(1)

    if (!entity) {
      return { success: false, error: 'Entity not found' }
    }

    const data = entity.entityData as any
    const existingName = data?.name || ''
    const collectionName = entity.collectionName || 'characters'

    const client = buildClient(bobbin.config)

    const result = await client.generateText(
      NAMES_SYSTEM_PROMPT,
      buildNamesUserPrompt(collectionName, existingName, params.genre)
    )

    const names = result.text
      .trim()
      .split('\n')
      .map((n) => n.trim())
      .filter((n) => n.length > 0)

    return {
      success: true,
      data: { names, model: result.model },
    }
  } catch (error) {
    runtime.log.error({ error }, 'generateNames failed')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function generateBrainstorm(
  params: { entityId: string; projectId: string },
  context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const bobbin = await getUserAIConfig(context.userId)
    if (!bobbin?.config || !(bobbin.config as any).apiKey) {
      return { success: false, error: 'AI tools not configured — add your API key in settings' }
    }

    const { db, entities, eq } = await createDbCallbacks()
    const [entity] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, params.entityId))
      .limit(1)

    if (!entity) {
      return { success: false, error: 'Entity not found' }
    }

    const data = entity.entityData as any
    const title = data?.title || 'Untitled'
    const content = data?.content || ''
    const plainContent = stripHtml(content)

    if (plainContent.length < 20) {
      return { success: false, error: 'Note needs more content before brainstorming' }
    }

    const client = buildClient(bobbin.config)

    const result = await client.generateText(
      BRAINSTORM_SYSTEM_PROMPT,
      buildBrainstormUserPrompt(title, plainContent)
    )

    return {
      success: true,
      data: { brainstorm: result.text.trim(), model: result.model },
    }
  } catch (error) {
    runtime.log.error({ error }, 'generateBrainstorm failed')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function generateFleshOut(
  params: { entityId: string; projectId: string },
  context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const bobbin = await getUserAIConfig(context.userId)
    if (!bobbin?.config || !(bobbin.config as any).apiKey) {
      return { success: false, error: 'AI tools not configured — add your API key in settings' }
    }

    const { db, entities, eq } = await createDbCallbacks()
    const [entity] = await db
      .select()
      .from(entities)
      .where(eq(entities.id, params.entityId))
      .limit(1)

    if (!entity) {
      return { success: false, error: 'Entity not found' }
    }

    const data = entity.entityData as any
    const title = data?.title || 'Untitled'
    const description = data?.description || ''
    const dateLabel = data?.date_label || ''

    const client = buildClient(bobbin.config)

    const result = await client.generateText(
      FLESH_OUT_SYSTEM_PROMPT,
      buildFleshOutUserPrompt(title, description, dateLabel)
    )

    return {
      success: true,
      data: { details: result.text.trim(), model: result.model },
    }
  } catch (error) {
    runtime.log.error({ error }, 'generateFleshOut failed')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function testApiKey(
  params: { provider: AIProvider; apiKey: string; model?: string },
  _context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const client = new AIClient({
      provider: params.provider,
      apiKey: params.apiKey,
      model: params.model || '',
    })

    const result = await client.testConnection()
    return { success: result.success, error: result.error }
  } catch (error) {
    runtime.log.error({ error }, 'testApiKey failed')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export const actions = {
  generate_synopsis: generateSynopsis,
  generate_review: generateReview,
  generate_names: generateNames,
  generate_brainstorm: generateBrainstorm,
  generate_flesh_out: generateFleshOut,
  test_api_key: testApiKey,
}
