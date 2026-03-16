import type { ActionContext, ActionResult, ActionRuntimeHost } from '@bobbinry/action-runtime'
import { AIClient, type AIProvider } from './ai-service'
import {
  SYNOPSIS_SYSTEM_PROMPT,
  buildSynopsisUserPrompt,
  REVIEW_SYSTEM_PROMPT,
  buildReviewUserPrompt,
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

    if (!body || body.replace(/<[^>]*>/g, '').trim().length < 50) {
      return { success: false, error: 'Chapter needs more content before generating a synopsis' }
    }

    const plainText = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
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

    if (!body || body.replace(/<[^>]*>/g, '').trim().length < 100) {
      return { success: false, error: 'Chapter needs more content before generating a review' }
    }

    const plainText = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    const client = buildClient(bobbin.config)

    const result = await client.generateText(
      REVIEW_SYSTEM_PROMPT,
      buildReviewUserPrompt(title, plainText)
    )

    return {
      success: true,
      data: {
        review: result.text.trim(),
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    }
  } catch (error) {
    runtime.log.error({ error }, 'generateReview failed')
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
  test_api_key: testApiKey,
}
