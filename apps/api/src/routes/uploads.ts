/**
 * Upload Routes
 *
 * Presigned URL upload flow:
 *   1. POST /uploads/presign — get a presigned PUT URL for direct browser→S3 upload
 *   2. Browser PUTs file directly to MinIO/R2 (bypasses API server)
 *   3. POST /uploads/confirm — verify the file landed and save audit metadata
 *
 * Additional endpoints:
 *   POST /uploads/:id/report — flag an image for moderation
 *   DELETE /uploads/:id — soft-delete + remove from S3
 *   GET /uploads — list uploads (own or admin)
 */

import { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import { randomUUID } from 'crypto'
import { eq, and, desc, sql } from 'drizzle-orm'
import { db } from '../db/connection'
import { uploads } from '../db/schema'
import { requireAuth, requireProjectOwnership } from '../middleware/auth'
import { generatePresignedPutUrl, headObject, deleteObject, getPublicUrl } from '../lib/s3'

// --- Constants ---

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
])

const UPLOAD_CONTEXTS = new Set(['cover', 'entity', 'editor', 'avatar', 'map'])

/** Max file sizes in bytes */
const SIZE_LIMITS: Record<string, number> = {
  cover: 10 * 1024 * 1024,   // 10 MB
  entity: 10 * 1024 * 1024,  // 10 MB
  editor: 10 * 1024 * 1024,  // 10 MB
  avatar: 5 * 1024 * 1024,   // 5 MB
  map: 50 * 1024 * 1024,     // 50 MB
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
  }
  return map[mime] || 'bin'
}

function buildS3Key(opts: {
  context: string
  projectId?: string | undefined
  userId: string
  entityId?: string | undefined
  collection?: string | undefined
  filename: string
  contentType: string
}): string {
  const id = randomUUID()
  const ext = extFromMime(opts.contentType)

  switch (opts.context) {
    case 'cover':
      return `projects/${opts.projectId}/covers/${id}.${ext}`
    case 'entity':
      return `projects/${opts.projectId}/entities/${opts.collection || '_'}/${opts.entityId || '_'}/${id}.${ext}`
    case 'editor':
      return `projects/${opts.projectId}/editor/${opts.entityId || '_'}/${id}.${ext}`
    case 'avatar':
      return `users/${opts.userId}/avatars/${id}.${ext}`
    case 'map':
      return `projects/${opts.projectId}/entities/${opts.collection || '_'}/${opts.entityId || '_'}/${id}.${ext}`
    default:
      return `misc/${id}.${ext}`
  }
}

// --- Plugin ---

