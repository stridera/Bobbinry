/**
 * Manuscript reading order: the writing tab's navigation tree, flattened.
 *
 * A content row's `order` only ranks it among its folder's siblings — the tree
 * renumbers each folder from 100 on every drag, and moving items into a folder
 * stamps them with Date.now(). Sorting content by raw `order` therefore
 * interleaves folders (Part 1's first chapter next to Part 2's first chapter).
 * Anything that needs chapters in book order — reader TOC and navigation,
 * release scheduling, export — sorts by `position` from here instead.
 *
 * The walk mirrors how bobbins/manuscript/src/panels/navigation.tsx builds the
 * tree: depth-first, each level's folders and content sorted together by
 * `order`, folders first on ties.
 */

import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/connection'
import { entities } from '../db/schema'
import { notDeleted } from './entity-scope'
import {
  computeChapterNumbers,
  formatChapterTitle,
  type ChapterNumbering,
} from '@bobbinry/types'

export interface ManuscriptOrderContainer {
  id: string
  parentId: string | null
  order: unknown
  title?: string | null
}

export interface ManuscriptOrderContent {
  id: string
  containerId: string | null
  order: unknown
}

export interface ManuscriptPlacement {
  /** 0-based index in manuscript order across the whole project. */
  position: number
  /** Enclosing folder titles, outermost first; null at the manuscript root. */
  folderPath: string | null
  /** Id of the outermost enclosing folder (the "book"); null at the manuscript root. */
  bookId: string | null
}

export type ManuscriptOrder = Map<string, ManuscriptPlacement>

const FOLDER_SEPARATOR = ' › '

/** Same coercion as the tree's `order || 0`: missing or junk values rank as 0. */
function sortKey(order: unknown): number {
  const n = Number(order)
  return Number.isFinite(n) ? n : 0
}

type TreeItem =
  | { kind: 'container'; node: ManuscriptOrderContainer }
  | { kind: 'content'; node: ManuscriptOrderContent }

export function computeManuscriptOrder(
  containers: ManuscriptOrderContainer[],
  content: ManuscriptOrderContent[],
): ManuscriptOrder {
  // Keyed by parent id, '' for the root. Folders are added before content so
  // the stable sort below breaks `order` ties the way the tree does.
  const childrenOf = new Map<string, TreeItem[]>()
  const add = (parentId: string | null, item: TreeItem) => {
    const key = parentId || ''
    const siblings = childrenOf.get(key)
    if (siblings) siblings.push(item)
    else childrenOf.set(key, [item])
  }
  for (const node of containers) add(node.parentId, { kind: 'container', node })
  for (const node of content) add(node.containerId, { kind: 'content', node })

  const result: ManuscriptOrder = new Map()
  const walk = (parentKey: string, path: string[], bookId: string | null) => {
    const siblings = [...(childrenOf.get(parentKey) ?? [])]
      .sort((a, b) => sortKey(a.node.order) - sortKey(b.node.order))
    for (const item of siblings) {
      if (item.kind === 'content') {
        result.set(item.node.id, {
          position: result.size,
          folderPath: path.length > 0 ? path.join(FOLDER_SEPARATOR) : null,
          bookId,
        })
      } else {
        walk(item.node.id, [...path, item.node.title || 'Untitled'], bookId ?? item.node.id)
      }
    }
  }
  walk('', [], null)

  // Content whose folder no longer exists is missing from the tree but may
  // still be published, so it goes after everything else, by its own `order`.
  const unreached = content
    .filter(c => !result.has(c.id))
    .sort((a, b) => sortKey(a.order) - sortKey(b.order))
  for (const c of unreached) result.set(c.id, { position: result.size, folderPath: null, bookId: null })

  return result
}

/** Manuscript order for every live content row in a project, archived included. */
export async function getManuscriptOrder(projectId: string): Promise<ManuscriptOrder> {
  const [containers, content] = await Promise.all([
    db
      .select({
        id: entities.id,
        title: sql<string | null>`${entities.entityData}->>'title'`,
        // Legacy rows may use either key shape — same as export.ts.
        parentId: sql<string | null>`COALESCE(${entities.entityData}->>'parent_id', ${entities.entityData}->>'parentId')`,
        order: sql<string | null>`${entities.entityData}->>'order'`,
      })
      .from(entities)
      .where(and(
        eq(entities.projectId, projectId),
        eq(entities.bobbinId, 'manuscript'),
        eq(entities.collectionName, 'containers'),
        notDeleted(),
      )),
    db
      .select({
        id: entities.id,
        containerId: sql<string | null>`COALESCE(${entities.entityData}->>'container_id', ${entities.entityData}->>'containerId')`,
        order: sql<string | null>`${entities.entityData}->>'order'`,
      })
      .from(entities)
      .where(and(
        eq(entities.projectId, projectId),
        eq(entities.collectionName, 'content'),
        notDeleted(),
      )),
  ])
  return computeManuscriptOrder(containers, content)
}

/** `id`'s place in manuscript order; ids outside the manuscript sort last. */
export function manuscriptPosition(order: ManuscriptOrder, id: string): number {
  return order.get(id)?.position ?? Number.MAX_SAFE_INTEGER
}

/**
 * Automatic chapter numbers for `ids` under `mode`, keyed by id (empty for
 * `off`). The numbering is derived at read time from the order, so moving or
 * inserting a chapter renumbers everything with no writes.
 *
 * Which chapters are counted is the caller's choice, and it is deliberate:
 *  - Reader surfaces (TOC, chapter page, SEO, RSS) pass only the chapters that
 *    reader can see, so a reader never meets "Chapter 1, Chapter 3" with a gap
 *    where an unpublished or draft chapter sits. Numbers can therefore shift
 *    for readers as the author publishes earlier chapters.
 *  - Editor and export contexts pass every chapter in the manuscript.
 * Ids outside the manuscript tree sort last, as in `manuscriptPosition`.
 */
export function numberChapters(
  order: ManuscriptOrder,
  ids: readonly string[],
  mode: ChapterNumbering,
): Map<string, number> {
  if (mode === 'off') return new Map()
  const ordered = [...ids]
    .sort((a, b) => manuscriptPosition(order, a) - manuscriptPosition(order, b))
    .map(id => ({ id, bookId: order.get(id)?.bookId ?? null }))
  return computeChapterNumbers(ordered, mode)
}

/** `title` as shown to people: "Chapter N: Title" when `id` has a number, otherwise untouched. */
export function displayChapterTitle(
  numbers: ReadonlyMap<string, number>,
  id: string,
  title: string | null | undefined,
): string {
  const n = numbers.get(id)
  return n === undefined ? (title ?? '') : formatChapterTitle(title, n)
}
