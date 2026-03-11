export interface ActionContext {
  projectId: string
  bobbinId: string
  actionId: string
  viewId?: string
  userId?: string
  entityId?: string
}

export interface ActionResult {
  success: boolean
  data?: unknown
  error?: string
}

export interface ActionLogFn {
  (payload: unknown, message?: string): void
}

export interface ActionLogger {
  info: ActionLogFn
  warn: ActionLogFn
  error: ActionLogFn
}

export interface ActionRuntimeHost {
  log: ActionLogger
  hasPermission(permission: string): boolean
}

export type ActionHandler<TParams extends Record<string, unknown> = Record<string, unknown>> = (
  params: TParams,
  context: ActionContext,
  runtime: ActionRuntimeHost
) => Promise<ActionResult>

export interface ActionModule {
  actions?: Record<string, ActionHandler>
  [handlerName: string]: unknown
}

class NoopLogger implements ActionLogger {
  info(): void {}
  warn(): void {}
  error(): void {}
}

export class ActionRuntime implements ActionRuntimeHost {
  readonly log: ActionLogger
  private readonly permissions: Set<string>

  constructor(options: { permissions?: string[]; log?: ActionLogger } = {}) {
    this.permissions = new Set(options.permissions ?? [])
    this.log = options.log ?? new NoopLogger()
  }

  hasPermission(permission: string): boolean {
    return this.permissions.has(permission)
  }
}

export function createActionRuntime(options?: { permissions?: string[]; log?: ActionLogger }): ActionRuntime {
  return new ActionRuntime(options)
}
