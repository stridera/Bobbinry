/**
 * Google Drive Auto-Sync Handler (User-Scoped)
 *
 * Listens to content:edited events and syncs dirty entities to Google Drive
 * using a two-timer strategy:
 *   - 5-minute debounce: fires when the user stops editing for 5 minutes
 *   - 30-minute max interval: forces a sync during marathon writing sessions
 *
 * The actual sync work lives in drive-sync-core (shared with the manual
 * "Sync now" route). This handler only owns the debounce/dirty-set state.
 */

import { serverEventBus, type DomainEvent } from '../lib/event-bus'
import { runProjectSync } from './drive-sync-core'

const DEBOUNCE_MS = 5 * 60 * 1000   // 5 minutes
const MAX_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

interface ProjectSyncState {
  debounceTimer: ReturnType<typeof setTimeout>
  lastSyncedAt: number
  maxIntervalTimer: ReturnType<typeof setTimeout> | null
  dirtyEntityIds: Set<string>
}

const projectStates = new Map<string, ProjectSyncState>()

async function performSync(projectId: string): Promise<void> {
  const state = projectStates.get(projectId)
  if (!state || state.dirtyEntityIds.size === 0) return

  // Snapshot and clear the dirty set + timers before syncing
  const entityIds = [...state.dirtyEntityIds]
  state.dirtyEntityIds.clear()
  clearTimeout(state.debounceTimer)
  if (state.maxIntervalTimer) {
    clearTimeout(state.maxIntervalTimer)
    state.maxIntervalTimer = null
  }

  try {
    const result = await runProjectSync(projectId, { entityIds })

    // 'skipped' (another sync held the lock) and 'failed' should be retried —
    // put the dirty IDs back so the next trigger picks them up.
    if (result.status === 'skipped' || result.status === 'failed') {
      for (const id of entityIds) state.dirtyEntityIds.add(id)
    } else {
      state.lastSyncedAt = Date.now()
    }
  } catch (error) {
    console.error(`[drive-sync] Sync failed for project ${projectId}:`, error)
    for (const id of entityIds) state.dirtyEntityIds.add(id)
  } finally {
    // Clean up state if nothing is dirty and no max-interval timer is pending
    const currentState = projectStates.get(projectId)
    if (currentState && currentState.dirtyEntityIds.size === 0 && !currentState.maxIntervalTimer) {
      projectStates.delete(projectId)
    }
  }
}

function handleContentEdited(event: DomainEvent): void {
  const { projectId, entityId } = event
  if (!projectId || !entityId) return

  let state = projectStates.get(projectId)

  if (!state) {
    state = {
      debounceTimer: setTimeout(() => performSync(projectId), DEBOUNCE_MS),
      lastSyncedAt: 0,
      maxIntervalTimer: null,
      dirtyEntityIds: new Set([entityId]),
    }
    projectStates.set(projectId, state)
  } else {
    state.dirtyEntityIds.add(entityId)

    // Reset the 5-minute debounce timer
    clearTimeout(state.debounceTimer)
    state.debounceTimer = setTimeout(() => performSync(projectId), DEBOUNCE_MS)
  }

  // Start the 30-minute max interval timer if not already running
  if (!state.maxIntervalTimer) {
    state.maxIntervalTimer = setTimeout(() => performSync(projectId), MAX_INTERVAL_MS)
  }
}

export function initDriveSyncHandler(): void {
  serverEventBus.on('content:edited', handleContentEdited)
  console.log('[drive-sync] Initialized — listening for content:edited events')
}
