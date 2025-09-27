import type { TopicMessage } from '@bobbinry/event-bus'

export interface ViewSDKMessage {
  type: 'subscribe' | 'unsubscribe' | 'publish' | 'getState' | 'ready' | 'event' | 'state'
  id?: string
  topic?: string
  data?: unknown
  subscriptionId?: string
  sensitivityLevel?: 'low' | 'medium' | 'high'
}

export interface ViewContext {
  bobbinId: string
  viewId: string
  entityRef?: string
  permissions: string[]
}

/**
 * View SDK for iframe-based views to communicate with the shell
 * Used inside sandboxed views/panels
 */
export class ViewSDK {
  private subscriptions = new Map<string, (message: TopicMessage) => void>()
  private messageId = 0
  private pendingRequests = new Map<string, (response: unknown) => void>()

  constructor(private context: ViewContext) {
    // Set up postMessage listener
    window.addEventListener('message', this.handleMessage.bind(this))

    // Announce readiness to parent
    this.sendToParent({
      type: 'ready',
      data: this.context
    })
  }

  /**
   * Subscribe to a topic
   */
  subscribe(
    topic: string,
    callback: (message: TopicMessage) => void,
    sensitivityLevel: 'low' | 'medium' | 'high' = 'low'
  ): string {
    const subscriptionId = `view_sub_${++this.messageId}`

    this.subscriptions.set(subscriptionId, callback)

    this.sendToParent({
      type: 'subscribe',
      id: this.generateMessageId(),
      topic,
      subscriptionId,
      sensitivityLevel
    })

    return subscriptionId
  }

  /**
   * Unsubscribe from a topic
   */
  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId)

    this.sendToParent({
      type: 'unsubscribe',
      id: this.generateMessageId(),
      subscriptionId
    })
  }

  /**
   * Publish a message to a topic
   */
  publish(
    topic: string,
    payload: unknown,
    sensitivity: 'low' | 'medium' | 'high' = 'low'
  ): void {
    this.sendToParent({
      type: 'publish',
      id: this.generateMessageId(),
      topic,
      data: {
        topic,
        producer: this.context.bobbinId,
        instance: this.context.viewId,
        entityRef: this.context.entityRef,
        sensitivity,
        qos: 'realtime' as const,
        payload
      }
    })
  }

  /**
   * Get current state for a state topic
   */
  async getState(topic: string): Promise<TopicMessage | null> {
    return new Promise((resolve) => {
      const messageId = this.generateMessageId()

      this.pendingRequests.set(messageId, (response) => {
        resolve(response as TopicMessage | null)
      })

      this.sendToParent({
        type: 'getState',
        id: messageId,
        topic
      })
    })
  }

  /**
   * Check if view has specific permission
   */
  hasPermission(permission: string): boolean {
    return this.context.permissions.includes(permission)
  }

  private handleMessage(event: MessageEvent<ViewSDKMessage>): void {
    // Verify origin for security
    if (event.origin !== window.location.origin) {
      return
    }

    const message = event.data

    switch (message.type) {
      case 'event':
        // Handle incoming event from subscription
        if (message.subscriptionId && message.data) {
          const callback = this.subscriptions.get(message.subscriptionId)
          if (callback) {
            callback(message.data as TopicMessage)
          }
        }
        break

      case 'state':
        // Handle state response
        if (message.id && this.pendingRequests.has(message.id)) {
          const resolve = this.pendingRequests.get(message.id)!
          resolve(message.data)
          this.pendingRequests.delete(message.id)
        }
        break
    }
  }

  private sendToParent(message: ViewSDKMessage): void {
    window.parent.postMessage(message, window.location.origin)
  }

  private generateMessageId(): string {
    return `msg_${++this.messageId}_${Date.now()}`
  }

  /**
   * Cleanup when view is destroyed
   */
  destroy(): void {
    window.removeEventListener('message', this.handleMessage.bind(this))
    this.subscriptions.clear()
    this.pendingRequests.clear()
  }
}

