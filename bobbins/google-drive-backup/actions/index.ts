/**
 * Google Drive Publisher Bobbin - Action Handlers
 *
 * These handlers implement the custom actions defined in the manifest.
 * They are invoked by the API when the bobbin receives action requests via the message bus.
 */

import type { ActionContext, ActionResult, ActionRuntimeHost } from '@bobbinry/action-runtime'

// Re-export sync service functions
import {
  syncChapterToGoogleDrive,
  batchSyncChapters,
  type SyncResult,
  type ChapterContent
} from './sync-service'

export { syncChapterToGoogleDrive, batchSyncChapters }

/** Create DB callback helpers — lazily imports DB deps so they resolve from the API package */
async function createDbCallbacks() {
  const { db } = await import('../../../apps/api/src/db/connection')
  const { projectDestinations } = await import('../../../apps/api/src/db/schema')
  const { eq } = await import('drizzle-orm')

  const persistToken = async (destinationId: string, accessToken: string, tokenExpiresAt: string) => {
    const [dest] = await db.select().from(projectDestinations).where(eq(projectDestinations.id, destinationId)).limit(1)
    if (!dest) return
    await db
      .update(projectDestinations)
      .set({
        config: { ...(dest.config as any), accessToken, tokenExpiresAt },
        updatedAt: new Date(),
      })
      .where(eq(projectDestinations.id, destinationId))
  }

  const deactivateDestination = async (destinationId: string, error: string) => {
    await db
      .update(projectDestinations)
      .set({
        isActive: false,
        lastSyncError: error,
        lastSyncStatus: 'failed',
        updatedAt: new Date(),
      })
      .where(eq(projectDestinations.id, destinationId))
  }

  return { db, projectDestinations, eq, persistToken, deactivateDestination }
}

/**
 * Action: initiate_drive_oauth
 * Returns the Google OAuth authorize URL for the frontend to redirect to
 */
