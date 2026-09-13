import { describe, it, expect } from '@jest/globals'
import { rangeBetween, reorderWithBlock, topLevelSelection, visibleIds } from '../../lib/tree-selection'

interface Node {
  id: string
  children?: Node[]
}

// Book 1 [ch1, ch2, Part A [ch3, ch4]], ch5
const TREE: Node[] = [
  {
    id: 'book1',
    children: [
      { id: 'ch1' },
      { id: 'ch2' },
      { id: 'partA', children: [{ id: 'ch3' }, { id: 'ch4' }] },
    ],
  },
  { id: 'ch5' },
]

describe('visibleIds', () => {
  it('lists rows in display order', () => {
    expect(visibleIds(TREE, new Set(['book1', 'partA']))).toEqual(['book1', 'ch1', 'ch2', 'partA', 'ch3', 'ch4', 'ch5'])
  })

  it('skips the children of collapsed containers', () => {
    expect(visibleIds(TREE, new Set(['book1']))).toEqual(['book1', 'ch1', 'ch2', 'partA', 'ch5'])
  })
})

describe('rangeBetween', () => {
  const ids = ['book1', 'ch1', 'ch2', 'partA', 'ch3', 'ch4', 'ch5']

  it('spans anchor to target inclusive, in either direction', () => {
    expect(rangeBetween(ids, 'ch1', 'ch3')).toEqual(['ch1', 'ch2', 'partA', 'ch3'])
    expect(rangeBetween(ids, 'ch3', 'ch1')).toEqual(['ch1', 'ch2', 'partA', 'ch3'])
  })

  it('is null without a visible anchor', () => {
    expect(rangeBetween(ids, null, 'ch3')).toBeNull()
    expect(rangeBetween(ids, 'gone', 'ch3')).toBeNull()
  })
})

describe('topLevelSelection', () => {
  it('returns selected nodes in tree order regardless of selection order', () => {
    const picked = topLevelSelection(TREE, new Set(['ch5', 'ch3', 'ch1']))
    expect(picked.map(n => n.id)).toEqual(['ch1', 'ch3', 'ch5'])
  })

  it('drops nodes whose container is also selected', () => {
    // A Shift+click range over an expanded folder picks up its children too;
    // they must not also be moved on their own, out of the folder.
    const picked = topLevelSelection(TREE, new Set(['ch2', 'partA', 'ch3', 'ch4']))
    expect(picked.map(n => n.id)).toEqual(['ch2', 'partA'])
  })
})

describe('reorderWithBlock', () => {
  const siblings = ['a', 'b', 'c', 'd', 'e']

  it('moves the block before the target, keeping its order', () => {
    expect(reorderWithBlock(siblings, ['d', 'e'], 'b', 'before')).toEqual(['a', 'd', 'e', 'b', 'c'])
  })

  it('moves the block after the target', () => {
    expect(reorderWithBlock(siblings, ['a', 'c'], 'd', 'after')).toEqual(['b', 'd', 'a', 'c', 'e'])
  })

  it('inserts items coming from another container', () => {
    expect(reorderWithBlock(['a', 'b'], ['x', 'y'], 'a', 'after')).toEqual(['a', 'x', 'y', 'b'])
  })
})
