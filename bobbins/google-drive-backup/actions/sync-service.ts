// ============================================
// GOOGLE DRIVE SYNC SERVICE
// ============================================
// Pure sync utility — no direct DB imports.
// Token persistence and destination deactivation
// are handled by callbacks or by the caller.

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

interface GoogleDriveConfig {
  folderId: string
  folderName?: string
  accessToken: string
  refreshToken: string
  tokenExpiresAt?: string
  autoSync?: boolean
  syncFormat?: 'markdown' | 'docx' | 'gdoc'
}

export interface SyncResult {
  success: boolean
  fileId?: string
  fileUrl?: string
  error?: string
}

export interface ChapterContent {
  id: string
  title: string
  content: string
  projectId: string
}

interface Logger {
  info: (obj: any, msg?: string) => void
  warn: (obj: any, msg?: string) => void
  error: (obj: any, msg?: string) => void
}

/**
 * Callback to persist refreshed tokens back to the DB.
 * Called by GoogleDriveClient when a token refresh occurs.
 */
type PersistTokenFn = (destinationId: string, accessToken: string, tokenExpiresAt: string) => Promise<void>

/**
 * Callback to deactivate a destination (e.g. when folder is deleted).
 */
type DeactivateDestinationFn = (destinationId: string, error: string) => Promise<void>

/**
 * Google Drive API client using raw fetch calls.
 */
class GoogleDriveClient {
  private accessToken: string
  private refreshToken: string
  private tokenExpiresAt: number
  private destinationId: string
  private config: GoogleDriveConfig
  private log: Logger
  private persistToken?: PersistTokenFn

  constructor(
    config: GoogleDriveConfig,
    destinationId: string,
    log: Logger,
    persistToken?: PersistTokenFn
  ) {
    this.accessToken = config.accessToken
    this.refreshToken = config.refreshToken
    this.tokenExpiresAt = config.tokenExpiresAt ? new Date(config.tokenExpiresAt).getTime() : 0
    this.destinationId = destinationId
    this.config = config
    this.log = log
    this.persistToken = persistToken
  }

