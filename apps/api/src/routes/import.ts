/**
 * Manuscript-import routes.
 *
 *   POST /import/parse  — read an uploaded source file from S3, dispatch to
 *                         the format-specific parser, return proposed
 *                         segments + warnings, delete the source from S3.
 *   POST /import/commit — validate the target container, sanitize each
 *                         segment's HTML, then atomically insert each
 *                         segment as a `content` entity under the
 *                         manuscript bobbin.
 *
 * Commit is the core import "waist": any client — the built-in wizard or an
 * import-source bobbin — writes manuscript content through it, so HTML
 * sanitization happens here, not only in the format parsers.
 */

import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/connection'
import { entities, uploads } from '../db/schema'
import { requireAuth, requireProjectOwnership, assertEntityScope } from '../middleware/auth'
import { getObject, deleteObject } from '../lib/s3'
import {
  findBobbinForCollectionAcrossScopes,
} from '../lib/disk-manifests'
import { getEffectiveBobbins } from '../lib/effective-bobbins'
import { getMaxContentOrder, resolveContentTypeColumn } from './entities'
import {
  formatFromMime,
  parseBuffer,
  UnsupportedFormatError,
  type ImportSegment,
  type ImportWarning,
} from '../lib/import-parsers'
import { ZipBombError } from '../lib/import-parsers/zip-safe'
import { sanitizeImportedHtml } from '../lib/sanitize-html'
import { diffEntityData, extractWordCount, recordEntityChanges, type EntityChangeEvent } from '../lib/entity-changes'
import {
  serverEventBus,
  importParseCompleted,
  importParseFailed,
  importCommitCompleted,
  importCommitFailed,
} from '../lib/event-bus'

const PARSE_PAYLOAD_CAP_BYTES = 10 * 1024 * 1024 // 10 MB JSON response cap
const COMMIT_MAX_SEGMENTS = 500

const ParseRequestSchema = z.object({
  fileKey: z.string().min(1).max(1024),
  projectId: z.string().uuid('Invalid project ID format'),
})

const CommitRequestSchema = z.object({
  projectId: z.string().uuid('Invalid project ID format'),
  // Optional. Omit (or null) to land the chapters at root — i.e. with no
  // container_id, so they show as top-level items in the manuscript outline.
  containerId: z.string().uuid('Invalid container ID format').optional().nullable(),
  segments: z.array(z.object({
    title: z.string().min(1).max(500),
    html: z.string().max(2 * 1024 * 1024), // 2 MB per chapter is plenty
  }))
    .min(1, 'At least one segment required')
    .max(COMMIT_MAX_SEGMENTS, `Cannot commit more than ${COMMIT_MAX_SEGMENTS} segments at once`),
})

/** Drain an S3 response body to a Buffer. The AWS SDK returns the body as a
 *  Node Readable in our environment; we read it fully because the parsers
 *  need the whole document at once. */
async function streamToBuffer(stream: NodeJS.ReadableStream | ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  const nodeStream = stream as NodeJS.ReadableStream
  for await (const chunk of nodeStream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array))
  }
  return Buffer.concat(chunks)
}

function countWordsFromHtml(html: string): number {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0)
    .length
}

