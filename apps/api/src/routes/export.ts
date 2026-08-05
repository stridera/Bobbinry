import type { FastifyPluginAsync } from 'fastify'
import type { ExportSnapshot, ExportFormat, ExportMode } from '@bobbinry/types'
import { EXPORT_FORMATS, EXPORT_MODES } from '@bobbinry/types'
import { requireAuth, requireProjectOwnership, assertEntityScope } from '../middleware/auth'
import { db } from '../db/connection'
import { entities, projects } from '../db/schema'
import { eq, and, sql } from 'drizzle-orm'
import {
  type Chapter,
  chapterToPlainText,
  chapterToMarkdown,
  generatePdf,
  generateEpub,
  generateDocx,
  generateChaptersZip,
  generateOutline,
  createTurndown,
} from '../lib/export-converters'

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Per-format download metadata, keyed by the shared ExportFormat union. */
const FORMAT_META: Record<ExportFormat, { ext: string; contentType: string }> = {
  pdf: { ext: 'pdf', contentType: 'application/pdf' },
  epub: { ext: 'epub', contentType: 'application/epub+zip' },
  docx: { ext: 'docx', contentType: DOCX_MIME },
  markdown: { ext: 'md', contentType: 'text/markdown; charset=utf-8' },
  txt: { ext: 'txt', contentType: 'text/plain; charset=utf-8' },
}

// Simple concurrency guard — one export per project at a time
const activeExports = new Set<string>()

async function getProjectMeta(projectId: string): Promise<{ name: string; description: string | null }> {
  const [project] = await db
    .select({ name: projects.name, description: projects.description })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return {
    name: project?.name || 'Untitled Project',
    description: project?.description ?? null,
  }
}

/**
 * Normalized manuscript read model — the export "waist". Export and
 * publisher bobbins consume this via GET /projects/:projectId/export/snapshot
 * instead of querying the manuscript collections directly; the binary
 * download formats below derive their Chapter[] from it too.
 */
async function getSnapshot(projectId: string): Promise<ExportSnapshot> {
  const [meta, containers, content] = await Promise.all([
    getProjectMeta(projectId),
    db
      .select({
        id: entities.id,
        title: sql<string>`COALESCE(${entities.entityData}->>'title', 'Untitled')`,
        type: sql<string>`COALESCE(${entities.entityData}->>'type', 'chapter')`,
        order: sql<number>`COALESCE((${entities.entityData}->>'order')::bigint, 0)`,
        // Legacy entity rows may use either key shape — same pattern as the
        // sibling lookups in import.ts.
        parentId: sql<string | null>`COALESCE(${entities.entityData}->>'parent_id', ${entities.entityData}->>'parentId')`,
      })
      .from(entities)
      .where(
        and(
          eq(entities.projectId, projectId),
          eq(entities.bobbinId, 'manuscript'),
          eq(entities.collectionName, 'containers')
        )
      )
      .orderBy(sql`COALESCE((${entities.entityData}->>'order')::bigint, 0) ASC`),
    db
      .select({
        id: entities.id,
        title: sql<string>`COALESCE(${entities.entityData}->>'title', 'Untitled')`,
        html: sql<string>`COALESCE(${entities.entityData}->>'body', '')`,
        containerId: sql<string | null>`COALESCE(${entities.entityData}->>'container_id', ${entities.entityData}->>'containerId')`,
        order: sql<number>`COALESCE((${entities.entityData}->>'order')::bigint, 0)`,
        status: sql<string>`COALESCE(${entities.entityData}->>'status', 'draft')`,
        wordCount: sql<number>`COALESCE((${entities.entityData}->>'word_count')::int, 0)`,
      })
      .from(entities)
      .where(
        and(
          eq(entities.projectId, projectId),
          eq(entities.collectionName, 'content')
        )
      )
      .orderBy(sql`COALESCE((${entities.entityData}->>'order')::bigint, 0) ASC`),
  ])

  return {
    project: { id: projectId, name: meta.name, description: meta.description },
    generatedAt: new Date().toISOString(),
    // pg returns ::bigint casts as strings — coerce so the JSON matches the
    // ExportSnapshot contract (order: number).
    containers: containers.map((c) => ({ ...c, order: Number(c.order) })),
    content: content.map((item) => ({ ...item, order: Number(item.order) })),
  }
}

