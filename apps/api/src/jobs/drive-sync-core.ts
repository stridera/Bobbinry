/**
 * Google Drive Sync Core
 *
 * Single source of truth for syncing a project's entities to Google Drive.
 * Used by both the manual "Sync now" route (full sync, backgrounded) and the
 * auto-sync handler (dirty-entity sync on edit).
 *
 * Centralizing this here fixes three earlier divergences between the two paths:
 *   - the compiled bobbin is always imported from dist/ (runnable under `node`)
 *   - chapter text is always read from entityData.body
 *   - an in-memory lock prevents manual + auto syncs from overlapping
 */

import { eq, and } from 'drizzle-orm'
import { db } from '../db/connection'
import { entities, projectDestinations, projects, userBobbinsInstalled } from '../db/schema'

/** Projects with a sync currently in flight (mutual exclusion across all paths). */
const syncingProjects = new Set<string>()

export function isProjectSyncing(projectId: string): boolean {
  return syncingProjects.has(projectId)
}

export type SyncStatus = 'success' | 'partial' | 'failed' | 'skipped'

export interface RunSyncResult {
  status: SyncStatus
  succeeded: number
  failed: number
  total: number
  error?: string
}

const log = {
  info: (obj: any, msg?: string) => console.log(`[drive-sync] ${msg || ''}`, obj),
  warn: (obj: any, msg?: string) => console.warn(`[drive-sync] ${msg || ''}`, obj),
  error: (obj: any, msg?: string) => console.error(`[drive-sync] ${msg || ''}`, obj),
}

/**
 * Sync a project's entities to Google Drive.
 *
 * @param opts.entityIds  When provided, only these entities are synced (auto-sync).
 *                        Otherwise every entity in the project is synced (manual).
 */
export async function runProjectSync(
  projectId: string,
  opts?: { entityIds?: string[] }
): Promise<RunSyncResult> {
  if (syncingProjects.has(projectId)) {
    return { status: 'skipped', succeeded: 0, failed: 0, total: 0 }
  }
  syncingProjects.add(projectId)

  try {
    // Resolve the project owner
    const [project] = await db
      .select({ userId: projects.ownerId, name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)

    if (!project) {
      return { status: 'skipped', succeeded: 0, failed: 0, total: 0 }
    }

    // The user must have the backup bobbin installed + enabled
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
      return { status: 'skipped', succeeded: 0, failed: 0, total: 0 }
    }

    // Route helpers are imported dynamically to avoid a static import cycle
    // (routes/google-drive imports runProjectSync from here).
    const { decryptDriveConfig, encryptDriveConfig, ensureProjectSubfolder } = await import(
      '../routes/google-drive'
    )

    const userConfig = decryptDriveConfig(bobbin.config as any)
    if (!userConfig.rootFolderId || !userConfig.accessToken) {
      return { status: 'skipped', succeeded: 0, failed: 0, total: 0 }
    }

    // Respect per-project opt-out
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
      return { status: 'skipped', succeeded: 0, failed: 0, total: 0 }
    }

    const subfolderId = await ensureProjectSubfolder(
      userConfig,
      projectId,
      project.name,
      destination || null,
      log,
      bobbin.id
    )

    if (!subfolderId) {
      await writeStatus(projectId, 'failed', 'Failed to create Drive subfolder')
      return { status: 'failed', succeeded: 0, failed: 0, total: 0, error: 'subfolder' }
    }

    // The bobbin's compiled sync service (dist/ so it runs under plain node).
    // Built via a template-literal specifier on purpose: `turbo build --filter=api`
    // (the Fly Dockerfile build) does NOT build bobbin dist output, so a static
    // import would fail tsc with TS2307. A template literal stays unresolved at
    // build time and loads at runtime, where dist/ is present in the image.
    const bobbinId = 'google-drive-backup'
    const { syncChapterToGoogleDrive } = await import(
      `../../../../bobbins/${bobbinId}/dist/actions/sync-service`
    )

    // Persist refreshed tokens back to the user-level install (encrypted)
    const persistToken = async (_destId: string, accessToken: string, tokenExpiresAt: string) => {
      await db
        .update(userBobbinsInstalled)
        .set({
          config: encryptDriveConfig({ ...userConfig, accessToken, tokenExpiresAt }),
          updatedAt: new Date(),
        })
        .where(eq(userBobbinsInstalled.id, bobbin.id))
    }

    const syncDestination = {
      id: destination?.id || 'temp',
      config: { ...userConfig, folderId: subfolderId },
    }

    let rows = await db.select().from(entities).where(eq(entities.projectId, projectId))
    if (opts?.entityIds) {
      const wanted = new Set(opts.entityIds)
      rows = rows.filter((e) => wanted.has(e.id))
    }

    let succeeded = 0
    let failed = 0

    for (const entity of rows) {
      const data = entity.entityData as any
      const result = await syncChapterToGoogleDrive(
        {
          id: entity.id,
          title: data?.title || 'Untitled',
          content: data?.body || '',
          projectId,
        },
        syncDestination,
        data?.driveFileId || null,
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

    const status: SyncStatus = failed === 0 ? 'success' : succeeded > 0 ? 'partial' : 'failed'
    const error =
      failed > 0 ? `${failed} of ${rows.length} ${rows.length === 1 ? 'item' : 'items'} failed` : null

    await writeStatus(projectId, status, error)
    console.log(`[drive-sync] Project ${projectId}: synced ${succeeded}/${rows.length} entities`)

    return { status, succeeded, failed, total: rows.length, ...(error ? { error } : {}) }
  } catch (err) {
    console.error(`[drive-sync] Sync failed for project ${projectId}:`, err)
    await writeStatus(projectId, 'failed', 'Sync failed unexpectedly').catch(() => {})
    return { status: 'failed', succeeded: 0, failed: 0, total: 0, error: String(err) }
  } finally {
    syncingProjects.delete(projectId)
  }
}

/** Update the project's google_drive destination status, if a row exists. */
async function writeStatus(
  projectId: string,
  status: SyncStatus,
  error: string | null
): Promise<void> {
  const [dest] = await db
    .select({ id: projectDestinations.id })
    .from(projectDestinations)
    .where(
      and(
        eq(projectDestinations.projectId, projectId),
        eq(projectDestinations.type, 'google_drive')
      )
    )
    .limit(1)

  if (!dest) return

  await db
    .update(projectDestinations)
    .set({
      lastSyncedAt: new Date(),
      lastSyncStatus: status,
      lastSyncError: error,
      updatedAt: new Date(),
    })
    .where(eq(projectDestinations.id, dest.id))
}
