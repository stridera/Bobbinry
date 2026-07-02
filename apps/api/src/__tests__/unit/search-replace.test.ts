import { describe, it, expect } from '@jest/globals'
import {
  buildSearchRegex,
  findInPlainText,
  replaceInPlainText,
  findInHtml,
  replaceInHtml,
  findInEntity,
  replaceInEntity,
  getEntityFields,
  parseMatchId,
} from '../../lib/search-replace'

describe('buildSearchRegex', () => {
  it('is case-insensitive by default', () => {
    const re = buildSearchRegex({ query: 'cat', caseSensitive: false, wholeWord: false })
    expect('CAT'.match(re)).not.toBeNull()
  })

  it('respects case-sensitive flag', () => {
    const re = buildSearchRegex({ query: 'cat', caseSensitive: true, wholeWord: false })
    expect('CAT'.match(re)).toBeNull()
    expect('cat'.match(re)).not.toBeNull()
  })

  it('honors whole-word with \\b boundaries', () => {
    const re = buildSearchRegex({ query: 'the', caseSensitive: false, wholeWord: true })
    expect('the bird'.match(re)).not.toBeNull()
    expect('theme'.match(re)).toBeNull()
  })

  it('escapes regex metacharacters in the query', () => {
    const re = buildSearchRegex({ query: 'a.b', caseSensitive: true, wholeWord: false })
    expect('axb'.match(re)).toBeNull()
    expect('a.b'.match(re)).not.toBeNull()
  })
})

describe('findInPlainText', () => {
  it('returns one entry per match with stable indices and context', () => {
    const text = 'Caelan walked. Caelan paused. Then Caelan ran.'
    const matches = findInPlainText(text, { query: 'Caelan', caseSensitive: true, wholeWord: false })
    expect(matches).toHaveLength(3)
    expect(matches.map(m => m.index)).toEqual([0, 1, 2])
    expect(matches[0]!.matchText).toBe('Caelan')
    expect(matches[1]!.contextBefore).toContain('walked')
    expect(matches[2]!.contextAfter).toContain('ran')
  })

  it('empty query yields no matches', () => {
    expect(findInPlainText('hello', { query: '', caseSensitive: false, wholeWord: false })).toEqual([])
  })
})

describe('replaceInPlainText', () => {
  it('replaces only selected match indices', () => {
    const text = 'Caelan, Caelan, Caelan'
    const out = replaceInPlainText(
      text,
      { query: 'Caelan', caseSensitive: true, wholeWord: false },
      'Cael',
      new Set([0, 2]),
    )
    expect(out).toBe('Cael, Caelan, Cael')
  })

  it('returns text unchanged when no indices selected', () => {
    const text = 'Caelan was here'
    const out = replaceInPlainText(text, { query: 'Caelan', caseSensitive: true, wholeWord: false }, 'Cael', new Set())
    expect(out).toBe(text)
  })

  it('respects case-insensitive matching when replacing', () => {
    const out = replaceInPlainText(
      'Hello WORLD world',
      { query: 'world', caseSensitive: false, wholeWord: false },
      'earth',
      new Set([0, 1]),
    )
    expect(out).toBe('Hello earth earth')
  })
})

describe('findInHtml', () => {
  it('does not match strings inside tag attributes (whole-word + casing)', () => {
    const html = '<p class="theme">the bird</p>'
    const matches = findInHtml(html, { query: 'the', caseSensitive: false, wholeWord: true })
    expect(matches).toHaveLength(1)
    expect(matches[0]!.matchText).toBe('the')
    expect(matches[0]!.contextAfter).toBe(' bird')
  })

  it('matches inside formatted text', () => {
    const html = '<p><strong>Caelan</strong> walked.</p>'
    const matches = findInHtml(html, { query: 'Caelan', caseSensitive: true, wholeWord: false })
    expect(matches).toHaveLength(1)
  })

  it('does NOT match across text-node boundaries (intentional v1 limitation)', () => {
    const html = '<p>Cae<em>lan</em> walked.</p>'
    const matches = findInHtml(html, { query: 'Caelan', caseSensitive: true, wholeWord: false })
    expect(matches).toHaveLength(0)
  })

  it('provides cross-node context (text before/after spans tags)', () => {
    const html = '<p>The <strong>brave</strong> Caelan smiled.</p>'
    const matches = findInHtml(html, { query: 'Caelan', caseSensitive: true, wholeWord: false })
    expect(matches).toHaveLength(1)
    expect(matches[0]!.contextBefore).toContain('brave')
  })

  it('returns one entry per occurrence within a single node', () => {
    const html = '<p>Caelan and Caelan</p>'
    const matches = findInHtml(html, { query: 'Caelan', caseSensitive: true, wholeWord: false })
    expect(matches).toHaveLength(2)
    expect(matches.map(m => m.index)).toEqual([0, 1])
  })
})

