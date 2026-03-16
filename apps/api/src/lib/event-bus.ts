/**
 * Server-side Event Bus
 *
 * In-process pub/sub for domain events. This is the foundation for
 * publisher bobbins, backup sync, and tier-based content availability.
 *
 * Events:
 *   content:edited     - Entity saved (backup bobbins listen)
 *   content:statusChange - Chapter marked complete/draft
 *   content:published  - Chapter publication status changed
 *   content:available  - Content available for a tier (smart publisher emits per tier)
 *   subscription:changed - Subscription created, upgraded, downgraded, or canceled
 */

export interface DomainEvent {
  type: string
  timestamp: Date
  projectId: string
  entityId?: string
  userId?: string
  payload: Record<string, unknown>
}

type EventHandler = (event: DomainEvent) => void | Promise<void>

class ServerEventBus {
  private handlers = new Map<string, Set<EventHandler>>()

  on(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set())
    }
    this.handlers.get(eventType)!.add(handler)

    // Return unsubscribe function
    return () => {
      this.handlers.get(eventType)?.delete(handler)
    }
  }

  async emit(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type)
    if (!handlers || handlers.size === 0) return

    const promises: Promise<void>[] = []
    for (const handler of handlers) {
      try {
        const result = handler(event)
        if (result instanceof Promise) {
          promises.push(result.catch(err => {
            console.error(`[event-bus] Handler error for ${event.type}:`, err)
          }))
        }
      } catch (err) {
        console.error(`[event-bus] Sync handler error for ${event.type}:`, err)
      }
    }

    // Wait for all async handlers to complete
    if (promises.length > 0) {
      await Promise.allSettled(promises)
    }
  }

  /**
   * Fire-and-forget emit — doesn't wait for handlers.
   * Use for non-critical events where you don't want to block the request.
   */
  fire(event: DomainEvent): void {
    this.emit(event).catch(err => {
      console.error(`[event-bus] Unhandled error in fire():`, err)
    })
  }

  getRegisteredEvents(): string[] {
    return [...this.handlers.keys()]
  }

  removeAllListeners(eventType?: string): void {
    if (eventType) {
      this.handlers.delete(eventType)
    } else {
      this.handlers.clear()
    }
  }
}

// Singleton
export const serverEventBus = new ServerEventBus()

// Helper to create typed events
export function contentEdited(projectId: string, entityId: string, userId: string, collectionName: string): DomainEvent {
  return {
    type: 'content:edited',
    timestamp: new Date(),
    projectId,
    entityId,
    userId,
    payload: { collectionName }
  }
}

export function contentStatusChange(projectId: string, entityId: string, userId: string, newStatus: string): DomainEvent {
  return {
    type: 'content:statusChange',
    timestamp: new Date(),
    projectId,
    entityId,
    userId,
    payload: { status: newStatus }
  }
}

export function contentPublished(projectId: string, entityId: string, userId: string, isPublished: boolean): DomainEvent {
  return {
    type: 'content:published',
    timestamp: new Date(),
    projectId,
    entityId,
    userId,
    payload: { isPublished }
  }
}

export function contentAvailable(projectId: string, entityId: string, tierId: string, tierLevel: number): DomainEvent {
  return {
    type: 'content:available',
    timestamp: new Date(),
    projectId,
    entityId,
    payload: { tierId, tierLevel }
  }
}

export function subscriptionChanged(
  authorId: string,
  subscriberId: string,
  tierId: string,
  tierLevel: number,
  action: 'created' | 'upgraded' | 'downgraded' | 'canceled'
): DomainEvent {
  return {
    type: 'subscription:changed',
    timestamp: new Date(),
    projectId: '', // not project-scoped
    userId: subscriberId,
    payload: { authorId, subscriberId, tierId, tierLevel, action }
  }
}
