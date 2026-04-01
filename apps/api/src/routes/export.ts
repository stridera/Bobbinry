import type { FastifyPluginAsync } from 'fastify'
import { requireAuth, requireProjectOwnership } from '../middleware/auth'
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

async function getProjectName(projectId: string): Promise<string> {
  const [project] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return project?.name || 'Untitled Project'
}

async function getManuscriptData(projectId: string): Promise<Chapter[]> {
  // Each content item is a chapter — matches what the dashboard UI shows.
  // Containers are structural wrappers, not user-visible chapters.
  const content = await db
    .select({
      id: entities.id,
      title: sql<string>`COALESCE(${entities.entityData}->>'title', 'Untitled')`,
      body: sql<string>`COALESCE(${entities.entityData}->>'body', '')`,
      containerId: sql<string>`(${entities.entityData}->>'container_id')`,
      order: sql<number>`COALESCE((${entities.entityData}->>'order')::bigint, 0)`,
      status: sql<string>`COALESCE(${entities.entityData}->>'status', 'draft')`,
    })
    .from(entities)
    .where(
      and(
        eq(entities.projectId, projectId),
        eq(entities.collectionName, 'content')
      )
    )
    .orderBy(sql`COALESCE((${entities.entityData}->>'order')::bigint, 0) ASC`)

  return content.map((item) => ({
    container: {
      id: item.id,
      title: item.title || 'Untitled',
      type: 'chapter',
      order: item.order,
      parentId: null,
    },
    scenes: [item],
  }))
}

const exportPlugin: FastifyPluginAsync = async (fastify) => {
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
      const [projectName, chapters] = await Promise.all([
        getProjectName(projectId),
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