describe('replaceInHtml', () => {
  it('preserves markup around the replaced text', () => {
    const html = '<p><strong>Caelan</strong> walked.</p>'
    const out = replaceInHtml(
      html,
      { query: 'Caelan', caseSensitive: true, wholeWord: false },
      'Cael',
      new Set([0]),
    )
    expect(out).toBe('<p><strong>Cael</strong> walked.</p>')
  })

  it('replaces only selected occurrences across nodes', () => {
    const html = '<p>Caelan</p><p>Caelan</p><p>Caelan</p>'
    const out = replaceInHtml(
      html,
      { query: 'Caelan', caseSensitive: true, wholeWord: false },
      'Cael',
      new Set([0, 2]),
    )
    expect(out).toBe('<p>Cael</p><p>Caelan</p><p>Cael</p>')
  })

  it('replaces multiple occurrences within the same node', () => {
    const html = '<p>Caelan and Caelan</p>'
    const out = replaceInHtml(
      html,
      { query: 'Caelan', caseSensitive: true, wholeWord: false },
      'Cael',
      new Set([0, 1]),
    )
    expect(out).toBe('<p>Cael and Cael</p>')
  })
})

describe('getEntityFields', () => {
  it('returns the fixed chapter field list for content', () => {
    const specs = getEntityFields('content', { body: '<p>hi</p>', title: 'C1', synopsis: 's', notes: 'n' })
    expect(specs.map(s => s.field)).toEqual(['title', 'synopsis', 'notes', 'body'])
    expect(specs.find(s => s.field === 'body')!.kind).toBe('html')
  })

  it('returns only title for containers', () => {
    expect(getEntityFields('containers', { title: 'Act 1' })).toEqual([{ field: 'title', kind: 'plain' }])
  })

  it('walks top-level strings for other collections and skips meta keys', () => {
    const data = {
      name: 'Caelan',
      description: '<p>A wizard</p>',
      created_at: '2026-01-01',
      _meta: 'x',
      id: 'abc',
      color: '#fff',
      backstory: 'Born in winter.',
    }
    const specs = getEntityFields('character', data as any)
    expect(specs.map(s => s.field).sort()).toEqual(['backstory', 'description', 'name'])
    expect(specs.find(s => s.field === 'description')!.kind).toBe('html')
    expect(specs.find(s => s.field === 'name')!.kind).toBe('plain')
  })
})

describe('findInEntity', () => {
  it('coalesces nearby occurrences and ids the row by its first index', () => {
    // The two body Caelans are <40 chars apart, so their context windows would
    // overlap — they merge into one row carrying both occurrence indices.
    const data = { title: 'Caelan returns', body: '<p>Caelan walked. Caelan ran.</p>' }
    const matches = findInEntity('ent1', 'content', data, { query: 'Caelan', caseSensitive: true, wholeWord: false })
    expect(matches).toHaveLength(2)
    expect(matches.map(m => m.id)).toEqual(['ent1:title:0', 'ent1:body:0'])
    const body = matches.find(m => m.field === 'body')!
    expect(body.indices).toEqual([0, 1])
    // Both occurrences are highlighted in the single merged snippet.
    expect(body.segments.filter(s => s.match).map(s => s.text)).toEqual(['Caelan', 'Caelan'])
    expect(body.segments.find(s => !s.match)!.text).toContain('walked')
  })

  it('keeps occurrences far apart as separate rows', () => {
    const filler = ' '.repeat(60)
    const data = { body: `<p>Caelan walked.${filler}Then Caelan ran.</p>` }
    const matches = findInEntity('ent1', 'content', data, { query: 'Caelan', caseSensitive: true, wholeWord: false })
    expect(matches).toHaveLength(2)
    expect(matches.map(m => m.indices)).toEqual([[0], [1]])
    expect(matches.map(m => m.id)).toEqual(['ent1:body:0', 'ent1:body:1'])
  })
})

describe('replaceInEntity', () => {
  it('applies per-field selections and only touches changed fields', () => {
    const data = { title: 'Caelan returns', body: '<p>Caelan walked. Caelan ran.</p>' }
    const selections = new Map<string, Set<number>>([
      ['title', new Set([0])],
      ['body', new Set([1])],
    ])
    const result = replaceInEntity(
      'content',
      data,
      { query: 'Caelan', caseSensitive: true, wholeWord: false },
      'Cael',
      selections,
    )
    expect(result.touchedFields.sort()).toEqual(['body', 'title'])
    expect(result.data.title).toBe('Cael returns')
    expect(result.data.body).toBe('<p>Caelan walked. Cael ran.</p>')
  })

  it('does not modify fields with empty selections', () => {
    const data = { title: 'Caelan returns', body: '<p>Caelan walked.</p>' }
    const result = replaceInEntity(
      'content',
      data,
      { query: 'Caelan', caseSensitive: true, wholeWord: false },
      'Cael',
      new Map([['title', new Set([0])]]),
    )
    expect(result.data.body).toBe('<p>Caelan walked.</p>')
    expect(result.touchedFields).toEqual(['title'])
  })
})

describe('parseMatchId', () => {
  it('parses well-formed ids', () => {
    expect(parseMatchId('abc-123:body:7')).toEqual({ entityId: 'abc-123', field: 'body', index: 7 })
  })

  it('handles field names that contain hyphens but no colons', () => {
    expect(parseMatchId('e1:custom-field:0')).toEqual({ entityId: 'e1', field: 'custom-field', index: 0 })
  })

  it('returns null for malformed ids', () => {
    expect(parseMatchId('no-colons')).toBeNull()
    expect(parseMatchId('e1:body:abc')).toBeNull()
    expect(parseMatchId(':body:0')).toBeNull()
  })
})