const importPlugin: FastifyPluginAsync = async (fastify) => {

  // POST /import/parse — turn an uploaded source file into proposed segments.
  fastify.post<{
    Body: { fileKey: string; projectId: string }
  }>('/import/parse', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const startedAt = Date.now()
    let resolvedFormat: string | null = null
    let resolvedProjectId: string | null = null
    let resolvedUserId: string | null = null

    const emitFailure = (code: string) => {
      if (resolvedProjectId && resolvedUserId) {
        serverEventBus.fire(importParseFailed(
          resolvedProjectId,
          resolvedUserId,
          resolvedFormat,
          code,
          Date.now() - startedAt,
        ))
      }
    }

    try {
      const body = ParseRequestSchema.parse(request.body)
      const { fileKey, projectId } = body
      const user = request.user!
      resolvedProjectId = projectId
      resolvedUserId = user.id

      // Import always produces manuscript content (chapters/scenes) — gate on the
      // manuscript scope so a key without it can't seed the manuscript indirectly.
      if (!assertEntityScope(request, reply, 'content', 'write')) return

      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      // Look up the upload row — also enforces ownership and context.
      const [upload] = await db
        .select({
          s3Key: uploads.s3Key,
          contentType: uploads.contentType,
          size: uploads.size,
          status: uploads.status,
        })
        .from(uploads)
        .where(and(
          eq(uploads.s3Key, fileKey),
          eq(uploads.userId, user.id),
          eq(uploads.projectId, projectId),
          eq(uploads.context, 'import'),
        ))
        .limit(1)

      if (!upload || upload.status !== 'active') {
        emitFailure('IMPORT_UPLOAD_NOT_FOUND')
        return reply.status(404).send({
          error: 'Upload not found for this project',
          code: 'IMPORT_UPLOAD_NOT_FOUND',
        })
      }

      const format = formatFromMime(upload.contentType)
      if (!format) {
        emitFailure('IMPORT_FORMAT_UNSUPPORTED')
        return reply.status(400).send({
          error: `Unsupported import format: ${upload.contentType}`,
          code: 'IMPORT_FORMAT_UNSUPPORTED',
        })
      }
      resolvedFormat = format

      // Fetch source file from S3.
      const obj = await getObject(fileKey)
      if (!obj) {
        emitFailure('IMPORT_SOURCE_MISSING')
        return reply.status(404).send({
          error: 'Source file no longer present in storage',
          code: 'IMPORT_SOURCE_MISSING',
        })
      }

      let buffer: Buffer
      try {
        buffer = await streamToBuffer(obj.body)
      } catch (err) {
        fastify.log.error({ err, fileKey }, 'Failed to read import source from S3')
        emitFailure('IMPORT_SOURCE_READ_FAILED')
        return reply.status(500).send({
          error: 'Failed to read source file',
          code: 'IMPORT_SOURCE_READ_FAILED',
        })
      }

      let segments: ImportSegment[] = []
      let warnings: ImportWarning[] = []
      let parseError: { status: number; code: string; message: string } | null = null

      try {
        const result = await parseBuffer(format, buffer, { userId: user.id, projectId })
        segments = result.segments
        warnings = result.warnings
      } catch (err) {
        if (err instanceof UnsupportedFormatError) {
          parseError = {
            status: 501,
            code: 'IMPORT_FORMAT_NOT_YET_IMPLEMENTED',
            message: `Format '${err.format}' is recognized but not yet supported in this build`,
          }
        } else if (err instanceof ZipBombError) {
          parseError = {
            status: 413,
            code: 'IMPORT_ZIP_BOMB',
            message: err.message,
          }
        } else {
          fastify.log.error({ err, format, fileKey }, 'Import parser failed')
          parseError = {
            status: 422,
            code: 'IMPORT_PARSE_FAILED',
            message: err instanceof Error ? err.message : 'Parser failed',
          }
        }
      }

      // Best-effort source cleanup regardless of parse outcome — the buffer
      // is in memory and the segments round-trip through the client. The
      // source byte-for-byte isn't needed past this point.
      try {
        await deleteObject(fileKey)
        await db.update(uploads)
          .set({ status: 'removed', updatedAt: new Date() })
          .where(eq(uploads.s3Key, fileKey))
      } catch (err) {
        fastify.log.warn({ err, fileKey }, 'Source cleanup after import parse failed (non-fatal)')
      }

      if (parseError) {
        emitFailure(parseError.code)
        return reply.status(parseError.status).send({
          error: parseError.message,
          code: parseError.code,
        })
      }

      // Defend against the response blowing past the body cap — the JSON
      // round-trips through the client, so massive payloads risk request
      // failures on commit anyway.
      const totalHtmlBytes = segments.reduce((sum, s) => sum + Buffer.byteLength(s.html), 0)
      if (totalHtmlBytes > PARSE_PAYLOAD_CAP_BYTES) {
        emitFailure('IMPORT_PAYLOAD_TOO_LARGE')
        return reply.status(413).send({
          error: `Parsed manuscript exceeds the ${PARSE_PAYLOAD_CAP_BYTES} byte preview cap`,
          code: 'IMPORT_PAYLOAD_TOO_LARGE',
        })
      }

      serverEventBus.fire(importParseCompleted(
        projectId,
        user.id,
        format,
        segments.length,
        Date.now() - startedAt,
      ))

      return { segments, warnings, sourceFormat: format }

    } catch (error) {
      fastify.log.error(error)
      if (error instanceof z.ZodError) {
        emitFailure('IMPORT_VALIDATION_FAILED')
        return reply.status(400).send({
          error: 'Validation failed',
          code: 'IMPORT_VALIDATION_FAILED',
          issues: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
        })
      }
      emitFailure('IMPORT_INTERNAL_ERROR')
      return reply.status(500).send({
        error: 'Import parse failed',
        code: 'IMPORT_INTERNAL_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // POST /import/commit — turn approved segments into manuscript chapters.
  fastify.post<{
    Body: {
      projectId: string
      containerId?: string | null
      segments: Array<{ title: string; html: string }>
    }
  }>('/import/commit', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const startedAt = Date.now()
    let resolvedProjectId: string | null = null
    let resolvedUserId: string | null = null
    let resolvedContainerId: string | null = null

    const emitCommitFailure = (code: string) => {
      if (resolvedProjectId && resolvedUserId) {
        serverEventBus.fire(importCommitFailed(
          resolvedProjectId,
          resolvedUserId,
          resolvedContainerId,
          code,
          Date.now() - startedAt,
        ))
      }
    }

    try {
      const body = CommitRequestSchema.parse(request.body)
      const { projectId, segments } = body
      const containerId = body.containerId ?? null
      const user = request.user!
      resolvedProjectId = projectId
      resolvedUserId = user.id
      resolvedContainerId = containerId

      // Commit writes manuscript chapters — gate on the manuscript scope.
      if (!assertEntityScope(request, reply, 'content', 'write')) return

      const hasAccess = await requireProjectOwnership(request, reply, projectId)
      if (!hasAccess) return

      // Verify the container exists when supplied. A null containerId means
      // "land the chapters at root with no container_id" — that's a legal
      // shape in the manuscript bobbin (the outline panel renders such
      // content as top-level items).
      if (containerId !== null) {
        const [container] = await db
          .select({ id: entities.id })
          .from(entities)
          .where(and(
            eq(entities.id, containerId),
            eq(entities.projectId, projectId),
            eq(entities.bobbinId, 'manuscript'),
            eq(entities.collectionName, 'containers'),
          ))
          .limit(1)

        if (!container) {
          emitCommitFailure('IMPORT_CONTAINER_NOT_FOUND')
          return reply.status(422).send({
            error: 'Target container not found in this project',
            code: 'IMPORT_CONTAINER_NOT_FOUND',
          })
        }
      }

      // Resolve the content collection to its bobbin once (manuscript).
      const effective = await getEffectiveBobbins(projectId, user.id)
      const match = await findBobbinForCollectionAcrossScopes(effective, 'content')
      if (!match) {
        emitCommitFailure('IMPORT_MANUSCRIPT_NOT_INSTALLED')
        return reply.status(400).send({
          error: 'Manuscript bobbin is not installed for this project',
          code: 'IMPORT_MANUSCRIPT_NOT_INSTALLED',
        })
      }

      // Append imported chapters after every existing chapter in the project.
      // Order is a single project-wide sequence (the reader sorts by it), so we
      // base the starting point on the project-wide max rather than container
      // siblings — a sibling-scoped max restarts low and collides with chapters
      // in other containers, dropping imports into the middle of the list.
      const startingOrder = await getMaxContentOrder(db, projectId)
      const orderStep = 100

      const created = await db.transaction(async (tx) => {
        const insertedIds: Array<{ id: string; title: string; order: number }> = []
        const changeEvents: EntityChangeEvent[] = []

        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i]!
          const order = startingOrder + (i + 1) * orderStep
          const now = new Date().toISOString()

          // Commit is reachable by any client with a content:write scope, so
          // sanitize here even though the built-in parsers already did — the
          // sanitizer is idempotent, and import-source bobbins post raw HTML.
          const cleanHtml = sanitizeImportedHtml(seg.html)

          const data: Record<string, any> = {
            title: seg.title,
            type: 'scene',
            body: cleanHtml,
            order,
            word_count: countWordsFromHtml(cleanHtml),
            status: 'draft',
            created_at: now,
            updated_at: now,
          }
          if (containerId !== null) {
            data.container_id = containerId
          }

          const insertValues: Record<string, any> = {
            id: crypto.randomUUID(),
            bobbinId: match.bobbinId,
            collectionName: 'content',
            entityData: data,
            scope: match.scope,
            contentType: resolveContentTypeColumn('content', data),
          }

          if (match.scope === 'project') {
            insertValues.projectId = projectId
          } else if (match.scope === 'collection') {
            insertValues.collectionId = match.scopeOwnerId
          } else {
            insertValues.userId = user.id
          }

          const result = await tx
            .insert(entities)
            .values(insertValues as any)
            .returning({ id: entities.id })

          const row = result[0]
          if (!row) throw new Error('Insert returned no row')
          insertedIds.push({ id: row.id, title: seg.title, order })

          changeEvents.push({
            projectId,
            entityId: row.id,
            collection: 'content',
            contentType: insertValues.contentType,
            title: seg.title,
            action: 'created',
            fieldsChanged: diffEntityData(null, data).fieldsChanged,
            wordCountAfter: extractWordCount(data),
            actor: user.id,
          })
        }

        await recordEntityChanges(tx, changeEvents)

        return insertedIds
      })

      serverEventBus.fire(importCommitCompleted(
        projectId,
        user.id,
        containerId,
        created.length,
        Date.now() - startedAt,
      ))

      return { entities: created }

    } catch (error) {
      fastify.log.error(error)
      if (error instanceof z.ZodError) {
        emitCommitFailure('IMPORT_VALIDATION_FAILED')
        return reply.status(400).send({
          error: 'Validation failed',
          code: 'IMPORT_VALIDATION_FAILED',
          issues: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
        })
      }
      emitCommitFailure('IMPORT_INTERNAL_ERROR')
      return reply.status(500).send({
        error: 'Import commit failed (batch rolled back)',
        code: 'IMPORT_INTERNAL_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })
}

export default importPlugin
