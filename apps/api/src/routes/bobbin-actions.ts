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
import { and, eq } from 'drizzle-orm'
import type { ActionContext, ActionHandler, ActionModule, ActionResult } from '@bobbinry/action-runtime'
import { createActionRuntime } from '@bobbinry/action-runtime'
import { db } from '../db/connection'
import { bobbinsInstalled } from '../db/schema'
import { requireAuth, requireProjectOwnership } from '../middleware/auth'
import { getDeclaredCustomAction, isValidActionId, isValidBobbinId } from '../lib/bobbin-actions'
import { loadDiskManifests } from '../lib/disk-manifests'

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
  }>('/bobbins/:bobbinId/actions/:actionId', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const { bobbinId, actionId } = request.params
      const { params, context } = request.body

      if (!isValidBobbinId(bobbinId) || !isValidActionId(actionId)) {
        return reply.status(400).send({
          error: 'Invalid bobbin or action identifier'
        })
      }

      // Validate context
      if (!context.projectId) {
        return reply.status(400).send({
          error: 'Missing required context: projectId'
        })
      }

      // Verify the authenticated user owns this project
      const hasAccess = await requireProjectOwnership(request, reply, context.projectId)
      if (!hasAccess) return

      const [installedBobbin] = await db
        .select({
          bobbinId: bobbinsInstalled.bobbinId
        })
        .from(bobbinsInstalled)
        .where(and(
          eq(bobbinsInstalled.projectId, context.projectId),
          eq(bobbinsInstalled.bobbinId, bobbinId),
          eq(bobbinsInstalled.enabled, true)
        ))
        .limit(1)

      if (!installedBobbin) {
        return reply.status(404).send({
          error: `Bobbin '${bobbinId}' is not installed for this project`
        })
      }

      const manifest = (await loadDiskManifests([bobbinId])).get(bobbinId)
      if (!manifest) {
        return reply.status(404).send({
          error: `Bobbin '${bobbinId}' manifest is unavailable on this server`
        })
      }

      const declaredAction = getDeclaredCustomAction(manifest, actionId)
      if (!declaredAction) {
        return reply.status(404).send({
          error: `Action '${actionId}' is not declared as a custom action in bobbin '${bobbinId}'`
        })
      }

      fastify.log.info({ bobbinId, actionId, context }, 'Invoking bobbin action')

      // Dynamically load bobbin's action handlers
      let bobbinActionModule: ActionModule
      try {
        bobbinActionModule = await import(`../../../../bobbins/${bobbinId}/actions`)
      } catch (importError) {
        fastify.log.error({ error: importError, bobbinId }, 'Failed to load bobbin actions')
        return reply.status(404).send({
          error: `Bobbin '${bobbinId}' not found or has no actions`
        })
      }

      const namedHandler = bobbinActionModule[declaredAction.handler]
      const registryHandler = bobbinActionModule.actions?.[actionId]
      const handler =
        (typeof namedHandler === 'function' ? namedHandler : undefined)
        ?? (typeof registryHandler === 'function' ? registryHandler : undefined)

      if (!handler) {
        fastify.log.error(
          { bobbinId, actionId, handler: declaredAction.handler },
          'Declared bobbin action handler is missing from module exports'
        )
        return reply.status(500).send({
          error: `Action '${actionId}' in bobbin '${bobbinId}' is misconfigured`
        })
      }

      // Build full action context
      const fullContext: ActionContext = {
        projectId: context.projectId,
        bobbinId,
        actionId,
        ...(context.viewId && { viewId: context.viewId }),
        userId: request.user!.id,
        ...(context.entityId && { entityId: context.entityId })
      }

      const runtime = createActionRuntime({
        log: fastify.log,
        permissions: []
      })

      // Invoke the action handler
      const result: ActionResult = await (handler as ActionHandler)(
        (params || {}) as Record<string, unknown>,
        fullContext,
        runtime
      )

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
