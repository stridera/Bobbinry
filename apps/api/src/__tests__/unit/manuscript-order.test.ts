import { describe, it, expect } from '@jest/globals'
import {
  computeManuscriptOrder,
  displayChapterTitle,
  numberChapters,
  type ManuscriptOrder,
} from '../../lib/manuscript-order'

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
    expect(order.get('ch14')).toEqual({ position: 2, folderPath: 'Part 2', bookId: 'part2' })
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

describe('numberChapters', () => {
  const order = computeManuscriptOrder(
    [
      { id: 'book1', parentId: null, order: 100, title: 'Book One' },
      { id: 'act1', parentId: 'book1', order: 100, title: 'Act I' },
      { id: 'book2', parentId: null, order: 200, title: 'Book Two' },
    ],
    [
      { id: 'prologue', containerId: null, order: 50 },
      { id: 'b1c1', containerId: 'act1', order: 100 },
      { id: 'b1c2', containerId: 'act1', order: 200 },
      { id: 'b1c3', containerId: 'book1', order: 300 },
      { id: 'b2c1', containerId: 'book2', order: 100 },
      { id: 'b2c2', containerId: 'book2', order: 200 },
    ],
  )
  const all = ['b2c2', 'b1c3', 'prologue', 'b1c1', 'b2c1', 'b1c2']

  it('records the outermost folder as the book, however deep the chapter sits', () => {
    expect(order.get('b1c1')?.bookId).toBe('book1')
    expect(order.get('b1c3')?.bookId).toBe('book1')
    expect(order.get('b2c1')?.bookId).toBe('book2')
    expect(order.get('prologue')?.bookId).toBeNull()
  })

  it('numbers continuously in manuscript order regardless of input order', () => {
    const numbers = numberChapters(order, all, 'continuous')
    expect(sequence(order).map(id => numbers.get(id))).toEqual([1, 2, 3, 4, 5, 6])
    expect(numbers.get('prologue')).toBe(1)
    expect(numbers.get('b2c2')).toBe(6)
  })

  it('restarts in each top-level folder when per-book', () => {
    const numbers = numberChapters(order, all, 'per-book')
    expect(Object.fromEntries(numbers)).toEqual({
      prologue: 1, b1c1: 1, b1c2: 2, b1c3: 3, b2c1: 1, b2c2: 2,
    })
  })

  it('numbers only the chapters it is given, with no gaps', () => {
    // A reader who cannot see b1c2 gets 1, 2, 3 — not 1, 3, 4.
    const numbers = numberChapters(order, ['prologue', 'b1c1', 'b1c3'], 'continuous')
    expect(Object.fromEntries(numbers)).toEqual({ prologue: 1, b1c1: 2, b1c3: 3 })
  })

  it('does nothing when off', () => {
    expect(numberChapters(order, all, 'off').size).toBe(0)
  })

  it('renumbers when a chapter moves, with no other input', () => {
    const moved = computeManuscriptOrder(
      [{ id: 'book1', parentId: null, order: 100, title: 'Book One' }],
      [
        { id: 'x', containerId: 'book1', order: 100 },
        { id: 'y', containerId: 'book1', order: 200 },
      ],
    )
    expect(numberChapters(moved, ['x', 'y'], 'continuous').get('y')).toBe(2)
    const swapped = computeManuscriptOrder(
      [{ id: 'book1', parentId: null, order: 100, title: 'Book One' }],
      [
        { id: 'x', containerId: 'book1', order: 300 },
        { id: 'y', containerId: 'book1', order: 200 },
      ],
    )
    expect(numberChapters(swapped, ['x', 'y'], 'continuous').get('y')).toBe(1)
  })
})

describe('displayChapterTitle', () => {
  it('formats numbered chapters and leaves others untouched', () => {
    const numbers = new Map([['a', 3]])
    expect(displayChapterTitle(numbers, 'a', 'Chapter 9 - Storm')).toBe('Chapter 3: Storm')
    expect(displayChapterTitle(numbers, 'a', '')).toBe('Chapter 3')
    expect(displayChapterTitle(numbers, 'b', 'Storm')).toBe('Storm')
    expect(displayChapterTitle(numbers, 'b', null)).toBe('')
  })
})
