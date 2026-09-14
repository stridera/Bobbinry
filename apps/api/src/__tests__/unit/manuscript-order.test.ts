import { describe, it, expect } from '@jest/globals'
import { computeManuscriptOrder, type ManuscriptOrder } from '../../lib/manuscript-order'

/** Content ids in manuscript order. */
function sequence(order: ManuscriptOrder): string[] {
  return [...order.entries()]
    .sort((a, b) => a[1].position - b[1].position)
    .map(([id]) => id)
}

describe('computeManuscriptOrder', () => {
  it('walks folders depth-first instead of interleaving their per-folder orders', () => {
    // Each part renumbers its chapters from 100, and Part 2 was stamped with
    // Date.now() when it was created by a move — a flat sort on `order`
    // interleaves the two parts.
    const order = computeManuscriptOrder(
      [
        { id: 'part1', parentId: null, order: 100, title: 'Part 1' },
        { id: 'part2', parentId: null, order: '1789291563875', title: 'Part 2' },
      ],
      [
        { id: 'ch14', containerId: 'part2', order: 100 },
        { id: 'ch1', containerId: 'part1', order: 100 },
        { id: 'ch15', containerId: 'part2', order: 200 },
        { id: 'ch2', containerId: 'part1', order: 200 },
      ],
    )
    expect(sequence(order)).toEqual(['ch1', 'ch2', 'ch14', 'ch15'])
    expect(order.get('ch14')).toEqual({ position: 2, folderPath: 'Part 2' })
  })

  it('interleaves root content with root folders by order', () => {
    const order = computeManuscriptOrder(
      [{ id: 'body', parentId: null, order: 100, title: 'Body' }],
      [
        { id: 'epilogue', containerId: null, order: 200 },
        { id: 'ch1', containerId: 'body', order: 100 },
        { id: 'prologue', containerId: null, order: 50 },
      ],
    )
    expect(sequence(order)).toEqual(['prologue', 'ch1', 'epilogue'])
    expect(order.get('prologue')?.folderPath).toBeNull()
  })

  it('orders subfolders among their sibling content and nests folder paths', () => {
    const order = computeManuscriptOrder(
      [
        { id: 'book', parentId: null, order: 100, title: 'Book One' },
        { id: 'act2', parentId: 'book', order: 300, title: 'Act II' },
        { id: 'act1', parentId: 'book', order: 200, title: 'Act I' },
      ],
      [
        { id: 'a2', containerId: 'act2', order: 100 },
        { id: 'a1', containerId: 'act1', order: 100 },
        { id: 'intro', containerId: 'book', order: 100 },
      ],
    )
    expect(sequence(order)).toEqual(['intro', 'a1', 'a2'])
    expect(order.get('a1')?.folderPath).toBe('Book One › Act I')
  })

  it('puts folders before content when their orders tie', () => {
    const order = computeManuscriptOrder(
      [{ id: 'folder', parentId: null, order: 100, title: 'Folder' }],
      [
        { id: 'loose', containerId: null, order: 100 },
        { id: 'inside', containerId: 'folder', order: 100 },
      ],
    )
    expect(sequence(order)).toEqual(['inside', 'loose'])
  })

  it('places content whose folder is gone after the tree, by its own order', () => {
    const order = computeManuscriptOrder(
      [{ id: 'folder', parentId: null, order: 100, title: 'Folder' }],
      [
        { id: 'orphan-b', containerId: 'deleted-folder', order: 2 },
        { id: 'orphan-a', containerId: 'deleted-folder', order: 1 },
        { id: 'kept', containerId: 'folder', order: 500 },
      ],
    )
    expect(sequence(order)).toEqual(['kept', 'orphan-a', 'orphan-b'])
    expect(order.get('orphan-a')?.folderPath).toBeNull()
  })

  it('treats missing and non-numeric orders as 0', () => {
    const order = computeManuscriptOrder([], [
      { id: 'second', containerId: null, order: 10 },
      { id: 'junk', containerId: null, order: 'abc' },
      { id: 'missing', containerId: null, order: null },
    ])
    expect(sequence(order)).toEqual(['junk', 'missing', 'second'])
  })
})
