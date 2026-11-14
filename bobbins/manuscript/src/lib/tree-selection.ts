/**
 * Pure helpers behind the navigation panel's multi-select and bulk moves.
 * Generic over the tree shape so they can be tested without the panel.
 */

export interface TreeLike<T> {
  id: string
  children?: T[]
}

/** Row ids in display order, skipping the children of collapsed nodes. */
export function visibleIds<T extends TreeLike<T>>(nodes: T[], expanded: Set<string>): string[] {
  const ids: string[] = []
  const walk = (level: T[]) => {
    for (const node of level) {
      ids.push(node.id)
      if (node.children && expanded.has(node.id)) walk(node.children)
    }
  }
  walk(nodes)
  return ids
}

/**
 * The ids from `anchorId` to `targetId` inclusive, in display order, whichever
 * comes first. Null when either end isn't among `ids`.
 */
export function rangeBetween(ids: string[], anchorId: string | null, targetId: string): string[] | null {
  const from = anchorId ? ids.indexOf(anchorId) : -1
  const to = ids.indexOf(targetId)
  if (from === -1 || to === -1) return null
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1)
}

/**
 * Selected nodes in tree order, leaving out any whose ancestor is also
 * selected -- those travel with their container.
 */
export function topLevelSelection<T extends TreeLike<T>>(nodes: T[], selected: Set<string>): T[] {
  const picked: T[] = []
  const walk = (level: T[]) => {
    for (const node of level) {
      if (selected.has(node.id)) {
        picked.push(node)
        continue
      }
      if (node.children) walk(node.children)
    }
  }
  walk(nodes)
  return picked
}

/**
 * Sibling order after lifting `movedIds` out and reinserting them, as one
 * block in their given order, before or after `targetId`.
 */
export function reorderWithBlock(
  siblingIds: string[],
  movedIds: string[],
  targetId: string,
  position: 'before' | 'after'
): string[] {
  const moved = new Set(movedIds)
  const remaining = siblingIds.filter(id => !moved.has(id))
  const targetIndex = remaining.indexOf(targetId)
  if (targetIndex === -1) return [...remaining, ...movedIds]
  const insertAt = position === 'before' ? targetIndex : targetIndex + 1
  remaining.splice(insertAt, 0, ...movedIds)
  return remaining
}

/**
 * Expanded set after a tree (re)load. Nodes seen on an earlier load keep
 * whatever state the author left them in; nodes new to this load (including
 * the whole tree on first load) start expanded. Ids no longer in the tree are
 * dropped.
 */
export function reconcileExpanded(
  currentIds: Iterable<string>,
  previouslyKnown: Set<string>,
  expanded: Set<string>
): Set<string> {
  const next = new Set<string>()
  for (const id of currentIds) {
    if (!previouslyKnown.has(id) || expanded.has(id)) next.add(id)
  }
  return next
}
