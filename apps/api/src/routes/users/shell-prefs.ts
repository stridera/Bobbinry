/**
 * Shell layout preferences that follow the signed-in user: panel widths and
 * collapsed state, the active rail panels, the view chosen per entity type
 * and the last-visited target per project. Stored as one JSONB blob of
 * namespaces so the shell can add a key without a migration.
 *
 * PATCH merges one level deep — a tab that only knows about one project's
 * last-nav must not erase another tab's — and `null` deletes a key.
 */
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { db } from '../../db/connection'
import { userShellPreferences } from '../../db/schema'
import { requireAuth } from '../../middleware/auth'

/** Top-level keys the shell may store. Anything else is a 400. */
export const SHELL_PREF_NAMESPACES = [
  'panelWidth',
  'panelCollapsed',
  'leftRail',
  'rightRail',
  'viewPreferences',
  'lastNav',
] as const

/** Whole-blob ceiling so a runaway client cannot grow a row without bound. */
export const SHELL_PREFS_MAX_BYTES = 32 * 1024

type Namespace = (typeof SHELL_PREF_NAMESPACES)[number]
type Prefs = Partial<Record<Namespace, Record<string, unknown>>>

const patchSchema = z.object({
  prefs: z.object(
    Object.fromEntries(SHELL_PREF_NAMESPACES.map(ns => [ns, z.record(z.string(), z.unknown()).optional()])) as Record<Namespace, z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>,
  ).strict(),
}).strict()

/** One-level merge: namespace keys are replaced individually; `null` removes one. */
export function mergeShellPrefs(current: Prefs, patch: Prefs): Prefs {
  const next: Prefs = { ...current }
  for (const ns of SHELL_PREF_NAMESPACES) {
    const incoming = patch[ns]
    if (!incoming) continue
    const merged: Record<string, unknown> = { ...(current[ns] ?? {}) }
    for (const [key, value] of Object.entries(incoming)) {
      if (value === null) delete merged[key]
      else merged[key] = value
    }
    next[ns] = merged
  }
  return next
}

const shellPrefsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/users/me/shell-preferences', { preHandler: requireAuth }, async (request) => {
    const [row] = await db
      .select({ prefs: userShellPreferences.prefs, updatedAt: userShellPreferences.updatedAt })
      .from(userShellPreferences)
      .where(eq(userShellPreferences.userId, request.user!.id))
      .limit(1)
    return { prefs: row?.prefs ?? {}, updatedAt: row?.updatedAt ?? null }
  })

  fastify.patch('/users/me/shell-preferences', { preHandler: requireAuth }, async (request, reply) => {
    const { prefs: patch } = patchSchema.parse(request.body)
    const userId = request.user!.id

    const merged = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ prefs: userShellPreferences.prefs })
        .from(userShellPreferences)
        .where(eq(userShellPreferences.userId, userId))
        .for('update')
        .limit(1)
      const next = mergeShellPrefs((row?.prefs ?? {}) as Prefs, patch as Prefs)
      if (JSON.stringify(next).length > SHELL_PREFS_MAX_BYTES) {
        return null
      }
      await tx
        .insert(userShellPreferences)
        .values({ userId, prefs: next as Record<string, Record<string, unknown>>, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: userShellPreferences.userId,
          set: { prefs: next as Record<string, Record<string, unknown>>, updatedAt: sql`now()` },
        })
      return next
    })

    if (merged === null) {
      return reply.status(413).send({ error: `Shell preferences exceed ${SHELL_PREFS_MAX_BYTES} bytes`, correlationId: request.id })
    }
    return { prefs: merged }
  })
}

export default shellPrefsRoutes
