export interface DeclaredCustomAction {
  id: string
  handler: string
}

const BOBBIN_ID_PATTERN = /^[a-z][a-z0-9-]*$/
const ACTION_ID_PATTERN = /^[a-z][a-z0-9_-]*$/
const HANDLER_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export function isValidBobbinId(value: string): boolean {
  return BOBBIN_ID_PATTERN.test(value)
}

export function isValidActionId(value: string): boolean {
  return ACTION_ID_PATTERN.test(value)
}

export function isValidActionHandlerName(value: string): boolean {
  return HANDLER_NAME_PATTERN.test(value)
}

export function getDeclaredCustomAction(
  manifest: Record<string, unknown> | null | undefined,
  actionId: string
): DeclaredCustomAction | null {
  const actions = Array.isArray((manifest as any)?.interactions?.actions)
    ? (manifest as any).interactions.actions
    : []

  const match = actions.find((action: any) => action?.id === actionId && action?.type === 'custom')
  if (!match || !isValidActionHandlerName(String(match.handler || ''))) {
    return null
  }

  return {
    id: String(match.id),
    handler: String(match.handler)
  }
}
