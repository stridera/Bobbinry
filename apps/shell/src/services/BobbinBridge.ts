import { BobbinrySDK } from '@bobbinry/sdk'
import {
  BobbinMessage,
  ApiResponseMessage,
  EntityQueryMessage,
  EntityCreateMessage,
  EntityUpdateMessage,
  EntityDeleteMessage,
  BatchOperationMessage,
  InitContextMessage,
  ThemeUpdateMessage,
  Theme,
  MessageSchemas
} from '../types/bobbin-messages'

// Enhanced error handling
export class BobbinError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true,
    public statusCode?: number
  ) {
    super(message)
    this.name = 'BobbinError'
  }
}

// Message validation
export class MessageValidator {
  static validate(message: BobbinMessage): boolean {
    try {
      // Basic structure validation
      if (!message.type || !message.timestamp) {
        return false
      }

      // Type-specific validation
      const schema = MessageSchemas[message.type as keyof typeof MessageSchemas]
      if (schema) {
        return this.validateSchema(message, schema)
      }

      return true
    } catch {
      return false
    }
  }

  private static validateSchema(obj: any, schema: any): boolean {
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in obj)) return false
      }
    }

    if (schema.payload && obj.payload) {
      return this.validateSchema(obj.payload, schema.payload)
    }

    return true
  }
}

