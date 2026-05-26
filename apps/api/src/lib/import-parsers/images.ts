/**
 * Embedded-image upload helper for binary-format parsers.
 *
 * docx / epub / odt may carry inline images. Each parser pulls the image
 * bytes out, hands them here, and gets back a public URL it can drop into
 * the rewritten <img src>. The image is stored under the `editor` context
 * — same place the manuscript editor's drag-and-drop image-upload extension
 * puts inline images — so links work consistently once the chapter lands.
 *
 * Images of types Tiptap can't render (EMF, WMF, TIFF, BMP) are dropped
 * with a warning rather than uploaded; this matches the existing image
 * whitelist on `/api/uploads/presign`.
 */

import { randomUUID } from 'crypto'
import { db } from '../../db/connection'
import { uploads } from '../../db/schema'
import { putObject, getPublicUrl } from '../s3'

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const ALLOWED_MIMES = new Set(Object.keys(EXT_BY_MIME))

export interface ImageUploadResult {
  /** Public URL of the uploaded image, or null if skipped/failed. */
  url: string | null
  /** Human-readable reason if the image was not uploaded. */
  warning?: string
}

export async function uploadImportImage(
  buffer: Buffer,
  rawMime: string,
  ctx: { userId: string; projectId: string },
): Promise<ImageUploadResult> {
  const mime = (rawMime || '').toLowerCase()
  if (!ALLOWED_MIMES.has(mime)) {
    return {
      url: null,
      warning: `Skipped embedded image of unsupported type: ${rawMime || 'unknown'}`,
    }
  }
  if (buffer.length === 0) {
    return { url: null, warning: 'Skipped empty embedded image' }
  }

  const ext = EXT_BY_MIME[mime]!
  // Group images from a single import run under one synthetic "entity" so
  // they aren't scattered across the editor namespace.
  const batchId = randomUUID()
  const id = randomUUID()
  const key = `projects/${ctx.projectId}/editor/import-${batchId}/${id}.${ext}`

  try {
    await putObject(key, buffer, mime)
    await db.insert(uploads).values({
      userId: ctx.userId,
      projectId: ctx.projectId,
      s3Key: key,
      filename: null,
      contentType: mime,
      size: buffer.length,
      context: 'editor',
      status: 'active',
    })
    return { url: getPublicUrl(key) }
  } catch (err) {
    return {
      url: null,
      warning: `Failed to upload embedded image: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }
}
