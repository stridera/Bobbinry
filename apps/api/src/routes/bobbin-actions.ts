/**
 * Bobbin Actions API
 *
 * This endpoint provides a thin wrapper that invokes bobbin action handlers
 * via the message bus architecture. Bobbins define custom actions in their
 * manifests, and implement handlers in their actions directory.
 *
 * Message Flow:
 * View → CUSTOM_ACTION message → BobbinBridge →
 * POST /api/bobbins/{id}/actions/{action} → Bobbin handler → Result
 */

import { FastifyPluginAsync } from 'fastify'

// Types for bobbin action handlers (replicated here to avoid cross-package imports)
interface ActionContext {
  projectId: string
  bobbinId: string
  viewId?: string
  userId?: string
  entityId?: string
}

import type { ActionResult, ActionHandler } from '../types/actions'

const bobbinActionsPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * Invoke a bobbin's custom action
   * POST /bobbins/:bobbinId/actions/:actionId
   */
  fastify.post<{
    Params: {
      bobbinId: string
      actionId: string
    }
    Body: {
      params: Record<string, any>
      context: Partial<ActionContext>
    }
  }>('/bobbins/:bobbinId/actions/:actionId', async (request, reply) => {
    try {
      const { bobbinId, actionId } = request.params
      const { params, context } = request.body

      fastify.log.info({ bobbinId, actionId, context }, 'Invoking bobbin action')

      // Dynamically load bobbin's action handlers
      let actions: Record<string, ActionHandler>
      try {
        const bobbinActions = await import(`../../../../bobbins/${bobbinId}/actions`)
        actions = bobbinActions.actions
      } catch (importError) {
        fastify.log.error({ error: importError, bobbinId }, 'Failed to load bobbin actions')
        return reply.status(404).send({
          error: `Bobbin '${bobbinId}' not found or has no actions`
        })
      }

      // Get the specific action handler
      const handler = actions[actionId]
      if (!handler) {
        return reply.status(404).send({
          error: `Action '${actionId}' not found in bobbin '${bobbinId}'`
        })
      }

      // Validate context
      if (!context.projectId) {
        return reply.status(400).send({
          error: 'Missing required context: projectId'
        })
      }

      // Build full action context
      const fullContext: ActionContext = {
        projectId: context.projectId,
        bobbinId,
        ...(context.viewId && { viewId: context.viewId }),
        ...(context.userId && { userId: context.userId }),
        ...(context.entityId && { entityId: context.entityId })
      }

      // Invoke the action handler
      const result: ActionResult = await handler(params, fullContext, fastify)

      // Return the result
      if (result.success) {
        return reply.status(200).send(result)
      } else {
        return reply.status(500).send(result)
      }
    } catch (error) {
      fastify.log.error({ error }, 'Bobbin action execution failed')
      return reply.status(500).send({
        error: 'Action execution failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  })
}

export default bobbinActionsPlugin
