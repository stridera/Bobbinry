import { diffHtmlBodies, diffParagraph } from '../../entity-diff'
import { wordDelta } from '../../text'
import { coalesceChanges, type RawChangeRow } from '../../entity-changes'

describe('wordDelta', () => {
  it('reconciles with the word count by construction', () => {
    // The change feed reports wordsAdded/wordsRemoved alongside a word count
    // computed by a different code path. If `added - removed` ever disagreed
    // with the length difference, consumers would (correctly) file it as a bug.
    const cases: Array<[string[], string[]]> = [
      [['a', 'b', 'c'], ['a', 'b', 'c', 'd']],
      [['a', 'b', 'c'], ['a']],
      [[], ['x', 'y']],
      [['x', 'y'], []],
      [['the', 'the', 'the'], ['the']],
      [['one', 'two'], ['two', 'one']],
    ]
    for (const [before, after] of cases) {
      const { added, removed } = wordDelta(before, after)
      expect(added - removed).toBe(after.length - before.length)
    }
  })

  it('reports a reorder as no churn', () => {
    // Being order-insensitive is the point: moving a paragraph is not writing.
    expect(wordDelta(['a', 'b', 'c'], ['c', 'b', 'a'])).toEqual({ added: 0, removed: 0 })
  })

  it('counts a swap as one in and one out', () => {
    expect(wordDelta(['lunged', 'at'], ['kissed', 'at'])).toEqual({ added: 1, removed: 1 })
  })
})

describe('diffHtmlBodies', () => {
  const before = '<p>Garron drew his blade and lunged at the succubus.</p><p>She laughed.</p>'
  const after = '<p>Garron leaned in and kissed the succubus.</p><p>She laughed.</p>'

  it('pairs a rewritten paragraph into one replace hunk', () => {
    // Reporting this as an unrelated removal plus an unrelated addition would
    // bury the only thing the caller wants: that THIS became THAT.
    const diff = diffHtmlBodies(before, after)
    const replaces = diff.hunks.filter(h => h.type === 'replace')
    expect(replaces).toHaveLength(1)
    expect(replaces[0]!.before).toContain('lunged at the succubus')
    expect(replaces[0]!.after).toContain('kissed the succubus')
    expect(diff.stats.paragraphs.modified).toBe(1)
  })

  it('leaves untouched paragraphs out of the hunks', () => {
    const diff = diffHtmlBodies(before, after)
    expect(diff.hunks.every(h => !(h.before ?? h.after ?? '').includes('She laughed'))).toBe(true)
  })

  it('reports pure additions and removals separately', () => {
    const added = diffHtmlBodies('<p>One.</p>', '<p>One.</p><p>Two.</p>')
    expect(added.hunks.map(h => h.type)).toEqual(['add'])
    expect(added.stats.paragraphs.added).toBe(1)

    const removed = diffHtmlBodies('<p>One.</p><p>Two.</p>', '<p>One.</p>')
    expect(removed.hunks.map(h => h.type)).toEqual(['remove'])
    expect(removed.stats.paragraphs.removed).toBe(1)
  })

  it('reports no hunks when nothing changed', () => {
    const diff = diffHtmlBodies(before, before)
    expect(diff.hunks).toHaveLength(0)
    expect(diff.stats).toMatchObject({ wordsAdded: 0, wordsRemoved: 0 })
    expect(diff.truncated).toBe(false)
  })

  it('flags truncation rather than degrading silently', () => {
    const huge = '<p>' + 'word '.repeat(200_000) + '</p>'
    const diff = diffHtmlBodies(huge, huge + '<p>extra</p>')
    expect(diff.truncated).toBe(true)
    // Counts stay exact even when hunks are withheld.
    expect(diff.stats.wordCountBefore).toBeGreaterThan(0)
  })

  it('caps the hunk count', () => {
    const before = Array.from({ length: 300 }, (_, i) => `<p>old ${i}</p>`).join('')
    const after = Array.from({ length: 300 }, (_, i) => `<p>new ${i}</p>`).join('')
    const diff = diffHtmlBodies(before, after, { maxHunks: 10 })
    expect(diff.hunks).toHaveLength(10)
    expect(diff.truncated).toBe(true)
  })
})

