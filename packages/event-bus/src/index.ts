export interface TopicMessage {
  topic: string
  timestamp: number
  producer: string
  instance: string
  entityRef?: string
  sensitivity: 'low' | 'medium' | 'high'
  qos: 'realtime' | 'batch' | 'state'
  payload: unknown
}

export interface TopicConfig {
  qos: 'realtime' | 'batch' | 'state'
  sensitivity: 'low' | 'medium' | 'high'
  maxRate?: number // messages per second
  shared?: boolean // eligible for PEH distribution
  retention?: number // milliseconds to keep state messages
}

export interface Subscription {
  id: string
  topic: string
  callback: (message: TopicMessage) => void
  sensitivityLevel: 'low' | 'medium' | 'high'
  active: boolean
}

export interface RateLimiter {
  topic: string
  count: number
  windowStart: number
  windowSize: number // milliseconds
  maxCount: number
}

export class LocalEventBus {
  private topics = new Map<string, TopicConfig>()
  private subscriptions = new Map<string, Subscription[]>()
  private stateStore = new Map<string, TopicMessage>()
  private rateLimiters = new Map<string, RateLimiter>()
  private subscriptionCounter = 0

  constructor() {
    // Initialize built-in topics
    this.registerTopic('manuscript.editor.selection.v1', {
      qos: 'realtime',
      sensitivity: 'medium',
      maxRate: 10, // 10 Hz max for selection events
      shared: false
    })

    this.registerTopic('manuscript.metrics.wordcount.v1', {
      qos: 'batch',
      sensitivity: 'low',
      maxRate: 1, // 1 Hz for metrics
      shared: true // can be shared via PEH
    })
  }

  registerTopic(topicName: string, config: TopicConfig): void {
    this.topics.set(topicName, config)

    if (config.qos === 'state') {
      // Initialize state store for state topics
      this.stateStore.set(topicName, {
        topic: topicName,
        timestamp: Date.now(),
        producer: 'system',
        instance: 'init',
        sensitivity: config.sensitivity,
        qos: config.qos,
        payload: null
      })
    }

    // Initialize rate limiter
    if (config.maxRate) {
      this.rateLimiters.set(topicName, {
        topic: topicName,
        count: 0,
        windowStart: Date.now(),
        windowSize: 1000, // 1 second window
        maxCount: config.maxRate
      })
    }
  }

  subscribe(
    topic: string,
    callback: (message: TopicMessage) => void,
    sensitivityLevel: 'low' | 'medium' | 'high' = 'low'
  ): string {
    const subscriptionId = `sub_${++this.subscriptionCounter}`

    const subscription: Subscription = {
      id: subscriptionId,
      topic,
      callback,
      sensitivityLevel,
      active: true
    }

    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, [])
    }

    this.subscriptions.get(topic)!.push(subscription)

    // For state topics, immediately deliver current state
    const topicConfig = this.topics.get(topic)
    if (topicConfig?.qos === 'state' && this.stateStore.has(topic)) {
      const stateMessage = this.stateStore.get(topic)!
      if (this.checkSensitivityAccess(stateMessage, sensitivityLevel)) {
        setTimeout(() => callback(stateMessage), 0)
      }
    }

    return subscriptionId
  }

  unsubscribe(subscriptionId: string): void {
    for (const [topic, subs] of this.subscriptions.entries()) {
      const index = subs.findIndex(sub => sub.id === subscriptionId)
      if (index !== -1) {
        const subscription = subs[index]
        if (subscription) {
          subscription.active = false
        }
        subs.splice(index, 1)
        if (subs.length === 0) {
          this.subscriptions.delete(topic)
        }
        break
      }
    }
  }

  publish(message: Omit<TopicMessage, 'timestamp'>): boolean {
    const topicConfig = this.topics.get(message.topic)
    if (!topicConfig) {
      console.warn(`Topic ${message.topic} not registered`)
      return false
    }

    // Rate limiting check
    if (!this.checkRateLimit(message.topic)) {
      console.warn(`Rate limit exceeded for topic ${message.topic}`)
      return false
    }

    const fullMessage: TopicMessage = {
      ...message,
      timestamp: Date.now()
    }

    // For state topics, update the state store
    if (topicConfig.qos === 'state') {
      this.stateStore.set(message.topic, fullMessage)
    }

    // Deliver to subscribers
    const subscribers = this.subscriptions.get(message.topic) || []
    const activeSubscribers = subscribers.filter(sub => sub.active)

    for (const subscription of activeSubscribers) {
      if (this.checkSensitivityAccess(fullMessage, subscription.sensitivityLevel)) {
        try {
          subscription.callback(fullMessage)
        } catch (error) {
          console.error(`Error in subscription callback for ${message.topic}:`, error)
        }
      }
    }

    return true
  }

  getState(topic: string): TopicMessage | null {
    return this.stateStore.get(topic) || null
  }

  getTopicConfig(topic: string): TopicConfig | null {
    return this.topics.get(topic) || null
  }

  getActiveSubscriptions(): Array<{topic: string, count: number}> {
    return Array.from(this.subscriptions.entries()).map(([topic, subs]) => ({
      topic,
      count: subs.filter(sub => sub.active).length
    }))
  }

  private checkRateLimit(topic: string): boolean {
    const limiter = this.rateLimiters.get(topic)
    if (!limiter) return true

    const now = Date.now()

    // Reset window if expired
    if (now - limiter.windowStart >= limiter.windowSize) {
      limiter.count = 0
      limiter.windowStart = now
    }

    if (limiter.count >= limiter.maxCount) {
      return false
    }

    limiter.count++
    return true
  }

  private checkSensitivityAccess(
    message: TopicMessage,
    requiredLevel: 'low' | 'medium' | 'high'
  ): boolean {
    const sensitivityLevels = { low: 1, medium: 2, high: 3 }
    return sensitivityLevels[message.sensitivity] <= sensitivityLevels[requiredLevel]
  }

  // Cleanup method for testing or shutdown
  destroy(): void {
    this.subscriptions.clear()
    this.stateStore.clear()
    this.rateLimiters.clear()
    this.topics.clear()
  }
}

// Singleton instance for the shell
export const eventBus = new LocalEventBus()