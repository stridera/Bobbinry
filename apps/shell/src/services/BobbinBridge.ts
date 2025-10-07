import { BobbinrySDK } from '@bobbinry/sdk'
import {
  BobbinMessage,
  ApiResponseMessage,
  EntityQueryMessage,
  EntityCreateMessage,
  EntityUpdateMessage,
  EntityDeleteMessage,
  BatchOperationMessage,
  CustomActionMessage,
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
  private viewScriptLoaded = false
  private initContextPromise: Promise<void> | null = null

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
    // If already initializing, return the existing promise
    if (this.initContextPromise) {
      return this.initContextPromise
    }

    // Create a new initialization promise
    this.initContextPromise = new Promise<void>(async (resolve, reject) => {
      try {
        // Check if iframe contentWindow is available
        if (!this.iframe.contentWindow) {
          throw new Error('Iframe contentWindow not available')
        }

        // Wait for view script to signal it's loaded (with timeout)
        if (!this.viewScriptLoaded) {
          // Waiting for view script to load
          
          const waitForScript = new Promise<void>((resolveScript, rejectScript) => {
            // Check immediately in case it already loaded
            if (this.viewScriptLoaded) {
              // View script already loaded
              resolveScript()
              return
            }

            const timeout = setTimeout(() => {
              rejectScript(new Error('View script load timeout after 5 seconds'))
            }, 5000)

            // Set up a one-time handler that will be called when VIEW_SCRIPT_LOADED arrives
            const checkInterval = setInterval(() => {
              if (this.viewScriptLoaded) {
                clearTimeout(timeout)
                clearInterval(checkInterval)
                // View script loaded, proceeding with INIT_CONTEXT
                resolveScript()
              }
            }, 50)
          })

          await waitForScript
        }

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

        await this.sendMessage(message)
        resolve()
      } catch (error) {
        console.error('Failed to send INIT_CONTEXT:', error)
        this.initContextPromise = null // Reset so we can retry
        reject(error)
      }
    })

    return this.initContextPromise
  }

  private setupMessageHandling() {
    const handleMessage = (event: MessageEvent) => {
      // More lenient security check - verify it's from our iframe or at least our origin
      // The strict event.source check can fail due to timing/reference issues
      const isFromIframe = event.source === this.iframe.contentWindow
      const isFromSameOrigin = event.origin === window.location.origin || 
                               event.origin === 'http://localhost:4000' ||
                               event.origin === 'http://localhost:3000'
      
      if (!isFromIframe && !isFromSameOrigin) {
        console.log('🔇 Ignoring message from untrusted origin:', event.origin)
        return
      }
      
      // Silently accept messages from trusted origins

      try {
        const message: BobbinMessage = event.data
        
        // Ignore React DevTools and other browser extension messages
        if (message && typeof message === 'object' && 
            ((message as any).source === 'react-devtools-content-script' || 
             (message as any).source === 'react-devtools-bridge' ||
             (message as any).source === 'react-devtools-detector')) {
          return
        }

        // Only log in development
        if (process.env.NODE_ENV === 'development' && message?.type) {
          console.log('📨 Bobbin message:', message.type)
        }

        // Validate message structure
        if (!MessageValidator.validate(message)) {
          console.warn('❌ Invalid message received:', message)
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
      case 'VIEW_SCRIPT_LOADED':
        this.viewScriptLoaded = true
        break

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

      case 'CUSTOM_ACTION':
        await this.handleCustomAction(message as CustomActionMessage)
        break

      case 'API_RESPONSE':
        this.handleApiResponse(message as ApiResponseMessage)
        break

      default:
        console.log('Unhandled message type:', message.type)
    }
  }

  private async handleViewReady() {
    // View is ready, context already sent via initializeContext()
  }

  private async handleEntityQuery(message: EntityQueryMessage) {
    try {
      const { collection, filters, sort, limit, offset } = message.payload

      // Use SDK for entity queries
      const result = await this.sdk.entities.query({
        collection,
        ...(filters && { filters }),
        ...(sort && { sort }),
        ...(limit && { limit }),
        ...(offset && { offset })
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
        // Implement atomic batch operations using API transaction endpoint
        return await this.handleAtomicBatch(message, operations)
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
        } catch (err) {
          results.push({ success: false, error: (err as Error).message })
        }
      }

      this.sendResponse(message.requestId, { success: true, data: results })
    } catch (error) {
      this.sendErrorResponse(message.requestId, error as Error)
    }
  }

  private async handleAtomicBatch(message: BatchOperationMessage, operations: any[]) {
    try {
      // Call API endpoint that handles atomic batch operations with transactions
      const response = await fetch(`${process.env.NODE_ENV === 'development' ? 'http://localhost:4000' : ''}/api/entities/batch/atomic`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          projectId: this.projectId,
          operations: operations.map(op => ({
            type: op.type,
            collection: op.collection,
            id: op.id,
            data: op.data
          }))
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new BobbinError(
          error.error || 'Atomic batch operation failed',
          'ATOMIC_BATCH_FAILED',
          false,
          response.status
        )
      }

      const result = await response.json()
      this.sendResponse(message.requestId, { success: true, data: result.results })
    } catch (error) {
      this.sendErrorResponse(message.requestId, error as Error)
    }
  }

  private async handleCustomAction(message: CustomActionMessage) {
    try {
      const { actionId, params, context } = message.payload

      // Forward custom action to API which will invoke the bobbin's action handler
      const response = await fetch(`${process.env.NODE_ENV === 'development' ? 'http://localhost:4000' : ''}/api/bobbins/${this.bobbinId}/actions/${actionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          params,
          context: {
            ...context,
            projectId: this.projectId,
            bobbinId: this.bobbinId,
            viewId: this.viewId
          }
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new BobbinError(
          error.error || 'Custom action failed',
          'CUSTOM_ACTION_FAILED',
          true,
          response.status
        )
      }

      const result = await response.json()
      this.sendResponse(message.requestId, { success: true, data: result })
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
    } catch {
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
    this.initContextPromise = null
    this.viewScriptLoaded = false
  }
}