// Typed message contracts for bobbin communication
export interface BaseBobbinMessage {
  type: string
  requestId?: string
  timestamp: number
}

// View lifecycle messages
export interface ViewReadyMessage extends BaseBobbinMessage {
  type: 'VIEW_READY'
  payload: {
    viewId: string
    bobbinId: string
    capabilities: string[]
  }
}

export interface ViewErrorMessage extends BaseBobbinMessage {
  type: 'VIEW_ERROR'
  payload: {
    error: string
    stack?: string
    recoverable: boolean
  }
}

export interface ViewScriptLoadedMessage extends BaseBobbinMessage {
  type: 'VIEW_SCRIPT_LOADED'
  payload: Record<string, never>
}

export interface InitContextMessage extends BaseBobbinMessage {
  type: 'INIT_CONTEXT'
  payload: {
    projectId: string
    bobbinId: string
    viewId: string
    apiBaseUrl: string
    theme?: Theme
    permissions: string[]
  }
}

// Entity operations
export interface EntityQueryMessage extends BaseBobbinMessage {
  type: 'ENTITY_QUERY'
  requestId: string
  payload: {
    collection: string
    filters?: Record<string, any>
    sort?: { field: string; direction: 'asc' | 'desc' }[]
    limit?: number
    offset?: number
  }
}

export interface EntityCreateMessage extends BaseBobbinMessage {
  type: 'ENTITY_CREATE'
  requestId: string
  payload: {
    collection: string
    data: Record<string, any>
    validate?: boolean
  }
}

export interface EntityUpdateMessage extends BaseBobbinMessage {
  type: 'ENTITY_UPDATE'
  requestId: string
  payload: {
    collection: string
    id: string
    data: Record<string, any>
    validate?: boolean
  }
}

export interface EntityDeleteMessage extends BaseBobbinMessage {
  type: 'ENTITY_DELETE'
  requestId: string
  payload: {
    collection: string
    id: string
  }
}

// Batch operations for performance
export interface BatchOperationMessage extends BaseBobbinMessage {
  type: 'BATCH_OPERATION'
  requestId: string
  payload: {
    operations: Array<{
      type: 'create' | 'update' | 'delete'
      collection: string
      id?: string
      data?: Record<string, any>
    }>
    atomic?: boolean // All succeed or all fail
  }
}

// API responses
export interface ApiResponseMessage extends BaseBobbinMessage {
  type: 'API_RESPONSE'
  requestId: string
  payload: {
    success: boolean
    data?: any
    error?: string
    statusCode?: number
  }
}

// Custom action messages (for manifest-defined actions)
export interface CustomActionMessage extends BaseBobbinMessage {
  type: 'CUSTOM_ACTION'
  requestId: string
  payload: {
    actionId: string
    params: Record<string, any>
    context?: {
      userId?: string
      projectId?: string
      entityId?: string
    }
  }
}

// System messages
export interface ThemeUpdateMessage extends BaseBobbinMessage {
  type: 'THEME_UPDATE'
  payload: {
    theme: Theme
  }
}

export interface PermissionUpdateMessage extends BaseBobbinMessage {
  type: 'PERMISSION_UPDATE'
  payload: {
    permissions: string[]
  }
}

// Union type for all possible messages
export type BobbinMessage =
  | ViewScriptLoadedMessage
  | ViewReadyMessage
  | ViewErrorMessage
  | InitContextMessage
  | EntityQueryMessage
  | EntityCreateMessage
  | EntityUpdateMessage
  | EntityDeleteMessage
  | BatchOperationMessage
  | CustomActionMessage
  | ApiResponseMessage
  | ThemeUpdateMessage
  | PermissionUpdateMessage

// Theme interface
export interface Theme {
  mode: 'light' | 'dark'
  colors: {
    primary: string
    secondary: string
    background: string
    surface: string
    text: string
    textSecondary: string
    border: string
    error: string
    warning: string
    success: string
  }
  typography: {
    fontFamily: string
    fontSize: {
      xs: string
      sm: string
      base: string
      lg: string
      xl: string
    }
  }
}

// Message validation schemas (for runtime type checking)
export const MessageSchemas = {
  VIEW_READY: {
    required: ['payload'],
    payload: {
      required: ['viewId', 'bobbinId', 'capabilities'],
      properties: {
        viewId: { type: 'string' },
        bobbinId: { type: 'string' },
        capabilities: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  ENTITY_QUERY: {
    required: ['requestId', 'payload'],
    payload: {
      required: ['collection'],
      properties: {
        collection: { type: 'string' },
        filters: { type: 'object' },
        sort: { type: 'array' },
        limit: { type: 'number' },
        offset: { type: 'number' }
      }
    }
  }
  // Add more schemas as needed
}