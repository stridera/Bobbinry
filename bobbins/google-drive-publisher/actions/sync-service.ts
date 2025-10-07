import type { FastifyInstance } from 'fastify'
import { db } from '../db/connection'
import { entities, projectDestinations } from '../db/schema'
import { eq, and } from 'drizzle-orm'

// ============================================
// GOOGLE DRIVE SYNC SERVICE
// ============================================

interface GoogleDriveConfig {
  folderId: string
  folderName?: string
  accessToken: string
  refreshToken: string
  tokenExpiresAt?: string
  autoSync?: boolean
  syncFormat?: 'markdown' | 'docx' | 'gdoc'
}

interface SyncResult {
  success: boolean
  fileId?: string
  fileUrl?: string
  error?: string
}

interface ChapterContent {
  id: string
  title: string
  content: string
  projectId: string
}

/**
 * Google Drive API client wrapper
 * NOTE: This is a placeholder implementation. In production:
 * - Install googleapis package: pnpm add googleapis
 * - Use official Google Drive API client
 * - Handle token refresh automatically
 */
class GoogleDriveClient {
  private accessToken: string
  private refreshToken: string
  private fastify: FastifyInstance

  constructor(accessToken: string, refreshToken: string, fastify: FastifyInstance) {
    this.accessToken = accessToken
    this.refreshToken = refreshToken
    this.fastify = fastify
  }

  /**
   * Refresh the access token if expired
   * TODO: Implement actual token refresh with Google OAuth
   */
  async refreshAccessToken(): Promise<string> {
    // Placeholder: In production, call Google's token endpoint
    this.fastify.log.warn('GoogleDriveClient.refreshAccessToken: TODO - Implement token refresh')

    // const response = await fetch('https://oauth2.googleapis.com/token', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     client_id: process.env.GOOGLE_CLIENT_ID,
    //     client_secret: process.env.GOOGLE_CLIENT_SECRET,
    //     refresh_token: this.refreshToken,
    //     grant_type: 'refresh_token'
    //   })
    // })
    // const data = await response.json()
    // this.accessToken = data.access_token
    // return data.access_token

    return this.accessToken
  }

  /**
   * Upload a file to Google Drive
   */
  async uploadFile(
    folderId: string,
    fileName: string,
    content: string,
    mimeType: string = 'text/markdown'
  ): Promise<SyncResult> {
    try {
      this.fastify.log.info({ fileName, folderId, mimeType }, 'Uploading file to Google Drive')

      // Placeholder: In production, use googleapis library
      // const drive = google.drive({ version: 'v3', auth: this.getAuth() })
      // const response = await drive.files.create({
      //   requestBody: {
      //     name: fileName,
      //     parents: [folderId],
      //     mimeType: 'application/vnd.google-apps.document' // For Google Docs
      //   },
      //   media: {
      //     mimeType: mimeType,
      //     body: content
      //   },
      //   fields: 'id, webViewLink'
      // })
      //
      // return {
      //   success: true,
      //   fileId: response.data.id,
      //   fileUrl: response.data.webViewLink
      // }

      // Simulated response
      const mockFileId = `gdrive_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const mockUrl = `https://docs.google.com/document/d/${mockFileId}/edit`

      this.fastify.log.info({ mockFileId, mockUrl }, 'File upload simulated (googleapis not installed)')

      return {
        success: true,
        fileId: mockFileId,
        fileUrl: mockUrl
      }
    } catch (error) {
      this.fastify.log.error({ error }, 'Failed to upload file to Google Drive')
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown upload error'
      }
    }
  }

  /**
   * Update an existing file in Google Drive
   */
  async updateFile(
    fileId: string,
    content: string,
    mimeType: string = 'text/markdown'
  ): Promise<SyncResult> {
    try {
      this.fastify.log.info({ fileId, mimeType }, 'Updating file in Google Drive')

      // Placeholder: In production, use googleapis library
      // const drive = google.drive({ version: 'v3', auth: this.getAuth() })
      // await drive.files.update({
      //   fileId: fileId,
      //   media: {
      //     mimeType: mimeType,
      //     body: content
      //   }
      // })
      //
      // const file = await drive.files.get({
      //   fileId: fileId,
      //   fields: 'id, webViewLink'
      // })
      //
      // return {
      //   success: true,
      //   fileId: file.data.id,
      //   fileUrl: file.data.webViewLink
      // }

      // Simulated response
      const mockUrl = `https://docs.google.com/document/d/${fileId}/edit`

      this.fastify.log.info({ fileId, mockUrl }, 'File update simulated (googleapis not installed)')

      return {
        success: true,
        fileId: fileId,
        fileUrl: mockUrl
      }
    } catch (error) {
      this.fastify.log.error({ error, fileId }, 'Failed to update file in Google Drive')
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown update error'
      }
    }
  }

  /**
   * Check if a file exists in Google Drive
   */
  async fileExists(fileId: string): Promise<boolean> {
    try {
      // Placeholder: In production, use googleapis library
      // const drive = google.drive({ version: 'v3', auth: this.getAuth() })
      // await drive.files.get({ fileId: fileId, fields: 'id' })
      // return true

      // Simulated: assume file exists if fileId looks valid
      const exists = fileId.startsWith('gdrive_')
      this.fastify.log.info({ fileId, exists }, 'File existence check simulated')
      return exists
    } catch (error) {
      return false
    }
  }

  /**
   * List files in a folder
   */
  async listFiles(folderId: string): Promise<Array<{ id: string; name: string }>> {
    try {
      // Placeholder: In production, use googleapis library
      // const drive = google.drive({ version: 'v3', auth: this.getAuth() })
      // const response = await drive.files.list({
      //   q: `'${folderId}' in parents and trashed = false`,
      //   fields: 'files(id, name)',
      //   pageSize: 100
      // })
      // return response.data.files || []

      this.fastify.log.info({ folderId }, 'List files simulated')
      return []
    } catch (error) {
      this.fastify.log.error({ error, folderId }, 'Failed to list files')
      return []
    }
  }
}