export async function initiateDriveOAuth(
  params: Record<string, unknown>,
  context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const { env } = await import('../../../apps/api/src/lib/env')

    if (!env.GOOGLE_ID) {
      return { success: false, error: 'Google OAuth not configured on this server' }
    }

    const url = `${env.API_ORIGIN}/api/backups/google-drive/authorize`
    return { success: true, data: { url } }
  } catch (error) {
    runtime.log.error({ error }, 'initiateDriveOAuth action failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Action: sync_to_drive
 * Syncs a single chapter to Google Drive
 */
export async function syncToDrive(
  params: {
    chapterId: string
    destinationId: string
    force?: boolean
  },
  context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const { db, projectDestinations, eq, persistToken, deactivateDestination } = await createDbCallbacks()
    const { entities } = await import('../../../apps/api/src/db/schema')
    const { and } = await import('drizzle-orm')

    const { chapterId, destinationId, force } = params

    const [chapter] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.id, chapterId), eq(entities.projectId, context.projectId)))
      .limit(1)

    if (!chapter) {
      return { success: false, error: 'Chapter not found' }
    }

    const [destination] = await db
      .select()
      .from(projectDestinations)
      .where(and(eq(projectDestinations.id, destinationId), eq(projectDestinations.projectId, context.projectId)))
      .limit(1)

    if (!destination) {
      return { success: false, error: 'Destination not found' }
    }

    if (!destination.isActive) {
      return { success: false, error: 'Destination is not active' }
    }

    const existingFileId = (chapter.entityData as any)?.driveFileId || null

    if (existingFileId && !force) {
      return {
        success: true,
        data: { message: 'Chapter already synced', fileId: existingFileId, skipped: true }
      }
    }

    const chapterContent: ChapterContent = {
      id: chapter.id,
      title: (chapter.entityData as any)?.title || 'Untitled',
      content: (chapter.entityData as any)?.content || '',
      projectId: chapter.projectId
    }

    const result = await syncChapterToGoogleDrive(
      chapterContent, destination, existingFileId, runtime.log, persistToken, deactivateDestination
    )

    await db
      .update(projectDestinations)
      .set({
        lastSyncedAt: new Date(),
        lastSyncStatus: result.success ? 'success' : 'failed',
        lastSyncError: result.error || null,
        updatedAt: new Date()
      })
      .where(eq(projectDestinations.id, destinationId))

    if (result.success && result.fileId) {
      await db
        .update(entities)
        .set({
          entityData: {
            ...(chapter.entityData as any),
            driveFileId: result.fileId,
            driveFileUrl: result.fileUrl,
            lastSyncedAt: new Date().toISOString()
          },
          updatedAt: new Date()
        })
        .where(eq(entities.id, chapterId))
    }

    return {
      success: result.success,
      data: result.success ? { fileId: result.fileId, fileUrl: result.fileUrl } : undefined,
      error: result.error
    }
  } catch (error) {
    runtime.log.error({ error }, 'syncToDrive action failed')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/**
 * Action: sync_all_chapters
 * Batch syncs all chapters in a project
 */
export async function syncAllChapters(
  params: {
    destinationId: string
    collection?: string
    publishedOnly?: boolean
  },
  context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const { db, projectDestinations, eq, persistToken, deactivateDestination } = await createDbCallbacks()
    const { entities } = await import('../../../apps/api/src/db/schema')
    const { and } = await import('drizzle-orm')

    const { destinationId, collection } = params

    const [destination] = await db
      .select()
      .from(projectDestinations)
      .where(and(eq(projectDestinations.id, destinationId), eq(projectDestinations.projectId, context.projectId)))
      .limit(1)

    if (!destination) {
      return { success: false, error: 'Destination not found' }
    }

    if (!destination.isActive) {
      return { success: false, error: 'Destination is not active' }
    }

    let chaptersQuery = db
      .select()
      .from(entities)
      .where(eq(entities.projectId, context.projectId))

    if (collection) {
      chaptersQuery = chaptersQuery.where(
        and(eq(entities.projectId, context.projectId), eq(entities.collection, collection))
      ) as any
    }

    const chapters = await chaptersQuery

    if (chapters.length === 0) {
      return { success: true, data: { message: 'No chapters to sync', succeeded: 0, failed: 0 } }
    }

    const syncLogs = new Map<string, string>()
    for (const chapter of chapters) {
      const fileId = (chapter.entityData as any)?.driveFileId
      if (fileId) {
        syncLogs.set(chapter.id, fileId)
      }
    }

    const chapterContents: ChapterContent[] = chapters.map((chapter) => ({
      id: chapter.id,
      title: (chapter.entityData as any)?.title || 'Untitled',
      content: (chapter.entityData as any)?.content || '',
      projectId: chapter.projectId
    }))

    const { succeeded, failed, results } = await batchSyncChapters(
      chapterContents, destination, syncLogs, runtime.log, persistToken, deactivateDestination
    )

    for (const { chapterId, result } of results) {
      if (result.success && result.fileId) {
        const chapter = chapters.find((c) => c.id === chapterId)
        if (chapter) {
          await db
            .update(entities)
            .set({
              entityData: {
                ...(chapter.entityData as any),
                driveFileId: result.fileId,
                driveFileUrl: result.fileUrl,
                lastSyncedAt: new Date().toISOString()
              },
              updatedAt: new Date()
            })
            .where(eq(entities.id, chapterId))
        }
      }
    }

    const overallStatus = failed === 0 ? 'success' : succeeded > 0 ? 'partial' : 'failed'
    await db
      .update(projectDestinations)
      .set({
        lastSyncedAt: new Date(),
        lastSyncStatus: overallStatus,
        lastSyncError: failed > 0 ? `${failed} chapters failed to sync` : null,
        updatedAt: new Date()
      })
      .where(eq(projectDestinations.id, destinationId))

    return { success: true, data: { succeeded, failed, total: chapters.length } }
  } catch (error) {
    runtime.log.error({ error }, 'syncAllChapters action failed')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/**
 * Action: test_connection
 * Tests the Google Drive connection by calling the Drive About API
 */
export async function testConnection(
  params: { destinationId: string },
  context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const { db, projectDestinations, eq } = await createDbCallbacks()
    const { ensureFreshToken } = await import('../../../apps/api/src/routes/google-drive')

    const { destinationId } = params

    const [destination] = await db
      .select()
      .from(projectDestinations)
      .where(eq(projectDestinations.id, destinationId))
      .limit(1)

    if (!destination) {
      return { success: false, error: 'Destination not found' }
    }

    const config = destination.config as any

    if (!config.accessToken || !config.refreshToken) {
      return { success: false, error: 'Invalid configuration: missing credentials' }
    }

    const accessToken = await ensureFreshToken(destination)

    const resp = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!resp.ok) {
      const errText = await resp.text()
      return { success: false, error: `Drive API error (${resp.status}): ${errText}` }
    }

    const about = (await resp.json()) as {
      user?: { displayName?: string; emailAddress?: string }
    }

    return { success: true, data: { message: 'Connection successful', user: about.user } }
  } catch (error) {
    runtime.log.error({ error }, 'testConnection action failed')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export const syncChapterToDrive = syncToDrive
export const testDriveConnection = testConnection

// Action registry
export const actions = {
  authorize_drive: initiateDriveOAuth,
  sync_to_drive: syncToDrive,
  test_connection: testConnection,
  manual_sync_all: syncAllChapters
}
