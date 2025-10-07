/**
 * Google Drive Publisher Bobbin - Action Handlers
 *
 * These handlers implement the custom actions defined in the manifest.
 * They are invoked by the API when the bobbin receives action requests via the message bus.
 */

import type { FastifyInstance } from 'fastify'

export interface ActionContext {
  projectId: string
  bobbinId: string
  viewId?: string
  userId?: string
  entityId?: string
}

export interface ActionResult {
  success: boolean
  data?: any
  error?: string
}

// Re-export sync service functions
import {
  syncChapterToGoogleDrive,
  batchSyncChapters,
  type SyncResult,
  type ChapterContent
} from './sync-service'

export { syncChapterToGoogleDrive, batchSyncChapters }

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
  fastify: FastifyInstance
): Promise<ActionResult> {
  try {
    const { db } = await import('../../../apps/api/src/db/connection')
    const { entities, projectDestinations } = await import('../../../apps/api/src/db/schema')
    const { eq, and } = await import('drizzle-orm')

    const { chapterId, destinationId, force } = params

    // Get chapter
    const [chapter] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.id, chapterId), eq(entities.projectId, context.projectId)))
      .limit(1)

    if (!chapter) {
      return { success: false, error: 'Chapter not found' }
    }

    // Get destination
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

    // Check if already synced
    const existingFileId = (chapter.data as any)?.driveFileId || null

    if (existingFileId && !force) {
      return {
        success: true,
        data: {
          message: 'Chapter already synced',
          fileId: existingFileId,
          skipped: true
        }
      }
    }

    // Sync to Google Drive
    const chapterContent: ChapterContent = {
      id: chapter.id,
      title: (chapter.data as any)?.title || 'Untitled',
      content: (chapter.data as any)?.content || '',
      projectId: chapter.projectId
    }

    const result = await syncChapterToGoogleDrive(chapterContent, destination, existingFileId, fastify)

    // Update destination sync status
    await db
      .update(projectDestinations)
      .set({
        lastSyncedAt: new Date(),
        lastSyncStatus: result.success ? 'success' : 'failed',
        lastSyncError: result.error || null,
        updatedAt: new Date()
      })
      .where(eq(projectDestinations.id, destinationId))

    // Store file ID in chapter data if successful
    if (result.success && result.fileId) {
      await db
        .update(entities)
        .set({
          data: {
            ...(chapter.data as any),
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
      data: result.success
        ? { fileId: result.fileId, fileUrl: result.fileUrl }
        : undefined,
      error: result.error
    }
  } catch (error) {
    fastify.log.error({ error }, 'syncToDrive action failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
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
  fastify: FastifyInstance
): Promise<ActionResult> {
  try {
    const { db } = await import('../../../apps/api/src/db/connection')
    const { entities, projectDestinations } = await import('../../../apps/api/src/db/schema')
    const { eq, and } = await import('drizzle-orm')

    const { destinationId, collection, publishedOnly } = params

    // Get destination
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

    // Get chapters to sync
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
      return {
        success: true,
        data: { message: 'No chapters to sync', succeeded: 0, failed: 0 }
      }
    }

    // Build sync logs map
    const syncLogs = new Map<string, string>()
    for (const chapter of chapters) {
      const fileId = (chapter.data as any)?.driveFileId
      if (fileId) {
        syncLogs.set(chapter.id, fileId)
      }
    }

    // Convert to chapter content format
    const chapterContents: ChapterContent[] = chapters.map((chapter) => ({
      id: chapter.id,
      title: (chapter.data as any)?.title || 'Untitled',
      content: (chapter.data as any)?.content || '',
      projectId: chapter.projectId
    }))

    // Batch sync
    const { succeeded, failed, results } = await batchSyncChapters(
      chapterContents,
      destination,
      syncLogs,
      fastify
    )

    // Update chapter data with file IDs
    for (const { chapterId, result } of results) {
      if (result.success && result.fileId) {
        const chapter = chapters.find((c) => c.id === chapterId)
        if (chapter) {
          await db
            .update(entities)
            .set({
              data: {
                ...(chapter.data as any),
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

    // Update destination sync status
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

    return {
      success: true,
      data: {
        succeeded,
        failed,
        total: chapters.length
      }
    }
  } catch (error) {
    fastify.log.error({ error }, 'syncAllChapters action failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Action: test_connection
 * Tests the Google Drive connection
 */
export async function testConnection(
  params: {
    destinationId: string
  },
  context: ActionContext,
  fastify: FastifyInstance
): Promise<ActionResult> {
  try {
    const { db } = await import('../../../apps/api/src/db/connection')
    const { projectDestinations } = await import('../../../apps/api/src/db/schema')
    const { eq } = await import('drizzle-orm')

    const { destinationId } = params

    // Get destination
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

    // TODO: Test connection with googleapis
    // Simulated success for now
    fastify.log.info({ destinationId }, 'Drive connection test simulated')

    return {
      success: true,
      data: {
        message: 'Connection test successful (simulated)',
        user: {
          displayName: 'Test User',
          emailAddress: 'test@example.com'
        }
      }
    }
  } catch (error) {
    fastify.log.error({ error }, 'testConnection action failed')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Action registry - maps action IDs from manifest to handler functions
export const actions = {
  sync_to_drive: syncToDrive,
  sync_all_chapters: syncAllChapters,
  test_connection: testConnection
}

export type ActionHandler = (
  params: any,
  context: ActionContext,
  fastify: FastifyInstance
) => Promise<ActionResult>
