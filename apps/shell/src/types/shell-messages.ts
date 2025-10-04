/**
 * Unified Shell Message System
 * 
 * All messages between shell and bobbins use this system for type safety
 * and reliable routing.
 */

// ============================================================================
// MESSAGE ENVELOPE
// ============================================================================

/**
 * Standard envelope for all shell-bobbin communication
 * Provides consistent structure for routing and debugging
 */
export interface MessageEnvelope<T = any> {
  /** Message namespace for routing */
  namespace: MessageNamespace
  /** Specific message type */
  type: string
  /** Message payload */
  payload: T
  /** Message metadata */
  metadata: MessageMetadata
}

export type MessageNamespace = 'SHELL' | 'BOBBIN' | 'BUS' | 'DEBUG'

export interface MessageMetadata {
  /** Source identifier (e.g., 'shell', 'bobbin:manuscript') */
  source: string
  /** Target identifier (optional, for directed messages) */
  target?: string
  /** Request ID for request-response pattern */
  requestId?: string
  /** Message timestamp */
  timestamp: number
}

// ============================================================================
// SHELL MESSAGES
// ============================================================================

/**
 * Messages sent from shell to bobbins
 */
export const SHELL_MESSAGES = {
  /** Initial configuration sent when bobbin loads */
  INIT: 'SHELL_INIT',
  /** Request for current shell configuration */
  CONFIG_REQUEST: 'SHELL_CONFIG_REQUEST',
  /** Response to config request */
  CONFIG_RESPONSE: 'SHELL_CONFIG_RESPONSE',
  /** Theme has changed */
  THEME_UPDATE: 'SHELL_THEME_UPDATE',
  /** User permissions have changed */
  PERMISSION_UPDATE: 'SHELL_PERMISSION_UPDATE',
  /** Locale/language has changed */
  LOCALE_UPDATE: 'SHELL_LOCALE_UPDATE',
} as const

export type ShellMessageType = typeof SHELL_MESSAGES[keyof typeof SHELL_MESSAGES]

// ============================================================================
// SHELL CONFIG
// ============================================================================

/**
 * Complete shell configuration sent to bobbins
 * Includes all runtime config bobbins might need
 */
export interface ShellConfig {
  /** Current theme */
  theme: ThemeMode
  /** Current project ID */
  projectId: string
  /** Current user info */
  user: {
    id: string
    name: string
    email?: string
  }
  /** Current locale */
  locale: string
  /** Shell capabilities */
  capabilities: string[]
  /** API endpoints */
  api: {
    baseUrl: string
    wsUrl?: string
  }
}

export type ThemeMode = 'light' | 'dark'

// ============================================================================
// MESSAGE PAYLOADS
// ============================================================================

export interface ShellInitPayload {
  config: ShellConfig
  bobbinId: string
  viewId?: string
}

export interface ShellConfigResponsePayload {
  config: ShellConfig
}

export interface ShellThemeUpdatePayload {
  theme: ThemeMode
}

export interface ShellPermissionUpdatePayload {
  permissions: string[]
}

export interface ShellLocaleUpdatePayload {
  locale: string
}

// ============================================================================
// BUS MESSAGES
// ============================================================================

/**
 * Messages for the message bus system
 */
export const BUS_MESSAGES = {
  /** Event broadcast to all subscribers */
  EVENT: 'BUS_EVENT',
  /** Subscribe to topic */
  SUBSCRIBE: 'BUS_SUBSCRIBE',
  /** Unsubscribe from topic */
  UNSUBSCRIBE: 'BUS_UNSUBSCRIBE',
} as const

export type BusMessageType = typeof BUS_MESSAGES[keyof typeof BUS_MESSAGES]

export interface BusEventPayload {
  topic: string
  data: any
  source: string
}

export interface BusSubscribePayload {
  topic: string
}

// ============================================================================
// DEBUG MESSAGES
// ============================================================================

/**
 * Messages for debugging and development tools
 */
export const DEBUG_MESSAGES = {
  /** Log message */
  LOG: 'DEBUG_LOG',
  /** Warning message */
  WARN: 'DEBUG_WARN',
  /** Error message */
  ERROR: 'DEBUG_ERROR',
} as const

export type DebugMessageType = typeof DEBUG_MESSAGES[keyof typeof DEBUG_MESSAGES]

export interface DebugLogPayload {
  level: 'log' | 'warn' | 'error'
  message: string
  data?: any
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isMessageEnvelope(value: any): value is MessageEnvelope {
  return (
    value &&
    typeof value === 'object' &&
    'namespace' in value &&
    'type' in value &&
    'payload' in value &&
    'metadata' in value
  )
}

export function isShellMessage(envelope: MessageEnvelope): envelope is MessageEnvelope {
  return envelope.namespace === 'SHELL'
}

export function isBusMessage(envelope: MessageEnvelope): envelope is MessageEnvelope {
  return envelope.namespace === 'BUS'
}

export function isDebugMessage(envelope: MessageEnvelope): envelope is MessageEnvelope {
  return envelope.namespace === 'DEBUG'
}

