// Action Runtime SDK - P1 implementation stubs
// This will be expanded to support sandboxed action execution

export interface ActionContext {
  actionId: string
  bobbinId: string
  entityRef?: string
  parameters: Record<string, unknown>
  permissions: string[]
}

export interface ActionResult {
  success: boolean
  data?: unknown
  error?: string
}

/**
 * Stub for sandboxed action execution
 * Will be expanded to support workflows and external connectors
 */
export class ActionRuntime {
  constructor(private context: ActionContext) {}

  async execute(): Promise<ActionResult> {
    // P1: Stub implementation
    return {
      success: true,
      data: { message: 'Action runtime not yet implemented' }
    }
  }

  hasPermission(permission: string): boolean {
    return this.context.permissions.includes(permission)
  }
}

export function createActionRuntime(context: ActionContext): ActionRuntime {
  return new ActionRuntime(context)
}