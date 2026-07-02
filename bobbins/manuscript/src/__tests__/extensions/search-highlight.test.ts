/**
 * Parity tests for the SearchHighlight find helpers.
 *
 * Occurrence numbering must agree with the API's scanner
 * (apps/api/src/lib/search-replace.ts) — same escaping, same flags, same
 * per-text-node scan that skips matches straddling node boundaries. Several
 * fixtures here mirror the API unit tests on purpose.
 */

import { Schema } from '@tiptap/pm/model'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  buildFindRegex,
  findMatchRanges,
  MAX_FIND_MATCHES,
} from '../../extensions/search-highlight'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
  },
  marks: {
    em: {},
  },
})

function docOf(...paragraphs: ProseMirrorNode[]): ProseMirrorNode {
  return schema.node('doc', null, paragraphs)
}

function p(...content: ProseMirrorNode[]): ProseMirrorNode {
  return schema.node('paragraph', null, content)
}

function text(t: string, em = false): ProseMirrorNode {
  return schema.text(t, em ? [schema.mark('em')] : [])
}

/** The matched substrings, in order, for readable assertions. */
function matchedTexts(doc: ProseMirrorNode, query: string, opts?: { caseSensitive?: boolean; wholeWord?: boolean }): string[] {
  return findMatchRanges(doc, {
    query,
    caseSensitive: opts?.caseSensitive ?? false,
    wholeWord: opts?.wholeWord ?? false,
  }).map(r => doc.textBetween(r.from, r.to))
}

describe('buildFindRegex', () => {
  it('returns null for an empty query', () => {
    expect(buildFindRegex({ query: '', caseSensitive: false, wholeWord: false })).toBeNull()
  })

  it('is case-insensitive by default, case-sensitive on request', () => {
    expect(buildFindRegex({ query: 'a', caseSensitive: false, wholeWord: false })!.flags).toBe('gi')
    expect(buildFindRegex({ query: 'a', caseSensitive: true, wholeWord: false })!.flags).toBe('g')
  })

  it('escapes regex metacharacters', () => {
    const re = buildFindRegex({ query: 'a.b*(c)', caseSensitive: false, wholeWord: false })!
    expect(re.test('a.b*(c)')).toBe(true)
    expect(re.test('aXbbb(c)')).toBe(false)
  })

  it('wraps in word boundaries for whole-word', () => {
    const re = buildFindRegex({ query: 'cat', caseSensitive: false, wholeWord: true })!
    expect('the cat sat'.match(re)).toEqual(['cat'])
    expect('concatenate'.match(re)).toBeNull()
  })
})

describe('findMatchRanges', () => {
  it('finds all occurrences in document order across paragraphs', () => {
    const doc = docOf(
      p(text('The lantern glowed. Another lantern flickered.')),
      p(text('No lanterns here — wait, lantern!')),
    )
    const ranges = findMatchRanges(doc, { query: 'lantern', caseSensitive: false, wholeWord: false })
    expect(ranges).toHaveLength(4)
    // Strictly increasing document positions.
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.from).toBeGreaterThan(ranges[i - 1]!.from)
    }
    expect(matchedTexts(doc, 'lantern')).toEqual(['lantern', 'lantern', 'lantern', 'lantern'])
  })

  it('respects case sensitivity', () => {
    const doc = docOf(p(text('Star star STAR')))
    expect(matchedTexts(doc, 'star', { caseSensitive: true })).toEqual(['star'])
    expect(matchedTexts(doc, 'star')).toEqual(['Star', 'star', 'STAR'])
  })

  it('respects whole-word matching', () => {
    const doc = docOf(p(text('cat concatenate cat')))
    expect(matchedTexts(doc, 'cat', { wholeWord: true })).toEqual(['cat', 'cat'])
    expect(matchedTexts(doc, 'cat')).toEqual(['cat', 'cat', 'cat'])
  })

  it('skips matches straddling a text-node (mark) boundary, like the server', () => {
    // <em>lan</em>tern — "lantern" spans two text nodes and must NOT count.
    const doc = docOf(p(text('lan', true), text('tern and a whole lantern')))
    expect(matchedTexts(doc, 'lantern')).toEqual(['lantern'])
  })

  it('returns empty for an empty or whitespace-adjacent query', () => {
    const doc = docOf(p(text('anything')))
    expect(findMatchRanges(doc, { query: '', caseSensitive: false, wholeWord: false })).toEqual([])
  })

  it('caps results at MAX_FIND_MATCHES', () => {
    const doc = docOf(p(text('e'.repeat(MAX_FIND_MATCHES + 100))))
    const ranges = findMatchRanges(doc, { query: 'e', caseSensitive: false, wholeWord: false })
    expect(ranges).toHaveLength(MAX_FIND_MATCHES)
  })

  it('positions map back to the matched text', () => {
    const doc = docOf(p(text('abc')), p(text('xx abc xx')))
    const [first, second] = findMatchRanges(doc, { query: 'abc', caseSensitive: false, wholeWord: false })
    expect(doc.textBetween(first!.from, first!.to)).toBe('abc')
    expect(doc.textBetween(second!.from, second!.to)).toBe('abc')
  })
})
