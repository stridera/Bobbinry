/**
 * Offline Module
 *
 * Exports all offline-first functionality
 */

export { db, clearAllData, getProjectData, getPendingOperations } from './db'
export type { LocalEntity, PendingOperation, LocalProject, LocalBobbin, SyncMetadata } from './db'

export { offlineStorage, type EntityQuery, type Entity } from './storage'
export { SyncManager } from './sync'
export { syncManager } from './sync'
export { offlineSDK, OfflineBobbinrySDK } from './offline-sdk'

// Import syncManager for use in this module
import { syncManager as syncMgr } from './sync'

/**
 * Initialize the offline system
 */
export function initializeOffline() {
  if (typeof window === 'undefined') {
    return
  }

  console.log('[Offline] Initializing offline-first system')

  // Start sync manager
  syncMgr.start()

  // Log sync status
  syncMgr.getStatus().then(status => {
    console.log('[Offline] Status:', status)
  })

  // Set up periodic status logging in development
  if (process.env.NODE_ENV === 'development') {
    setInterval(async () => {
      const status = await syncMgr.getStatus()
      if (status.pending > 0 || status.failed > 0) {
        console.log('[Offline] Sync status:', status)
      }
    }, 60000) // Every minute
  }
}