async function uploadsPlugin(fastify: FastifyInstance) {

  // POST /uploads/presign — request a presigned upload URL
  fastify.post<{
    Body: {
      filename: string
      contentType: string
      size: number
      context: string
      projectId?: string
      entityId?: string
      collection?: string
    }
  }>('/uploads/presign', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { filename, contentType, size, context, projectId, entityId, collection } = request.body
    const user = request.user!

    // Validate context
    if (!context || !UPLOAD_CONTEXTS.has(context)) {
      return reply.status(400).send({ error: `Invalid upload context. Must be one of: ${[...UPLOAD_CONTEXTS].join(', ')}` })
    }

    // Validate content type
    if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
      return reply.status(400).send({ error: `Unsupported content type. Allowed: ${[...ALLOWED_IMAGE_TYPES].join(', ')}` })
    }

    // Validate file size
    const maxSize = SIZE_LIMITS[context] ?? SIZE_LIMITS.entity!
    if (!size || size <= 0 || size > maxSize) {
      return reply.status(400).send({ error: `File size must be between 1 byte and ${Math.round(maxSize / (1024 * 1024))}MB` })
    }

    // Project ownership check (not needed for avatars)
    if (context !== 'avatar') {
      if (!projectId) {
        return reply.status(400).send({ error: 'projectId is required for non-avatar uploads' })
      }
      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return
    }

    // Generate S3 key
    const fileKey = buildS3Key({
      context,
      projectId,
      userId: user.id,
      entityId,
      collection,
      filename,
      contentType,
    })

    // Generate presigned URL
    const { url: uploadUrl, expiresAt } = await generatePresignedPutUrl(fileKey, contentType, size)

    return {
      uploadUrl,
      fileKey,
      expiresAt,
    }
  })

  // POST /uploads/confirm — verify upload and save metadata
  fastify.post<{
    Body: {
      fileKey: string
      filename?: string
      contentType: string
      size: number
      context: string
      projectId?: string
    }
  }>('/uploads/confirm', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { fileKey, filename, contentType, size, context, projectId } = request.body
    const user = request.user!

    if (!fileKey || !contentType || !size || !context) {
      return reply.status(400).send({ error: 'Missing required fields: fileKey, contentType, size, context' })
    }

    // Verify the object actually exists in S3
    const objectInfo = await headObject(fileKey)
    if (!objectInfo) {
      return reply.status(400).send({ error: 'File not found in storage. Upload may have failed.' })
    }

    // Insert audit record
    const [upload] = await db
      .insert(uploads)
      .values({
        userId: user.id,
        projectId: projectId || null,
        s3Key: fileKey,
        filename: filename || null,
        contentType,
        size: objectInfo.contentLength || size,
        context,
        status: 'active',
      })
      .returning()

    if (!upload) {
      return reply.status(500).send({ error: 'Failed to create upload record' })
    }

    const url = getPublicUrl(fileKey)

    return {
      id: upload.id,
      url,
      key: fileKey,
      contentType: upload.contentType,
      size: upload.size,
    }
  })

  // POST /uploads/:id/report — flag an image for review
  fastify.post<{
    Params: { id: string }
  }>('/uploads/:id/report', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { id } = request.params

    const [upload] = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, id))
      .limit(1)

    if (!upload) {
      return reply.status(404).send({ error: 'Upload not found' })
    }

    if (upload.status === 'removed') {
      return reply.status(400).send({ error: 'Upload has already been removed' })
    }

    await db
      .update(uploads)
      .set({ status: 'reported', updatedAt: new Date() })
      .where(eq(uploads.id, id))

    return { success: true, status: 'reported' }
  })

  // DELETE /uploads/:id — delete an uploaded file (owner only)
  fastify.delete<{
    Params: { id: string }
  }>('/uploads/:id', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const user = request.user!
    const { id } = request.params

    const [upload] = await db
      .select()
      .from(uploads)
      .where(eq(uploads.id, id))
      .limit(1)

    if (!upload) {
      return reply.status(404).send({ error: 'Upload not found' })
    }

    // Only owner can delete
    if (upload.userId !== user.id) {
      return reply.status(403).send({ error: 'You can only delete your own uploads' })
    }

    // Delete from S3
    try {
      await deleteObject(upload.s3Key)
    } catch (err) {
      fastify.log.error({ err, key: upload.s3Key }, 'Failed to delete S3 object')
      // Continue with soft delete even if S3 delete fails
    }

    // Soft delete — keep audit trail
    await db
      .update(uploads)
      .set({ status: 'removed', updatedAt: new Date() })
      .where(eq(uploads.id, id))

    return { success: true, status: 'removed' }
  })

  // GET /uploads — list uploads
  fastify.get<{
    Querystring: {
      projectId?: string
      status?: string
      context?: string
      limit?: string
      offset?: string
    }
  }>('/uploads', {
    preHandler: requireAuth,
  }, async (request, _reply) => {
    const user = request.user!
    const { projectId, status, context, limit: limitStr, offset: offsetStr } = request.query

    const limit = Math.min(parseInt(limitStr || '50', 10), 100)
    const offset = parseInt(offsetStr || '0', 10)

    const conditions = [eq(uploads.userId, user.id)]

    if (projectId) {
      conditions.push(eq(uploads.projectId, projectId))
    }
    if (status) {
      conditions.push(eq(uploads.status, status))
    }
    if (context) {
      conditions.push(eq(uploads.context, context))
    }

    const results = await db
      .select()
      .from(uploads)
      .where(and(...conditions))
      .orderBy(desc(uploads.createdAt))
      .limit(limit)
      .offset(offset)

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(uploads)
      .where(and(...conditions))

    return {
      uploads: results.map(u => ({
        ...u,
        url: u.status === 'active' ? getPublicUrl(u.s3Key) : null,
      })),
      total: countResult?.count || 0,
      limit,
      offset,
    }
  })
}

export default fp(uploadsPlugin, { name: 'uploads-plugin' })
