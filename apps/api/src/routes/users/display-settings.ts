/** Manuscript display settings (user defaults). Registered by ./index.ts under the /api prefix. */
import type { FastifyPluginAsync } from 'fastify'
import { db } from '../../db/connection'
import { userManuscriptDisplaySettings } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../middleware/auth'
import { isChapterNumbering, type ChapterNumbering } from '@bobbinry/types'

const displaySettingsRoutes: FastifyPluginAsync = async (fastify) => {
  // ============================================================================
  // MANUSCRIPT DISPLAY SETTINGS ROUTES (user defaults — cascade base)
  // ============================================================================

  fastify.get('/users/me/manuscript-display-settings', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const userId = request.user!.id

      const rows = await db
        .select()
        .from(userManuscriptDisplaySettings)
        .where(eq(userManuscriptDisplaySettings.userId, userId))
        .limit(1)

      if (rows.length === 0) {
        return reply.status(200).send({
          settings: {
            userId,
            paragraphSpacing: 'standard',
            paragraphIndent: 'none',
            codeBlockWrap: false,
            sceneBreakStyle: 'asterism',
            dropCaps: false,
            smartDashes: false,
            smartEllipsis: false,
            chapterNumbering: 'off',
            showFormattingMarks: false
          }
        })
      }
      return reply.status(200).send({ settings: rows[0] })
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to fetch manuscript display settings' })
    }
  })

  fastify.put<{
    Body: {
      paragraphSpacing?: 'standard' | 'manuscript'
      paragraphIndent?: 'none' | 'first-line' | 'every'
      codeBlockWrap?: boolean
      sceneBreakStyle?: 'asterism' | 'rule' | 'blank-line'
      dropCaps?: boolean
      smartDashes?: boolean
      smartEllipsis?: boolean
      chapterNumbering?: ChapterNumbering
      showFormattingMarks?: boolean
    }
  }>('/users/me/manuscript-display-settings', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const userId = request.user!.id
      const body = request.body ?? {}

      if (body.chapterNumbering !== undefined && !isChapterNumbering(body.chapterNumbering)) {
        return reply.status(400).send({ error: 'chapterNumbering must be one of: off, continuous, per-book' })
      }

      // Allow-list updatable fields — prevents the body from including a
      // `userId` key that would rewrite this row's PK.
      const safe: Partial<typeof userManuscriptDisplaySettings.$inferInsert> = {}
      if (body.paragraphSpacing !== undefined) safe.paragraphSpacing = body.paragraphSpacing
      if (body.paragraphIndent !== undefined) safe.paragraphIndent = body.paragraphIndent
      if (body.codeBlockWrap !== undefined) safe.codeBlockWrap = body.codeBlockWrap
      if (body.sceneBreakStyle !== undefined) safe.sceneBreakStyle = body.sceneBreakStyle
      if (body.dropCaps !== undefined) safe.dropCaps = body.dropCaps
      if (body.smartDashes !== undefined) safe.smartDashes = body.smartDashes
      if (body.smartEllipsis !== undefined) safe.smartEllipsis = body.smartEllipsis
      if (body.chapterNumbering !== undefined) safe.chapterNumbering = body.chapterNumbering
      if (body.showFormattingMarks !== undefined) safe.showFormattingMarks = body.showFormattingMarks

      const existing = await db
        .select()
        .from(userManuscriptDisplaySettings)
        .where(eq(userManuscriptDisplaySettings.userId, userId))
        .limit(1)

      if (existing.length > 0) {
        const [updated] = await db
          .update(userManuscriptDisplaySettings)
          .set({ ...safe, updatedAt: new Date() })
          .where(eq(userManuscriptDisplaySettings.userId, userId))
          .returning()
        return reply.status(200).send({ settings: updated })
      } else {
        const [created] = await db
          .insert(userManuscriptDisplaySettings)
          .values({ userId, ...safe })
          .returning()
        return reply.status(201).send({ settings: created })
      }
    } catch (error) {
      fastify.log.error(error)
      return reply.status(500).send({ error: 'Failed to update manuscript display settings' })
    }
  })
}

export default displaySettingsRoutes