  async ensureValidToken(): Promise<string> {
    const fiveMinutes = 5 * 60 * 1000
    if (Date.now() < this.tokenExpiresAt - fiveMinutes) {
      return this.accessToken
    }

    if (!this.refreshToken) {
      throw new Error('No refresh token available — user must re-authorize')
    }

    this.log.info({ destinationId: this.destinationId }, 'Refreshing Google Drive access token')

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GOOGLE_ID,
        client_secret: process.env.GOOGLE_SECRET,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Token refresh failed (${response.status}): ${errText}`)
    }

    const tokens = (await response.json()) as { access_token: string; expires_in: number }
    this.accessToken = tokens.access_token
    this.tokenExpiresAt = Date.now() + tokens.expires_in * 1000
    const newExpiresAt = new Date(this.tokenExpiresAt).toISOString()

    if (this.persistToken) {
      await this.persistToken(this.destinationId, this.accessToken, newExpiresAt)
    }

    return this.accessToken
  }

  async uploadFile(
    folderId: string,
    fileName: string,
    content: string,
    mimeType: string = 'text/markdown'
  ): Promise<SyncResult> {
    try {
      const token = await this.ensureValidToken()
      this.log.info({ fileName, folderId, mimeType }, 'Uploading file to Google Drive')

      const metadata: Record<string, unknown> = {
        name: fileName,
        parents: [folderId],
      }
      if (mimeType === 'application/vnd.google-apps.document') {
        metadata.mimeType = 'application/vnd.google-apps.document'
        mimeType = 'text/html'
      }

      const boundary = '----BobbinryDriveUpload'
      const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        `--${boundary}`,
        `Content-Type: ${mimeType}`,
        '',
        content,
        `--${boundary}--`,
      ].join('\r\n')

      const resp = await fetch(
        `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,webViewLink`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
        }
      )

      if (!resp.ok) {
        const errText = await resp.text()
        this.log.error({ status: resp.status, body: errText }, 'Drive upload failed')
        return { success: false, error: `Upload failed (${resp.status}): ${errText}` }
      }

      const file = (await resp.json()) as { id: string; webViewLink: string }
      return { success: true, fileId: file.id, fileUrl: file.webViewLink }
    } catch (error) {
      this.log.error({ error }, 'Failed to upload file to Google Drive')
      return { success: false, error: error instanceof Error ? error.message : 'Unknown upload error' }
    }
  }

  async updateFile(
    fileId: string,
    content: string,
    mimeType: string = 'text/markdown'
  ): Promise<SyncResult> {
    try {
      const token = await this.ensureValidToken()
      this.log.info({ fileId, mimeType }, 'Updating file in Google Drive')

      const resp = await fetch(
        `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media&fields=id,webViewLink`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': mimeType,
          },
          body: content,
        }
      )

      if (resp.status === 404) {
        return { success: false, error: 'file_not_found' }
      }

      if (!resp.ok) {
        const errText = await resp.text()
        this.log.error({ status: resp.status, body: errText }, 'Drive update failed')
        return { success: false, error: `Update failed (${resp.status}): ${errText}` }
      }

      const file = (await resp.json()) as { id: string; webViewLink: string }
      return { success: true, fileId: file.id, fileUrl: file.webViewLink }
    } catch (error) {
      this.log.error({ error, fileId }, 'Failed to update file in Google Drive')
      return { success: false, error: error instanceof Error ? error.message : 'Unknown update error' }
    }
  }

  async fileExists(fileId: string): Promise<boolean> {
    try {
      const token = await this.ensureValidToken()
      const resp = await fetch(`${DRIVE_API}/files/${fileId}?fields=id,trashed`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (resp.status === 404) return false
      if (!resp.ok) return false
      const file = (await resp.json()) as { id: string; trashed: boolean }
      return !file.trashed
    } catch {
      return false
    }
  }

  async folderExists(folderId: string): Promise<boolean> {
    try {
      const token = await this.ensureValidToken()
      const resp = await fetch(`${DRIVE_API}/files/${folderId}?fields=id,trashed,mimeType`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (resp.status === 404) return false
      if (!resp.ok) return false
      const file = (await resp.json()) as { id: string; trashed: boolean; mimeType: string }
      return !file.trashed && file.mimeType === 'application/vnd.google-apps.folder'
    } catch {
      return false
    }
  }
}

/**
 * Sync a chapter to Google Drive.
 *
 * @param persistToken - callback to save refreshed tokens to DB
 * @param deactivateDestination - callback to deactivate destination on folder deletion
 */
export async function syncChapterToGoogleDrive(
  chapter: ChapterContent,
  destination: any,
  existingFileId: string | null,
  log: Logger,
  persistToken?: PersistTokenFn,
  deactivateDestination?: DeactivateDestinationFn
): Promise<SyncResult> {
  try {
    const config = destination.config as GoogleDriveConfig

    if (!config.folderId || !config.accessToken || !config.refreshToken) {
      return { success: false, error: 'Invalid Google Drive configuration: missing credentials or folder' }
    }

    const client = new GoogleDriveClient(config, destination.id, log, persistToken)

    // Check if target folder still exists
    const folderOk = await client.folderExists(config.folderId)
    if (!folderOk) {
      if (deactivateDestination) {
        await deactivateDestination(
          destination.id,
          'Google Drive folder was deleted or moved. Please reconfigure.'
        )
      }
      return { success: false, error: 'folder_deleted' }
    }

    const format = config.syncFormat || 'markdown'
    const content = convertChapterToFormat(chapter, format)
    const fileName = sanitizeFileName(chapter.title) + getFileExtension(format)
    const mimeType = getMimeType(format)

    let result: SyncResult

    if (existingFileId) {
      const fileOk = await client.fileExists(existingFileId)
      if (fileOk) {
        result = await client.updateFile(existingFileId, content, mimeType)
      } else {
        result = await client.uploadFile(config.folderId, fileName, content, mimeType)
      }
    } else {
      result = await client.uploadFile(config.folderId, fileName, content, mimeType)
    }

    return result
  } catch (error) {
    log.error({ error, chapterId: chapter.id }, 'Failed to sync chapter to Google Drive')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown sync error' }
  }
}

function convertChapterToFormat(chapter: ChapterContent, format: string): string {
  const content = chapter.content || ''
  switch (format) {
    case 'markdown':
      return `# ${chapter.title}\n\n${content}`
    case 'docx':
      return `# ${chapter.title}\n\n${content}`
    case 'gdoc':
      return `<h1>${escapeHtml(chapter.title)}</h1>\n<p>${escapeHtml(content)}</p>`
    default:
      return `# ${chapter.title}\n\n${content}`
  }
}

function sanitizeFileName(title: string): string {
  return title
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100)
}

function getFileExtension(format: string): string {
  switch (format) {
    case 'markdown': return '.md'
    case 'docx': return '.docx'
    case 'gdoc': return ''
    default: return '.txt'
  }
}

function getMimeType(format: string): string {
  switch (format) {
    case 'markdown': return 'text/markdown'
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'gdoc': return 'application/vnd.google-apps.document'
    default: return 'text/plain'
  }
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

/**
 * Batch sync multiple chapters
 */
export async function batchSyncChapters(
  chapters: ChapterContent[],
  destination: any,
  syncLogs: Map<string, string>,
  log: Logger,
  persistToken?: PersistTokenFn,
  deactivateDestination?: DeactivateDestinationFn,
  onProgress?: (completed: number, total: number) => void
): Promise<{ succeeded: number; failed: number; results: Array<{ chapterId: string; result: SyncResult }> }> {
  const results: Array<{ chapterId: string; result: SyncResult }> = []
  let succeeded = 0
  let failed = 0

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i]
    const existingFileId = syncLogs.get(chapter.id) || null

    const result = await syncChapterToGoogleDrive(
      chapter, destination, existingFileId, log, persistToken, deactivateDestination
    )
    results.push({ chapterId: chapter.id, result })

    if (result.success) {
      succeeded++
    } else {
      failed++
      if (result.error === 'folder_deleted') break
    }

    if (onProgress) {
      onProgress(i + 1, chapters.length)
    }
  }

  return { succeeded, failed, results }
}
