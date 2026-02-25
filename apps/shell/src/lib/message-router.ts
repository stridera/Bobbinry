/**
 * Message Router
 * 
 * Type-safe message routing for shell-bobbin communication
 * Handles sending, receiving, validation, and debugging
 */

import {
  MessageEnvelope,
  MessageNamespace,
  isMessageEnvelope,
  SHELL_MESSAGES,
  BUS_MESSAGES,
  ShellConfig,
  ShellInitPayload,
  ShellConfigResponsePayload,
  ShellThemeUpdatePayload,
} from '@/types/shell-messages'

// ============================================================================
// MESSAGE BUILDER
// ============================================================================

export class MessageBuilder {
  /**
   * Create a properly formatted message envelope
   */
  static create<T>(
    namespace: MessageNamespace,
    type: string,
    payload: T,
    options: {
      source: string
      target?: string
      requestId?: string
    }
  ): MessageEnvelope<T> {
    return {
      namespace,
      type,
      payload,
      metadata: {
        source: options.source,
        ...(options.target && { target: options.target }),
        ...(options.requestId && { requestId: options.requestId }),
        timestamp: Date.now(),
      },
    }
  }

  /**
   * Create a shell init message
   */
  static shellInit(config: ShellConfig, bobbinId: string, viewId?: string): MessageEnvelope<ShellInitPayload> {
    return this.create(
      'SHELL',
      SHELL_MESSAGES.INIT,
      { config, bobbinId, ...(viewId && { viewId }) },
      { source: 'shell', target: bobbinId }
    )
  }

  /**
   * Create a shell config response
   */
  static shellConfigResponse(config: ShellConfig, requestId: string): MessageEnvelope<ShellConfigResponsePayload> {
    return this.create(
      'SHELL',
      SHELL_MESSAGES.CONFIG_RESPONSE,
      { config },
      { source: 'shell', requestId }
    )
  }

  /**
   * Create a theme update message
   */
  static shellThemeUpdate(theme: 'light' | 'dark'): MessageEnvelope<ShellThemeUpdatePayload> {
    return this.create(
      'SHELL',
      SHELL_MESSAGES.THEME_UPDATE,
      { theme },
      { source: 'shell' }
    )
  }

  /**
   * Create a bus event message
   */
  static busEvent(topic: string, data: any, source: string): MessageEnvelope {
    return this.create(
      'BUS',
      BUS_MESSAGES.EVENT,
      { topic, data, source },
      { source }
    )
  }
}

// ============================================================================
// MESSAGE ROUTER
// ============================================================================

type MessageHandler = (envelope: MessageEnvelope) => void | Promise<void>

export class MessageRouter {
  private handlers = new Map<string, Set<MessageHandler>>()
  private globalHandlers = new Set<MessageHandler>()
  private debugMode = process.env.NODE_ENV === 'development'
  private lastMessageId = ''
  private messageCache = new Map<string, number>()
  private readonly MESSAGE_CACHE_TTL = 1000 // 1 second

