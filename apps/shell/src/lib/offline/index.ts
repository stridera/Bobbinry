/**
 * Offline Module
 *
 * Exports all offline-first functionality
 */

export { db, clearAllData, getProjectData, getPendingOperations } from './db'
export type { LocalEntity, PendingOperation, LocalProject, LocalBobbin, SyncMetadata } from './db'

export { offlineStorage, type EntityQuery, type Entity } from './storage'
export { syncManager, SyncManager } from './sync'
export { offlineSDK, OfflineBobbinrySDK } from './offline-sdk'

/**
 * Initialize the offline system
 */
export function initializeOffline() {
  if (typeof window === 'undefined') {
    return
  }

  console.log('[Offline] Initializing offline-first system')

  // Start sync manager
  syncManager.start()

  // Log sync status
  syncManager.getStatus().then(status => {
    console.log('[Offline] Status:', status)
  })

  // Set up periodic status logging in development
  if (process.env.NODE_ENV === 'development') {
    setInterval(async () => {
      const status = await syncManager.getStatus()
      if (status.pending > 0 || status.failed > 0) {
        console.log('[Offline] Sync status:', status)
      }
    }, 60000) // Every minute
  }
}