describe('diffParagraph', () => {
  it('marks the changed words inside a sentence', () => {
    const parts = diffParagraph(
      'Garron drew his blade and lunged at the succubus.',
      'Garron leaned in and kissed the succubus.',
    )
    const added = parts.filter(p => p.kind === 'added').map(p => p.value).join('')
    const removed = parts.filter(p => p.kind === 'removed').map(p => p.value).join('')
    expect(added).toContain('kissed')
    expect(removed).toContain('lunged')
    expect(parts.some(p => p.kind === 'same' && p.value.includes('Garron'))).toBe(true)
  })
})

describe('coalesced delta arithmetic', () => {
  const row = (over: Partial<RawChangeRow>): RawChangeRow => ({
    seq: 1,
    entityId: 'e1',
    collection: 'content',
    contentType: 'chapter',
    title: 'Ch',
    action: 'updated',
    lifecycle: null,
    fieldsChanged: ['body'],
    wordCountBefore: null,
    wordCountAfter: null,
    wordsAdded: null,
    wordsRemoved: null,
    revisionId: null,
    source: null,
    occurredAt: new Date(),
    ...over,
  })

  it('sums churn across a window', () => {
    const [c] = coalesceChanges([
      row({ seq: 1, wordCountBefore: 100, wordCountAfter: 150, wordsAdded: 60, wordsRemoved: 10 }),
      row({ seq: 2, wordCountBefore: 150, wordCountAfter: 140, wordsAdded: 5, wordsRemoved: 15 }),
    ])
    expect(c!.wordsAdded).toBe(65)
    expect(c!.wordsRemoved).toBe(25)
    // The invariant that makes both numbers trustworthy.
    expect(c!.wordsAdded! - c!.wordsRemoved!).toBe(c!.wordCountDelta)
  })

  it('holds the invariant across a create', () => {
    const [c] = coalesceChanges([
      row({ seq: 1, action: 'created', wordCountAfter: 40, wordsAdded: 40, wordsRemoved: 0 }),
      row({ seq: 2, wordCountBefore: 40, wordCountAfter: 55, wordsAdded: 20, wordsRemoved: 5 }),
    ])
    expect(c!.action).toBe('created')
    expect(c!.wordsAdded! - c!.wordsRemoved!).toBe(c!.wordCountDelta)
  })

  it('holds the invariant across a delete', () => {
    const [c] = coalesceChanges([
      row({ seq: 1, wordCountBefore: 100, wordCountAfter: 120, wordsAdded: 25, wordsRemoved: 5 }),
      row({ seq: 2, action: 'deleted', lifecycle: 'trashed', wordCountBefore: 120, wordsAdded: 0, wordsRemoved: 120 }),
    ])
    expect(c!.action).toBe('deleted')
    expect(c!.wordsAdded! - c!.wordsRemoved!).toBe(c!.wordCountDelta)
  })

  it('distinguishes a revision pass from new writing', () => {
    // This is the classification the daily-sync bot needs, and the reason the
    // feed carries churn at all: both of these have delta 0-ish, but only one
    // represents an hour of work.
    const [rewrite] = coalesceChanges([
      row({ wordCountBefore: 3000, wordCountAfter: 3010, wordsAdded: 340, wordsRemoved: 330 }),
    ])
    const [idle] = coalesceChanges([
      row({ entityId: 'e2', wordCountBefore: 3000, wordCountAfter: 3010, wordsAdded: 10, wordsRemoved: 0 }),
    ])
    expect(rewrite!.wordsAdded! + rewrite!.wordsRemoved!).toBeGreaterThan(500)
    expect(idle!.wordsAdded! + idle!.wordsRemoved!).toBeLessThan(50)
  })

  it('stays null when nothing in the window computed a delta', () => {
    const [c] = coalesceChanges([row({ fieldsChanged: ['order'] })])
    expect(c!.wordsAdded).toBeNull()
    expect(c!.wordsRemoved).toBeNull()
  })

  it('keeps the oldest revision id as the diff start point', () => {
    const [c] = coalesceChanges([
      row({ seq: 1, revisionId: 'rev-first' }),
      row({ seq: 2, revisionId: 'rev-second' }),
    ])
    expect(c!.revisionIdFirst).toBe('rev-first')
  })

  it('collects non-edit sources', () => {
    const [c] = coalesceChanges([
      row({ seq: 1 }),
      row({ seq: 2, source: 'restore' }),
      row({ seq: 3, source: 'restore' }),
    ])
    expect(c!.sources).toEqual(['restore'])
  })
})
