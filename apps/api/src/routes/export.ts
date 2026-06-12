import type { FastifyPluginAsync } from 'fastify'
import type { ExportSnapshot } from '@bobbinry/types'
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
  generateChaptersZip,
  createTurndown,
} from '../lib/export-converters'

const VALID_FORMATS = ['pdf', 'epub', 'txt', 'markdown'] as const
type ExportFormat = (typeof VALID_FORMATS)[number]

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

    if (!VALID_FORMATS.includes(format as ExportFormat)) {
      return reply.status(400).send({
        error: `Invalid format "${format}". Supported: ${VALID_FORMATS.join(', ')}`,
      })
    }
    const exportFormat = format as ExportFormat

    const mode = (request.query.mode || 'full') as 'full' | 'chapters'
    if (mode !== 'full' && mode !== 'chapters') {
      return reply.status(400).send({
        error: 'Invalid mode. Supported: full, chapters',
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

      // --- CHAPTERS MODE: ZIP of individual files ---
      if (mode === 'chapters') {
        const zipBuffer = await generateChaptersZip(chapters, exportFormat, turndown)
        reply.header('Content-Type', 'application/zip')
        reply.header('Content-Disposition', `attachment; filename="${safeName}-chapters.zip"`)
        return reply.send(zipBuffer)
      }

      // --- FULL MODE: single file ---
      switch (exportFormat) {
        case 'pdf': {
          const pdf = await generatePdf(projectName, chapters)
          reply.header('Content-Type', 'application/pdf')
          reply.header('Content-Disposition', `attachment; filename="${safeName}.pdf"`)
          return reply.send(pdf)
        }
        case 'epub': {
          const epub = await generateEpub(projectName, chapters)
          reply.header('Content-Type', 'application/epub+zip')
          reply.header('Content-Disposition', `attachment; filename="${safeName}.epub"`)
          return reply.send(epub)
        }
        case 'txt': {
          const parts = chapters.map((ch) => chapterToPlainText(ch))
          const fullText = parts.join('\n\n---\n\n')
          reply.header('Content-Type', 'text/plain; charset=utf-8')
          reply.header('Content-Disposition', `attachment; filename="${safeName}.txt"`)
          return reply.send(fullText)
        }
        case 'markdown': {
          const parts = chapters.map((ch) => chapterToMarkdown(ch, turndown))
          const fullMd = parts.join('\n\n---\n\n')
          reply.header('Content-Type', 'text/markdown; charset=utf-8')
          reply.header('Content-Disposition', `attachment; filename="${safeName}.md"`)
          return reply.send(fullMd)
        }
      }
    } finally {
      activeExports.delete(projectId)
    }
  })
}

export default exportPlugin