async function getManuscriptData(projectId: string): Promise<Chapter[]> {
  // Each content item is a chapter — matches what the dashboard UI shows.
  // Containers are structural wrappers, not user-visible chapters.
  const snapshot = await getSnapshot(projectId)

  return snapshot.content.map((item) => ({
    container: {
      id: item.id,
      title: item.title || 'Untitled',
      type: 'chapter',
      order: item.order,
      parentId: null,
    },
    scenes: [{
      id: item.id,
      title: item.title,
      body: item.html,
      containerId: item.containerId ?? '',
      order: item.order,
      status: item.status,
    }],
  }))
}

const exportPlugin: FastifyPluginAsync = async (fastify) => {
  // Normalized JSON read model for export/publisher bobbins. Returns the
  // snapshot even when the manuscript is empty — consumers decide what an
  // empty manuscript means. (Fastify prefers this static segment over the
  // :format param on the route below.)
  fastify.get<{
    Params: { projectId: string }
  }>('/projects/:projectId/export/snapshot', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { projectId } = request.params
    const hasAccess = await requireProjectOwnership(request, reply, projectId)
    if (!hasAccess) return

    // Snapshot exposes manuscript content — gate on the manuscript read scope.
    if (!assertEntityScope(request, reply, 'content', 'read')) return

    return getSnapshot(projectId)
  })

  fastify.get<{
    Params: { projectId: string; format: string }
    Querystring: { mode?: string }
  }>('/projects/:projectId/export/:format', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const { projectId, format } = request.params
    const hasAccess = await requireProjectOwnership(request, reply, projectId)
    if (!hasAccess) return

    if (!EXPORT_FORMATS.includes(format as ExportFormat)) {
      return reply.status(400).send({
        error: `Invalid format "${format}". Supported: ${EXPORT_FORMATS.join(', ')}`,
      })
    }
    const exportFormat = format as ExportFormat

    const mode = (request.query.mode || 'full') as ExportMode
    if (!EXPORT_MODES.includes(mode)) {
      return reply.status(400).send({
        error: `Invalid mode. Supported: ${EXPORT_MODES.join(', ')}`,
      })
    }

    if (activeExports.has(projectId)) {
      return reply.status(429).send({
        error: 'An export is already in progress for this project. Please wait.',
      })
    }

    activeExports.add(projectId)
    try {
      const [{ name: projectName }, chapters] = await Promise.all([
        getProjectMeta(projectId),
        getManuscriptData(projectId),
      ])

      if (chapters.length === 0) {
        return reply.status(404).send({
          error: 'No manuscript content found. Add chapters before exporting.',
        })
      }

      const safeName = projectName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'export'
      const turndown = createTurndown()
      const { ext, contentType } = FORMAT_META[exportFormat]

      // --- OUTLINE MODE: chapter numbers and titles only ---
      // Checked before `chapters` because outline is a mode-level choice that
      // applies across every format.
      if (mode === 'outline') {
        const outline = await generateOutline(projectName, chapters, exportFormat)
        reply.header('Content-Type', contentType)
        reply.header('Content-Disposition', `attachment; filename="${safeName}-outline.${ext}"`)
        return reply.send(outline)
      }

      // --- CHAPTERS MODE: ZIP of individual files ---
      if (mode === 'chapters') {
        const zipBuffer = await generateChaptersZip(chapters, exportFormat, turndown)
        reply.header('Content-Type', 'application/zip')
        reply.header('Content-Disposition', `attachment; filename="${safeName}-chapters.zip"`)
        return reply.send(zipBuffer)
      }

      // --- FULL MODE: single file ---
      reply.header('Content-Type', contentType)
      reply.header('Content-Disposition', `attachment; filename="${safeName}.${ext}"`)

      switch (exportFormat) {
        case 'pdf':
          return reply.send(await generatePdf(projectName, chapters))
        case 'epub':
          return reply.send(await generateEpub(projectName, chapters))
        case 'docx':
          return reply.send(await generateDocx(projectName, chapters))
        case 'txt':
          return reply.send(
            chapters.map((ch) => chapterToPlainText(ch)).join('\n\n---\n\n')
          )
        case 'markdown':
          return reply.send(
            chapters.map((ch) => chapterToMarkdown(ch, turndown)).join('\n\n---\n\n')
          )
      }
    } finally {
      activeExports.delete(projectId)
    }
  })
}

export default exportPlugin