  /**
   * Register a handler for a specific message type
   */
  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler)
    }
  }

  /**
   * Register a handler for all messages
   */
  onAny(handler: MessageHandler): () => void {
    this.globalHandlers.add(handler)
    return () => {
      this.globalHandlers.delete(handler)
    }
  }

  /**
   * Route an incoming message to appropriate handlers
   */
  async route(message: any): Promise<void> {
    // Silently drop non-envelope messages (react-devtools, browser extensions, etc.)
    if (!isMessageEnvelope(message)) {
      return
    }

    const envelope = message as MessageEnvelope

    // Deduplicate messages based on type and payload content (not timestamp)
    // For BUS_EVENT messages, use topic and data as the key
    let messageId: string
    if (envelope.type === 'BUS_EVENT' && envelope.payload) {
      const topic = envelope.payload.topic || ''
      const dataStr = JSON.stringify(envelope.payload.data || {})
      messageId = `${envelope.type}-${topic}-${dataStr}`
    } else {
      messageId = `${envelope.metadata.timestamp}-${envelope.type}`
    }

    const now = Date.now()

    // Clean old entries from cache
    for (const [id, timestamp] of this.messageCache.entries()) {
      if (now - timestamp > this.MESSAGE_CACHE_TTL) {
        this.messageCache.delete(id)
      }
    }

    // Skip if we've seen this message recently
    if (this.messageCache.has(messageId)) {
      return
    }
    this.messageCache.set(messageId, now)

    // Debug logging (after deduplication so we only log unique messages)
    if (this.debugMode) {
      this.logMessage(envelope)
    }

    // Call global handlers
    for (const handler of this.globalHandlers) {
      try {
        await handler(envelope)
      } catch (error) {
        console.error('[MessageRouter] Global handler error:', error)
      }
    }

    // Call type-specific handlers
    const typeHandlers = this.handlers.get(envelope.type)
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          await handler(envelope)
        } catch (error) {
          console.error(`[MessageRouter] Handler error for ${envelope.type}:`, error)
        }
      }
    }
  }

  /**
   * Send a message through a target (iframe or window)
   */
  send(target: Window | null, message: MessageEnvelope, origin = '*'): void {
    if (!target) {
      console.error('[MessageRouter] No target window provided')
      return
    }

    if (this.debugMode) {
      this.logMessage(message, 'OUTGOING')
    }

    try {
      target.postMessage(message, origin)
    } catch (error) {
      console.error('[MessageRouter] Failed to send message:', error)
    }
  }

  /**
   * Pretty-print message for debugging
   */
  private logMessage(envelope: MessageEnvelope, direction: 'INCOMING' | 'OUTGOING' = 'INCOMING'): void {
    const colors = {
      SHELL: '#3b82f6',  // blue
      BOBBIN: '#10b981', // green
      BUS: '#f59e0b',    // amber
      DEBUG: '#ef4444',  // red
    }

    const arrow = direction === 'INCOMING' ? '⬅️' : '➡️'
    const color = colors[envelope.namespace]
    const source = envelope.metadata.source || 'unknown'
    const target = envelope.metadata.target || '*'

    console.log(
      `%c${arrow} ${envelope.namespace}%c ${envelope.type} %c${source} → ${target}`,
      `color: ${color}; font-weight: bold`,
      'color: inherit',
      'color: #888; font-size: 0.9em',
      envelope.payload
    )
  }

  /**
   * Clear all handlers
   */
  clear(): void {
    this.handlers.clear()
    this.globalHandlers.clear()
  }
}

// ============================================================================
// GLOBAL IFRAME BROADCASTER
// ============================================================================

/**
 * Global registry for all iframes that should receive BUS_EVENT messages
 * This prevents duplicate forwarding when multiple ExtensionSlots exist
 */
class IframeBroadcaster {
  private iframes = new Map<string, HTMLIFrameElement>()
  private initialized = false

  register(id: string, iframe: HTMLIFrameElement): void {
    this.iframes.set(id, iframe)
    
    // Initialize the BUS_EVENT broadcaster on first registration
    if (!this.initialized) {
      this.initializeBroadcaster()
      this.initialized = true
    }
  }

  unregister(id: string): void {
    this.iframes.delete(id)
  }

  private initializeBroadcaster(): void {
    // Single global handler for BUS_EVENT messages
    messageRouter.on('BUS_EVENT', async (envelope) => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[IframeBroadcaster] Broadcasting to ${this.iframes.size} iframe(s):`, Array.from(this.iframes.keys()))
      }
      
      // Broadcast to all registered iframes
      this.iframes.forEach((iframe, id) => {
        if (process.env.NODE_ENV === 'development') {
          console.log(`  → Sending to iframe: ${id}`)
        }
        sendToIframe(iframe, envelope)
      })
    })
  }
}

export const iframeBroadcaster = new IframeBroadcaster()

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const messageRouter = new MessageRouter()

// ============================================================================
// CONVENIENCE HOOKS FOR WINDOW MESSAGES
// ============================================================================

/**
 * Setup message listener on window
 * Returns cleanup function
 */
export function setupMessageListener(
  router: MessageRouter,
  filter?: (event: MessageEvent) => boolean
): () => void {
  const handler = (event: MessageEvent) => {
    // Apply filter if provided
    if (filter && !filter(event)) {
      return
    }

    router.route(event.data)
  }

  window.addEventListener('message', handler)

  return () => {
    window.removeEventListener('message', handler)
  }
}

/**
 * Send message to iframe
 */
export function sendToIframe(
  iframe: HTMLIFrameElement | null,
  message: MessageEnvelope
): void {
  if (!iframe?.contentWindow) {
    console.error('[MessageRouter] Iframe not ready')
    return
  }

  messageRouter.send(iframe.contentWindow, message)
}

/**
 * Send message to parent window
 */
export function sendToParent(message: MessageEnvelope): void {
  if (window.parent === window) {
    console.warn('[MessageRouter] No parent window')
    return
  }

  messageRouter.send(window.parent, message)
}
