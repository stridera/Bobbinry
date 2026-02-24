/**
 * Sync Manager
 *
 * Handles background synchronization of pending operations with the server
 */

import { db, type PendingOperation, getPendingOperations } from './db'
import { offlineStorage } from './storage'

const MAX_RETRY_ATTEMPTS = 5
const RETRY_DELAY_BASE = 1000 // 1 second
const SYNC_INTERVAL = 30000 // 30 seconds

export class SyncManager {
  private syncing = false
  private syncInterval: NodeJS.Timeout | null = null
  private apiBaseUrl: string

  constructor(apiBaseUrl = 'http://localhost:4100/api') {
    this.apiBaseUrl = apiBaseUrl
  }

  /**
   * Start automatic background sync
   */
  start() {
    if (this.syncInterval) return

    console.log('[SyncManager] Starting background sync')

    // Sync immediately
    this.sync()

    // Then sync periodically
    this.syncInterval = setInterval(() => {
      this.sync()
    }, SYNC_INTERVAL)

    // Sync when coming back online
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[SyncManager] Back online, syncing...')
        this.sync()
      })
    }
  }

  /**
   * Stop background sync
   */
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
      console.log('[SyncManager] Stopped background sync')
    }
  }

  /**
   * Manually trigger sync
   */
  async sync(): Promise<{ success: number; failed: number }> {
    if (this.syncing) {
      console.log('[SyncManager] Sync already in progress')
      return { success: 0, failed: 0 }
    }

    // Check if online
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      console.log('[SyncManager] Offline, skipping sync')
      return { success: 0, failed: 0 }
    }

    this.syncing = true
    let successCount = 0
    let failedCount = 0

    try {
      const operations = await getPendingOperations(50)

      if (operations.length === 0) {
        return { success: 0, failed: 0 }
      }

      console.log(`[SyncManager] Syncing ${operations.length} operations`)

      for (const operation of operations) {
        try {
          // Mark as in progress
          await db.operations.update(operation.id, { status: 'in_progress' })

          // Execute the operation
          await this.executeOperation(operation)

          // Mark as completed and remove
          await db.operations.delete(operation.id)

          // Update entity sync status
          await db.entities.update(operation.entityId, {
            syncStatus: 'synced',
            syncedAt: new Date().toISOString()
          })

          successCount++
        } catch (error) {
          failedCount++

          const attempts = operation.attempts + 1
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'

          if (attempts >= MAX_RETRY_ATTEMPTS) {
            // Max retries reached, mark entity as error
            await db.entities.update(operation.entityId, {
              syncStatus: 'error',
              lastError: errorMessage
            })

            await db.operations.update(operation.id, {
              status: 'failed',
              error: errorMessage,
              attempts
            })

            console.error(`[SyncManager] Operation ${operation.id} failed after ${attempts} attempts:`, error)
          } else {
            // Retry later
            await db.operations.update(operation.id, {
              status: 'pending',
              error: errorMessage,
              attempts,
              lastAttempt: Date.now()
            })

            console.warn(`[SyncManager] Operation ${operation.id} failed (attempt ${attempts}/${MAX_RETRY_ATTEMPTS}):`, error)
          }
        }
      }

      console.log(`[SyncManager] Sync complete: ${successCount} success, ${failedCount} failed`)
    } finally {
      this.syncing = false
    }

    return { success: successCount, failed: failedCount }
  }

  /**
   * Execute a single pending operation
   */
  private async executeOperation(operation: PendingOperation): Promise<void> {
    const { type, entityId, collectionName, projectId, data } = operation

    switch (type) {
      case 'create':
        await this.syncCreate(projectId, collectionName, entityId, data!)
        break

      case 'update':
        await this.syncUpdate(projectId, collectionName, entityId, data!)
        break

      case 'delete':
        await this.syncDelete(projectId, collectionName, entityId)
        break

      default:
        throw new Error(`Unknown operation type: ${type}`)
    }
  }

  /**
   * Sync create operation to server
   */
  private async syncCreate(
    projectId: string,
    collection: string,
    entityId: string,
    data: Record<string, any>
  ): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection,
        projectId,
        data
      })
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `Create failed: ${response.statusText}`)
    }

    const serverEntity = await response.json()

    // Update local entity with server ID if different
    if (serverEntity.id !== entityId) {
      await db.entities.delete(entityId)
      await db.entities.add({
        id: serverEntity.id,
        projectId,
        bobbinId: serverEntity._meta.bobbinId,
        collectionName: collection,
        data: serverEntity,
        createdAt: serverEntity._meta.createdAt,
        updatedAt: serverEntity._meta.updatedAt,
        syncedAt: new Date().toISOString(),
        syncStatus: 'synced',
        version: 1
      })
    }
  }

  /**
   * Sync update operation to server
   */
  private async syncUpdate(
    projectId: string,
    collection: string,
    entityId: string,
    data: Record<string, any>
  ): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/entities/${entityId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection,
        projectId,
        data
      })
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `Update failed: ${response.statusText}`)
    }
  }

  /**
   * Sync delete operation to server
   */
  private async syncDelete(
    projectId: string,
    collection: string,
    entityId: string
  ): Promise<void> {
    const response = await fetch(
      `${this.apiBaseUrl}/entities/${entityId}?projectId=${projectId}&collection=${collection}`,
      { method: 'DELETE' }
    )

    if (!response.ok && response.status !== 404) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `Delete failed: ${response.statusText}`)
    }
  }

  /**
   * Get sync status
   */
  async getStatus() {
    const pendingCount = await db.operations.where('status').equals('pending').count()
    const failedCount = await db.operations.where('status').equals('failed').count()
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true

    return {
      online: isOnline,
      syncing: this.syncing,
      pending: pendingCount,
      failed: failedCount
    }
  }

  /**
   * Clear failed operations (user action)
   */
  async clearFailed(): Promise<void> {
    await db.operations.where('status').equals('failed').delete()
  }
}

// Singleton instance
export const syncManager = new SyncManager()
