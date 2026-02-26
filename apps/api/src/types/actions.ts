/**
 * Bobbin Action Handler Types
 */

import { FastifyInstance } from 'fastify'

export interface ActionResult {
  success: boolean
  data?: unknown
  error?: string
}

export interface ActionContext {
  projectId: string
  userId?: string
  bobbinId: string
}

export type ActionHandler = (
  params: Record<string, unknown>,
  context: ActionContext,
  fastify: FastifyInstance
) => Promise<ActionResult>