// Enhanced BobbinBridge with better typing and performance
export class BobbinBridge {
  private messageHandlers = new Map<string, (message: BobbinMessage) => Promise<void>>()
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void
    reject: (error: Error) => void
    timestamp: number
    timeout: NodeJS.Timeout
  }>()
  private requestIdCounter = 0
  private batchQueue: Array<{
    message: BobbinMessage
    resolve: (value: any) => void
    reject: (error: Error) => void
  }> = []
  private batchTimeout: NodeJS.Timeout | null = null

  constructor(
    private iframe: HTMLIFrameElement,
    private sdk: BobbinrySDK,
    private projectId: string,
    private bobbinId: string,
    private viewId: string
  ) {
    this.setupMessageHandling()
    this.startRequestCleanup()
  }
  // Public method to initialize context - call this when iframe is ready
  async initializeContext() {
    try {
      // Check if iframe contentWindow is available
      if (!this.iframe.contentWindow) {
        throw new Error('Iframe contentWindow not available')
      }

      console.log('🔧 Preparing INIT_CONTEXT message...')
      const message = {
        type: 'INIT_CONTEXT',
        timestamp: Date.now(),
        payload: {
          projectId: this.projectId,
          bobbinId: this.bobbinId,
          viewId: this.viewId,
          apiBaseUrl: process.env.NODE_ENV === 'development' ? 'http://localhost:4000' : '',
          theme: this.getCurrentTheme(),
          permissions: ['read', 'write', 'create', 'delete'] // TODO: Get from user/project settings
        }
      } as InitContextMessage

      console.log('🔧 INIT_CONTEXT message prepared:', message)
      await this.sendMessage(message)
      console.log('📤 INIT_CONTEXT sent to iframe')
    } catch (error) {
      console.error('Failed to send INIT_CONTEXT:', error)
      throw error
    }
  }

  private setupMessageHandling() {
    const handleMessage = (event: MessageEvent) => {
      // Security: Only handle messages from our iframe
      if (event.source !== this.iframe.contentWindow) {
        return
      }

      try {
        const message: BobbinMessage = event.data

        // Validate message structure
        if (!MessageValidator.validate(message)) {
          console.warn('Invalid message received:', message)
          return
        }

        this.handleMessage(message)
      } catch (error) {
        console.error('Error handling bobbin message:', error)
      }
    }

    window.addEventListener('message', handleMessage)

    // Store cleanup function for later
    this.cleanup = () => {
      window.removeEventListener('message', handleMessage)
      this.clearAllPendingRequests()
      if (this.batchTimeout) {
        clearTimeout(this.batchTimeout)
      }
    }
  }

  private cleanup: (() => void) | null = null

  private async handleMessage(message: BobbinMessage) {
    switch (message.type) {
      case 'VIEW_READY':
        await this.handleViewReady()
        break

      case 'ENTITY_QUERY':
        await this.handleEntityQuery(message as EntityQueryMessage)
        break

      case 'ENTITY_CREATE':
        await this.handleEntityCreate(message as EntityCreateMessage)
        break

      case 'ENTITY_UPDATE':
        await this.handleEntityUpdate(message as EntityUpdateMessage)
        break

      case 'ENTITY_DELETE':
        await this.handleEntityDelete(message as EntityDeleteMessage)
        break

      case 'BATCH_OPERATION':
        await this.handleBatchOperation(message as BatchOperationMessage)
        break

      case 'API_RESPONSE':
        this.handleApiResponse(message as ApiResponseMessage)
        break

      default:
        console.log('Unhandled message type:', message.type)
    }
  }

  private async handleViewReady() {
    // View is ready, no need to send INIT_CONTEXT again
    // The context should have already been sent via initializeContext()
    console.log('View confirmed ready')
  }

  private async handleEntityQuery(message: EntityQueryMessage) {
    try {
      const { collection, filters, sort, limit, offset } = message.payload

      // Use SDK for entity queries
      const result = await this.sdk.entities.query({
        collection,
        filters,
        sort,
        limit,
        offset
      })

      this.sendResponse(message.requestId, { success: true, data: result })
    } catch (error) {
      this.sendErrorResponse(message.requestId, error as Error)
    }
  }

  private async handleEntityCreate(message: EntityCreateMessage) {
    try {
      const { collection, data } = message.payload

      const result = await this.sdk.entities.create(collection, {
        ...data,
        projectId: this.projectId
      })

      this.sendResponse(message.requestId, { success: true, data: result })
    } catch (error) {
      this.sendErrorResponse(message.requestId, error as Error)
    }
  }

  private async handleEntityUpdate(message: EntityUpdateMessage) {
    try {
      const { collection, id, data } = message.payload

      const result = await this.sdk.entities.update(collection, id, {
        ...data,
        projectId: this.projectId
      })

      this.sendResponse(message.requestId, { success: true, data: result })
    } catch (error) {
      this.sendErrorResponse(message.requestId, error as Error)
    }
  }

  private async handleEntityDelete(message: EntityDeleteMessage) {
    try {
      const { collection, id } = message.payload

      await this.sdk.entities.delete(collection, id)

      this.sendResponse(message.requestId, { success: true, data: { deleted: true, id } })
    } catch (error) {
      this.sendErrorResponse(message.requestId, error as Error)
    }
  }

  private async handleBatchOperation(message: BatchOperationMessage) {
    try {
      const { operations, atomic = false } = message.payload

      if (atomic) {
        // TODO: Implement atomic batch operations when database supports transactions
        throw new BobbinError('Atomic batch operations not yet supported', 'NOT_IMPLEMENTED')
      }

      const results = []
      for (const operation of operations) {
        try {
          let result
          switch (operation.type) {
            case 'create':
              result = await this.sdk.entities.create(operation.collection, {
                ...operation.data,
                projectId: this.projectId
              })
              break
            case 'update':
              if (!operation.id) throw new Error('Update operation requires id')
              result = await this.sdk.entities.update(operation.collection, operation.id, {
                ...operation.data,
                projectId: this.projectId
              })
              break
            case 'delete':
              if (!operation.id) throw new Error('Delete operation requires id')
              await this.sdk.entities.delete(operation.collection, operation.id)
              result = { deleted: true, id: operation.id }
              break
            default:
              throw new Error(`Unknown operation type: ${operation.type}`)
          }
          results.push({ success: true, data: result })
        } catch (error) {
          results.push({ success: false, error: (error as Error).message })
        }
      }

      this.sendResponse(message.requestId, { success: true, data: results })
    } catch (error) {
      this.sendErrorResponse(message.requestId, error as Error)
    }
  }

  private handleApiResponse(message: ApiResponseMessage) {
    const pendingRequest = this.pendingRequests.get(message.requestId)
    if (pendingRequest) {
      clearTimeout(pendingRequest.timeout)
      this.pendingRequests.delete(message.requestId)

      if (message.payload.success) {
        pendingRequest.resolve(message.payload.data)
      } else {
        pendingRequest.reject(new BobbinError(
          message.payload.error || 'Unknown error',
          'API_ERROR',
          true,
          message.payload.statusCode
        ))
      }
    }
  }

  private sendResponse(requestId: string, payload: any) {
    this.sendMessage({
      type: 'API_RESPONSE',
      requestId,
      timestamp: Date.now(),
      payload
    } as ApiResponseMessage)
  }

  private sendErrorResponse(requestId: string, error: Error) {
    this.sendResponse(requestId, {
      success: false,
      error: error.message,
      statusCode: error instanceof BobbinError ? error.statusCode : 500
    })
  }

  // Public API for sending messages
  public async sendMessage(message: BobbinMessage): Promise<void> {
    if (!this.iframe.contentWindow) {
      throw new BobbinError('Iframe not ready', 'IFRAME_NOT_READY')
    }

    try {
      this.iframe.contentWindow.postMessage(message, '*')
    } catch (error) {
      throw new BobbinError('Failed to send message', 'MESSAGE_SEND_FAILED')
    }
  }

  // Enhanced theme management
  public async updateTheme(theme: Theme) {
    await this.sendMessage({
      type: 'THEME_UPDATE',
      timestamp: Date.now(),
      payload: { theme }
    } as ThemeUpdateMessage)
  }

  private getCurrentTheme(): Theme {
    // TODO: Get theme from theme provider/context
    return {
      mode: 'light',
      colors: {
        primary: '#3b82f6',
        secondary: '#6b7280',
        background: '#ffffff',
        surface: '#f9fafb',
        text: '#111827',
        textSecondary: '#6b7280',
        border: '#e5e7eb',
        error: '#ef4444',
        warning: '#f59e0b',
        success: '#10b981'
      },
      typography: {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif',
        fontSize: {
          xs: '0.75rem',
          sm: '0.875rem',
          base: '1rem',
          lg: '1.125rem',
          xl: '1.25rem'
        }
      }
    }
  }

  // Request cleanup to prevent memory leaks
  private startRequestCleanup() {
    setInterval(() => {
      const now = Date.now()
      for (const [requestId, request] of this.pendingRequests.entries()) {
        if (now - request.timestamp > 30000) { // 30 second timeout
          clearTimeout(request.timeout)
          this.pendingRequests.delete(requestId)
          request.reject(new BobbinError('Request timeout', 'TIMEOUT', false))
        }
      }
    }, 10000) // Check every 10 seconds
  }

  private clearAllPendingRequests() {
    for (const request of this.pendingRequests.values()) {
      clearTimeout(request.timeout)
      request.reject(new BobbinError('Bridge destroyed', 'DESTROYED', false))
    }
    this.pendingRequests.clear()
  }

  public destroy() {
    if (this.cleanup) {
      this.cleanup()
    }
  }
}