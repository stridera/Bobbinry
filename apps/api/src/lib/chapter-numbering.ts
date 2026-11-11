/**
 * Automatic chapter numbering, resolved for a project.
 *
 * The mode lives in the manuscript display cascade (author's user default,
 * overridden by the project). Numbers are never stored: callers pass the
 * chapters they are about to show and get back a titler that renders
 * "Chapter N: Title" from manuscript order. See `numberChapters` for which
 * chapters to pass.
 */

import { and, eq } from 'drizzle-orm'
import { db } from '../db/connection'
import { chapterPublications, entities, projects, projectManuscriptDisplaySettings, userManuscriptDisplaySettings } from '../db/schema'
import { notDeleted } from './entity-scope'
import {
  resolveDisplaySettings,
  sanitizeDisplaySettings,
  type ChapterNumbering,
  type PartialManuscriptDisplaySettings,
} from '@bobbinry/types'
import {
  displayChapterTitle,
  getManuscriptOrder,
  numberChapters,
  type ManuscriptOrder,
} from './manuscript-order'

/** The project's effective chapter numbering mode (`off` when nothing is configured). */
export async function getChapterNumberingMode(projectId: string): Promise<ChapterNumbering> {
  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  let userDisplay: PartialManuscriptDisplaySettings | null = null
  if (project?.ownerId) {
    const [row] = await db
      .select()
      .from(userManuscriptDisplaySettings)
      .where(eq(userManuscriptDisplaySettings.userId, project.ownerId))
      .limit(1)
    if (row) userDisplay = sanitizeDisplaySettings(row)
  }
  const [projectRow] = await db
    .select()
    .from(projectManuscriptDisplaySettings)
    .where(eq(projectManuscriptDisplaySettings.projectId, projectId))
    .limit(1)
  const projectDisplay = projectRow ? sanitizeDisplaySettings(projectRow) : null

  return resolveDisplaySettings(userDisplay, projectDisplay).chapterNumbering
}

export interface ChapterTitler {
  mode: ChapterNumbering
  /** Number shown for a chapter, or undefined when numbering is off or the id was not counted. */
  numberOf(id: string): number | undefined
  /** Display title for a chapter: numbered when numbering is on, otherwise `title` unchanged. */
  titleOf(id: string, title: string | null | undefined): string
}

/**
 * Titler for the given chapters. Pass the chapters the audience can see (reader)
 * or every chapter (editor/export) — the numbers are positions among `ids`.
 * `order` and `mode` may be supplied by callers that already have them.
 */
export async function buildChapterTitler(
  projectId: string,
  ids: readonly string[],
  opts: { order?: ManuscriptOrder; mode?: ChapterNumbering } = {},
): Promise<ChapterTitler> {
  const mode = opts.mode ?? await getChapterNumberingMode(projectId)
  if (mode === 'off' || ids.length === 0) {
    return { mode, numberOf: () => undefined, titleOf: (_id, title) => title ?? '' }
  }
  const order = opts.order ?? await getManuscriptOrder(projectId)
  const numbers = numberChapters(order, ids, mode)
  return {
    mode,
    numberOf: id => numbers.get(id),
    titleOf: (id, title) => displayChapterTitle(numbers, id, title),
  }
}

/**
 * Titler numbered among the project's published chapters — the set the public
 * TOC counts. For surfaces that only ever show published chapters (SEO
 * metadata, RSS), where the rows they render may be a filtered or limited
 * subset and so cannot be numbered on their own.
 */
export async function buildPublishedChapterTitler(projectId: string): Promise<ChapterTitler> {
  const mode = await getChapterNumberingMode(projectId)
  if (mode === 'off') return buildChapterTitler(projectId, [], { mode })
  const rows = await db
    .select({ id: entities.id })
    .from(entities)
    .innerJoin(chapterPublications, eq(chapterPublications.chapterId, entities.id))
    .where(and(
      eq(entities.projectId, projectId),
      eq(chapterPublications.isPublished, true),
      notDeleted(),
    ))
  return buildChapterTitler(projectId, rows.map(r => r.id), { mode })
}

/**
 * `buildPublishedChapterTitler` memoized per project, for responses that span
 * several projects (activity feed, reading progress).
 */
export function publishedTitlerCache(): (projectId: string) => Promise<ChapterTitler> {
  const cache = new Map<string, Promise<ChapterTitler>>()
  return (projectId) => {
    let titler = cache.get(projectId)
    if (!titler) {
      titler = buildPublishedChapterTitler(projectId)
      cache.set(projectId, titler)
    }
    return titler
  }
}