/**
 * Shell-side handler for managing view SDK communications
 * Used in the main shell application
 */
export class ViewSDKBridge {
  private views = new Map<string, { iframe: HTMLIFrameElement, context: ViewContext }>()
  private viewSubscriptions = new Map<string, string[]>() // viewId -> subscriptionIds

  constructor(private eventBus: {
    subscribe: (topic: string, callback: (msg: TopicMessage) => void, level?: 'low' | 'medium' | 'high') => string
    unsubscribe: (id: string) => void
    publish: (msg: Omit<TopicMessage, 'timestamp'>) => boolean
    getState: (topic: string) => TopicMessage | null
  }) {
    // Listen for messages from views
    window.addEventListener('message', this.handleViewMessage.bind(this))
  }

  /**
   * Register a view iframe
   */
  registerView(viewId: string, iframe: HTMLIFrameElement, context: ViewContext): void {
    this.views.set(viewId, { iframe, context })
    this.viewSubscriptions.set(viewId, [])
  }

  /**
   * Unregister a view and cleanup its subscriptions
   */
  unregisterView(viewId: string): void {
    // Clean up subscriptions for this view
    const subscriptions = this.viewSubscriptions.get(viewId) || []
    subscriptions.forEach(subId => this.eventBus.unsubscribe(subId))

    this.viewSubscriptions.delete(viewId)
    this.views.delete(viewId)
  }

  private handleViewMessage(event: MessageEvent<ViewSDKMessage>): void {
    const message = event.data

    // Find which view sent this message
    const viewEntry = Array.from(this.views.entries()).find(([_, { iframe }]) =>
      iframe.contentWindow === event.source
    )

    if (!viewEntry) return

    const [viewId, { iframe, context }] = viewEntry

    switch (message.type) {
      case 'ready':
        console.log(`View ${viewId} is ready`)
        break

      case 'subscribe':
        if (message.topic && message.subscriptionId) {
          const busSubscriptionId = this.eventBus.subscribe(
            message.topic,
            (msg) => {
              iframe.contentWindow?.postMessage({
                type: 'event',
                subscriptionId: message.subscriptionId,
                data: msg
              } as ViewSDKMessage, window.location.origin)
            },
            message.sensitivityLevel
          )

          // Track this subscription for cleanup
          const viewSubs = this.viewSubscriptions.get(viewId) || []
          viewSubs.push(busSubscriptionId)
          this.viewSubscriptions.set(viewId, viewSubs)
        }
        break

      case 'unsubscribe':
        if (message.subscriptionId) {
          const viewSubs = this.viewSubscriptions.get(viewId) || []
          const index = viewSubs.findIndex(id => id === message.subscriptionId)
          if (index !== -1) {
            const subscriptionId = viewSubs[index]
            if (subscriptionId) {
              this.eventBus.unsubscribe(subscriptionId)
            }
            viewSubs.splice(index, 1)
          }
        }
        break

      case 'publish':
        if (message.data && message.topic) {
          // Verify view has permission to publish to this topic
          if (this.checkPublishPermission(context, message.topic)) {
            this.eventBus.publish(message.data as Omit<TopicMessage, 'timestamp'>)
          }
        }
        break

      case 'getState':
        if (message.topic && message.id) {
          const state = this.eventBus.getState(message.topic)
          iframe.contentWindow?.postMessage({
            type: 'state',
            id: message.id,
            data: state
          } as ViewSDKMessage, window.location.origin)
        }
        break
    }
  }

  private checkPublishPermission(context: ViewContext, topic: string): boolean {
    // Check if the view's bobbin has permission to publish to this topic
    // This would typically check against the manifest's pubsub.produces section
    return context.permissions.includes('publish') ||
           context.permissions.includes(`publish:${topic}`)
  }
}

// Helper function to create ViewSDK in iframe contexts
export function createViewSDK(context: ViewContext): ViewSDK {
  return new ViewSDK(context)
}