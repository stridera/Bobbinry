/**
 * Google Drive Auto-Sync Handler (User-Scoped)
 *
 * Listens to content:edited events and syncs dirty entities to Google Drive
 * using a two-timer strategy:
 *   - 5-minute debounce: fires when the user stops editing for 5 minutes
 *   - 30-minute max interval: forces a sync during marathon writing sessions
 *
 * Tokens come from user_bobbins_installed (user-level), not project_destinations.
 * Per-project subfolders are created lazily under "Bobbinry Backup/".
 */

import { serverEventBus, type DomainEvent } from '../lib/event-bus'
import { db } from '../db/connection'
import { entities, projectDestinations, projects, userBobbinsInstalled } from '../db/schema'
import { eq, and } from 'drizzle-orm'

const DEBOUNCE_MS = 5 * 60 * 1000   // 5 minutes
const MAX_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

interface ProjectSyncState {
  debounceTimer: ReturnType<typeof setTimeout>
  lastSyncedAt: number
  maxIntervalTimer: ReturnType<typeof setTimeout> | null
  dirtyEntityIds: Set<string>
}

const projectStates = new Map<string, ProjectSyncState>()
const syncingProjects = new Set<string>() // concurrency lock

async function performSync(projectId: string): Promise<void> {
  if (syncingProjects.has(projectId)) return
  syncingProjects.add(projectId)

  const state = projectStates.get(projectId)
  if (!state || state.dirtyEntityIds.size === 0) {
    syncingProjects.delete(projectId)
    return
  }

  // Snapshot and clear dirty set before syncing
  const entityIds = [...state.dirtyEntityIds]
  state.dirtyEntityIds.clear()

  // Clear both timers
  clearTimeout(state.debounceTimer)
  if (state.maxIntervalTimer) {
    clearTimeout(state.maxIntervalTimer)
    state.maxIntervalTimer = null
  }

  try {
    // Look up the project's owner
    const [project] = await db
      .select({ userId: projects.ownerId, name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    if (!project) {
      projectStates.delete(projectId)
      syncingProjects.delete(projectId)
      return
    }

    // Check if user has backup bobbin installed
    const [bobbin] = await db
      .select()
      .from(userBobbinsInstalled)
      .where(
        and(
          eq(userBobbinsInstalled.userId, project.userId),
          eq(userBobbinsInstalled.bobbinType, 'backup'),
          eq(userBobbinsInstalled.bobbinId, 'google-drive-backup'),
          eq(userBobbinsInstalled.isEnabled, true)
        )
      )
      .limit(1)

    if (!bobbin) {
      projectStates.delete(projectId)
      syncingProjects.delete(projectId)
      return
    }

    const { decryptDriveConfig, encryptDriveConfig } = await import('../routes/google-drive')
    const userConfig = decryptDriveConfig(bobbin.config as any)
    if (!userConfig.rootFolderId || !userConfig.accessToken) {
      syncingProjects.delete(projectId)
      return
    }

    // Check if project is opted out
    const [destination] = await db
      .select()
      .from(projectDestinations)
      .where(
        and(
          eq(projectDestinations.projectId, projectId),
          eq(projectDestinations.type, 'google_drive')
        )
      )
      .limit(1)

    if (destination && !destination.isActive) {
      // Opted out
      syncingProjects.delete(projectId)
      return
    }

    // Ensure subfolder exists
    const { ensureProjectSubfolder } = await import('../routes/google-drive')
    const subfolderId = await ensureProjectSubfolder(
      userConfig, projectId, project.name, destination || null, console, bobbin.id
    )

    if (!subfolderId) {
      syncingProjects.delete(projectId)
      return
    }

    // Dynamic import of sync service
    const bobbinId = 'google-drive-backup'
    const { syncChapterToGoogleDrive } = await import(
      `../../../../bobbins/${bobbinId}/actions/sync-service`
    )

    // Token persistence callback — writes to user_bobbins_installed
    const persistToken = async (_destinationId: string, accessToken: string, tokenExpiresAt: string) => {
      await db.update(userBobbinsInstalled).set({
        config: encryptDriveConfig({ ...userConfig, accessToken, tokenExpiresAt }),
        updatedAt: new Date(),
      }).where(eq(userBobbinsInstalled.id, bobbin.id))
    }

    // Build sync destination with user tokens + project subfolder
    const syncDestination = {
      id: destination?.id || 'temp',
      config: {
        ...userConfig,
        folderId: subfolderId,
      },
    }

    // Fetch the dirty entities
    const dirtyEntities = await db
      .select()
      .from(entities)
      .where(eq(entities.projectId, projectId))

    const toSync = dirtyEntities.filter((e) => entityIds.includes(e.id))

    let succeeded = 0
    let failed = 0

    const log = {
      info: (obj: any, msg?: string) => console.log(`[drive-sync] ${msg || ''}`, obj),
      warn: (obj: any, msg?: string) => console.warn(`[drive-sync] ${msg || ''}`, obj),
      error: (obj: any, msg?: string) => console.error(`[drive-sync] ${msg || ''}`, obj),
    }

    for (const entity of toSync) {
      const data = entity.entityData as any
      const existingFileId = data?.driveFileId || null

      const result = await syncChapterToGoogleDrive(
        {
          id: entity.id,
          title: data?.title || 'Untitled',
          content: data?.content || '',
          projectId: entity.projectId,
        },
        syncDestination,
        existingFileId,
        log,
        persistToken
      )

      if (result.success && result.fileId) {
        succeeded++
        await db
          .update(entities)
          .set({
            entityData: {
              ...data,
              driveFileId: result.fileId,
              driveFileUrl: result.fileUrl,
              lastSyncedAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(entities.id, entity.id))
      } else {
        failed++
        if (result.error === 'folder_deleted') break
      }
    }

    // Update destination status (re-fetch in case it was just created)
    const [currentDest] = await db
      .select()
      .from(projectDestinations)
      .where(
        and(
          eq(projectDestinations.projectId, projectId),
          eq(projectDestinations.type, 'google_drive')
        )
      )
      .limit(1)

    if (currentDest) {
      await db
        .update(projectDestinations)
        .set({
          lastSyncedAt: new Date(),
          lastSyncStatus: failed === 0 ? 'success' : succeeded > 0 ? 'partial' : 'failed',
          lastSyncError: failed > 0 ? `Auto-sync: ${failed} of ${toSync.length} failed` : null,
          updatedAt: new Date(),
        })
        .where(eq(projectDestinations.id, currentDest.id))
    }

    state.lastSyncedAt = Date.now()
    console.log(`[drive-sync] Project ${projectId}: synced ${succeeded}/${toSync.length} entities`)
  } catch (error) {
    console.error(`[drive-sync] Sync failed for project ${projectId}:`, error)
    // Put dirty IDs back so they get retried on next trigger
    const currentState = projectStates.get(projectId)
    if (currentState) {
      for (const id of entityIds) {
        currentState.dirtyEntityIds.add(id)
      }
    }
  } finally {
    syncingProjects.delete(projectId)
    // Clean up state if nothing is dirty
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
