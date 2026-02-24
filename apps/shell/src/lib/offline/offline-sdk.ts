/**
 * Offline-First SDK Wrapper
 *
 * Wraps the Bobbinry SDK to provide offline-first capabilities
 */

import { BobbinrySDK } from '@bobbinry/sdk'
import { offlineStorage } from './storage'
import { config } from '@/lib/config'
import { syncManager } from './sync'

export class OfflineBobbinrySDK extends BobbinrySDK {
  private useOffline: boolean = true

  constructor(baseURL?: string) {
    super(baseURL || `${config.apiUrl}/api`)

    // Start sync manager
    if (typeof window !== 'undefined') {
      syncManager.start()
    }
  }

  /**
   * Enable/disable offline mode
   */
  setOfflineMode(enabled: boolean) {
    this.useOffline = enabled
  }

  /**
   * Override entity query to use offline-first approach
   */
  async query<T = any>(params: {
    collection: string
    limit?: number
    offset?: number
    sort?: Array<{ field: string; direction: 'asc' | 'desc' }>
  }): Promise<{ data: T[]; total: number }> {
    const projectId = this.getCurrentProjectId()

    if (!projectId) {
      throw new Error('No project ID set')
    }

    // Try offline first
    if (this.useOffline) {
      const isStale = await offlineStorage.isStale(projectId, params.collection)

      // If not stale, return cached data
      if (!isStale) {
        const result = await offlineStorage.queryEntities({
          projectId,
          collection: params.collection,
          ...(params.limit !== undefined && { limit: params.limit }),
          ...(params.offset !== undefined && { offset: params.offset })
        })

        return {
          data: result.entities as T[],
          total: result.total
        }
      }

      // Try to fetch from server and cache
      try {
        const serverResult = await this.fetchFromServer<T>(params)

        // Cache the result
        await offlineStorage.cacheEntities(
          projectId,
          params.collection,
          'unknown', // TODO: get bobbin ID from manifest
          serverResult.data
        )

        return serverResult
      } catch (error) {
        // Server failed, fall back to cached data
        console.warn('[OfflineSDK] Server fetch failed, using cached data:', error)
        const result = await offlineStorage.queryEntities({
          projectId,
          collection: params.collection,
          ...(params.limit !== undefined && { limit: params.limit }),
          ...(params.offset !== undefined && { offset: params.offset })
        })

        return {
          data: result.entities as T[],
          total: result.total
        }
      }
    }

    // Online-only mode
    return this.fetchFromServer<T>(params)
  }

  /**
   * Override entity creation to use optimistic updates
   */
  async create<T = any>(
    collection: string,
    data: Record<string, any>
  ): Promise<T> {
    const projectId = this.getCurrentProjectId()

    if (!projectId) {
      throw new Error('No project ID set')
    }

    if (this.useOffline) {
      // Optimistic create - returns immediately
      const entity = await offlineStorage.createEntity(
        collection,
        projectId,
        'unknown', // TODO: get bobbin ID
        data
      )

      // Trigger sync in background
      syncManager.sync().catch(err =>
        console.error('[OfflineSDK] Background sync failed:', err)
      )

      return entity as T
    }

    // Online-only mode - wait for server
    return this.createOnServer<T>(collection, data)
  }

  /**
   * Override entity update to use optimistic updates
   */
  async update<T = any>(
    collection: string,
    entityId: string,
    data: Record<string, any>
  ): Promise<T> {
    const projectId = this.getCurrentProjectId()

    if (!projectId) {
      throw new Error('No project ID set')
    }

    if (this.useOffline) {
      // Optimistic update - returns immediately
      const entity = await offlineStorage.updateEntity(
        entityId,
        collection,
        projectId,
        data
      )

      // Trigger sync in background
      syncManager.sync().catch(err =>
        console.error('[OfflineSDK] Background sync failed:', err)
      )

      return entity as T
    }

    // Online-only mode
    return this.updateOnServer<T>(collection, entityId, data)
  }

  /**
   * Override entity deletion to use optimistic updates
   */
  async delete(collection: string, entityId: string): Promise<void> {
    const projectId = this.getCurrentProjectId()

    if (!projectId) {
      throw new Error('No project ID set')
    }

    if (this.useOffline) {
      // Optimistic delete - removes immediately
      await offlineStorage.deleteEntity(entityId, collection, projectId)

      // Trigger sync in background
      syncManager.sync().catch(err =>
        console.error('[OfflineSDK] Background sync failed:', err)
      )

      return
    }

    // Online-only mode
    return this.deleteOnServer(collection, entityId)
  }

  /**
   * Get a single entity (offline-first)
   */
  async get<T = any>(collection: string, entityId: string): Promise<T | null> {
    const projectId = this.getCurrentProjectId()

    if (!projectId) {
      throw new Error('No project ID set')
    }

    if (this.useOffline) {
      const cached = await offlineStorage.getEntity(entityId, collection, projectId)

      if (cached) {
        return cached as T
      }
    }

    // Fall back to server
    return this.getFromServer<T>(collection, entityId)
  }

  /**
   * Get sync status
   */
  async getSyncStatus() {
    return syncManager.getStatus()
  }

  /**
   * Force sync now
   */
  async forceSync() {
    return syncManager.sync()
  }

  // Helper to get current project ID from context
  private getCurrentProjectId(): string | null {
    // TODO: Implement project context tracking
    // For now, return a default project ID
    return '550e8400-e29b-41d4-a716-446655440001'
  }

  // Server methods (fallback to parent class or implement directly)
  private async fetchFromServer<T>(params: any): Promise<{ data: T[]; total: number }> {
    // Call parent implementation or API directly
    return this.entities.query(params) as Promise<{ data: T[]; total: number }>
  }

  private async createOnServer<T>(collection: string, data: Record<string, any>): Promise<T> {
    return this.entities.create(collection, data) as Promise<T>
  }

  private async updateOnServer<T>(collection: string, entityId: string, data: Record<string, any>): Promise<T> {
    return this.entities.update(collection, entityId, data) as Promise<T>
  }

  private async deleteOnServer(collection: string, entityId: string): Promise<void> {
    return this.entities.delete(collection, entityId)
  }

  private async getFromServer<T>(collection: string, entityId: string): Promise<T | null> {
    return this.entities.get(collection, entityId) as Promise<T | null>
  }
}

// Export singleton
export const offlineSDK = new OfflineBobbinrySDK()