/**
 * Sync a chapter to Google Drive
 */
export async function syncChapterToGoogleDrive(
  chapter: ChapterContent,
  destination: any,
  existingFileId: string | null,
  fastify: FastifyInstance
): Promise<SyncResult> {
  try {
    const config = destination.config as GoogleDriveConfig

    if (!config.folderId || !config.accessToken || !config.refreshToken) {
      return {
        success: false,
        error: 'Invalid Google Drive configuration: missing credentials'
      }
    }

    // Create Google Drive client
    const client = new GoogleDriveClient(config.accessToken, config.refreshToken, fastify)

    // Convert chapter content to desired format
    const content = convertChapterToFormat(chapter, config.syncFormat || 'markdown')
    const fileName = sanitizeFileName(chapter.title) + getFileExtension(config.syncFormat || 'markdown')
    const mimeType = getMimeType(config.syncFormat || 'markdown')

    // Upload or update
    let result: SyncResult

    if (existingFileId) {
      // Update existing file
      const fileExists = await client.fileExists(existingFileId)
      if (fileExists) {
        result = await client.updateFile(existingFileId, content, mimeType)
      } else {
        // File was deleted, create new one
        result = await client.uploadFile(config.folderId, fileName, content, mimeType)
      }
    } else {
      // Create new file
      result = await client.uploadFile(config.folderId, fileName, content, mimeType)
    }

    return result
  } catch (error) {
    fastify.log.error({ error, chapterId: chapter.id }, 'Failed to sync chapter to Google Drive')
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown sync error'
    }
  }
}

/**
 * Convert chapter content to desired format
 */
function convertChapterToFormat(chapter: ChapterContent, format: string): string {
  // Extract content from JSONB data
  const content = chapter.content || ''

  switch (format) {
    case 'markdown':
      return `# ${chapter.title}\n\n${content}`

    case 'docx':
      // TODO: Convert to DOCX format
      // In production, use a library like docx or mammoth
      return `# ${chapter.title}\n\n${content}`

    case 'gdoc':
      // Google Docs format (HTML)
      return `<h1>${escapeHtml(chapter.title)}</h1>\n<p>${escapeHtml(content)}</p>`

    default:
      return `# ${chapter.title}\n\n${content}`
  }
}

/**
 * Sanitize filename for Google Drive
 */
function sanitizeFileName(title: string): string {
  return title
    .replace(/[<>:"/\\|?*]/g, '_') // Remove invalid characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .substring(0, 100) // Limit length
}

/**
 * Get file extension for format
 */
function getFileExtension(format: string): string {
  switch (format) {
    case 'markdown':
      return '.md'
    case 'docx':
      return '.docx'
    case 'gdoc':
      return '' // Google Docs don't have extensions
    default:
      return '.txt'
  }
}

/**
 * Get MIME type for format
 */
function getMimeType(format: string): string {
  switch (format) {
    case 'markdown':
      return 'text/markdown'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'gdoc':
      return 'application/vnd.google-apps.document'
    default:
      return 'text/plain'
  }
}

/**
 * Escape HTML entities
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

/**
 * Batch sync multiple chapters
 */
export async function batchSyncChapters(
  chapters: ChapterContent[],
  destination: any,
  syncLogs: Map<string, string>, // chapterId -> fileId
  fastify: FastifyInstance,
  onProgress?: (completed: number, total: number) => void
): Promise<{ succeeded: number; failed: number; results: Array<{ chapterId: string; result: SyncResult }> }> {
  const results: Array<{ chapterId: string; result: SyncResult }> = []
  let succeeded = 0
  let failed = 0

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i]
    const existingFileId = syncLogs.get(chapter.id) || null

    const result = await syncChapterToGoogleDrive(chapter, destination, existingFileId, fastify)

    results.push({ chapterId: chapter.id, result })

    if (result.success) {
      succeeded++
    } else {
      failed++
    }

    if (onProgress) {
      onProgress(i + 1, chapters.length)
    }
  }

  return { succeeded, failed, results }
}
