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
  const walk = (parentKey: string, path: string[]) => {
    const siblings = [...(childrenOf.get(parentKey) ?? [])]
      .sort((a, b) => sortKey(a.node.order) - sortKey(b.node.order))
    for (const item of siblings) {
      if (item.kind === 'content') {
        result.set(item.node.id, {
          position: result.size,
          folderPath: path.length > 0 ? path.join(FOLDER_SEPARATOR) : null,
        })
      } else {
        walk(item.node.id, [...path, item.node.title || 'Untitled'])
      }
    }
  }
  walk('', [])

  // Content whose folder no longer exists is missing from the tree but may
  // still be published, so it goes after everything else, by its own `order`.
  const unreached = content
    .filter(c => !result.has(c.id))
    .sort((a, b) => sortKey(a.order) - sortKey(b.order))
  for (const c of unreached) result.set(c.id, { position: result.size, folderPath: null })

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
