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
import { randomUUID } from 'crypto'
import { eq, and, desc, sql } from 'drizzle-orm'
import { db } from '../db/connection'
import { uploads } from '../db/schema'
import { requireAuth, requireProjectOwnership } from '../middleware/auth'
import { generatePresignedPutUrl, headObject, deleteObject, getPublicUrl, getObject } from '../lib/s3'
import { generateVariants, variantKey } from '../lib/image-variants'
import { getUserMembershipTier, getSizeLimits } from '../lib/membership'
import { cleanupOldAvatarUploads } from '../lib/upload-cleanup'
import { userProfiles } from '../db/schema'

// --- Constants ---

// SVG is intentionally excluded — it can contain inline <script> that executes
// when a user opens the image URL directly (stored XSS on the API origin).
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

const UPLOAD_CONTEXTS = new Set(['cover', 'entity', 'editor', 'avatar', 'map'])

/** Size limits are now managed by getSizeLimits() in lib/membership.ts */

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
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

    // Require email verification for non-avatar uploads
    if (context !== 'avatar' && !user.emailVerified) {
      return reply.status(403).send({
        error: 'Email not verified',
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email address to upload files'
      })
    }

    // Validate content type
    if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
      return reply.status(400).send({ error: `Unsupported content type. Allowed: ${[...ALLOWED_IMAGE_TYPES].join(', ')}` })
    }

    // Validate file size (tier-aware)
    const tier = await getUserMembershipTier(user.id)
    const tierLimits = getSizeLimits(tier)
    const maxSize = tierLimits[context] ?? tierLimits.entity!
    if (!size || size <= 0 || size > maxSize) {
      const limitMB = Math.round(maxSize / (1024 * 1024))
      const hint = tier === 'free' ? ' Upgrade to Supporter for 2x upload limits.' : ''
      return reply.status(400).send({ error: `File size must be between 1 byte and ${limitMB}MB.${hint}` })
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

    // Generate image variants for cover and avatar contexts
    let variants: { thumb: string; medium: string } | undefined
    if (context === 'cover' || context === 'avatar') {
      try {
        await generateVariants(fileKey)
        variants = {
          thumb: getPublicUrl(variantKey(fileKey, 'thumb')),
          medium: getPublicUrl(variantKey(fileKey, 'medium')),
        }
      } catch (err) {
        fastify.log.warn({ err, key: fileKey }, 'Failed to generate image variants')
      }
    }

    // Auto-save avatar to user profile and clean up old avatars
    if (context === 'avatar') {
      try {
        // Clean up previous avatar uploads (S3 objects + DB records)
        await cleanupOldAvatarUploads(user.id, fileKey)

        // Upsert avatarUrl on user profile
        await db
          .insert(userProfiles)
          .values({ userId: user.id, avatarUrl: url })
          .onConflictDoUpdate({
            target: userProfiles.userId,
            set: { avatarUrl: url, updatedAt: new Date() },
          })
      } catch (err) {
        fastify.log.warn({ err, userId: user.id }, 'Failed to auto-save avatar to profile')
      }
    }

    return {
      id: upload.id,
      url,
      key: fileKey,
      contentType: upload.contentType,
      size: upload.size,
      ...(variants && { variants }),
    }
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

    // Delete from S3 (original + variants)
    try {
      await deleteObject(upload.s3Key)
    } catch (err) {
      fastify.log.error({ err, key: upload.s3Key }, 'Failed to delete S3 object')
      // Continue with soft delete even if S3 delete fails
    }

    // Best-effort cleanup of image variants
    if (upload.context === 'cover' || upload.context === 'avatar') {
      await Promise.allSettled([
        deleteObject(variantKey(upload.s3Key, 'thumb')),
        deleteObject(variantKey(upload.s3Key, 'medium')),
      ])
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

  // GET /images/:key — image proxy (serves only tracked uploads)
  fastify.get<{
    Params: { key: string }
  }>('/images/:key', async (request, reply) => {
    const key = decodeURIComponent(request.params.key)

    // Path traversal protection
    if (key.includes('..') || key.startsWith('/')) {
      return reply.status(400).send({ error: 'Invalid key' })
    }

    // Only serve images that exist in the uploads table with active status.
    // This prevents enumeration of arbitrary S3 keys and ensures removed
    // uploads are no longer accessible.
    // Also allow variant keys (e.g. "key__thumb.webp") by checking the base key.
    // variantKey() strips the original extension (e.g. .jpg) before adding __variant.webp,
    // so we need a LIKE match: "foo/bar__thumb.webp" → "foo/bar" → match "foo/bar.jpg"
    const isVariant = /__(?:thumb|medium)\.[a-z]+$/.test(key)
    const baseKey = key.replace(/__(?:thumb|medium)\.[a-z]+$/, '')
    const [upload] = await db
      .select({ status: uploads.status })
      .from(uploads)
      .where(isVariant ? sql`${uploads.s3Key} LIKE ${baseKey + '.%'}` : eq(uploads.s3Key, baseKey))
      .limit(1)

    if (!upload || upload.status !== 'active') {
      return reply.status(404).send({ error: 'Image not found' })
    }

    const result = await getObject(key)
    if (!result) {
      return reply.status(404).send({ error: 'Image not found' })
    }

    reply.header('Content-Type', result.contentType || 'application/octet-stream')
    if (result.contentLength) {
      reply.header('Content-Length', result.contentLength)
    }
    reply.header('Cache-Control', 'public, max-age=31536000, immutable')
    // Defense in depth: ensure no script can execute even if a legacy SVG or
    // mis-labeled file is served from this endpoint.
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    reply.header('X-Content-Type-Options', 'nosniff')

    return reply.send(result.body)
  })
}

export default uploadsPlugin
