import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { formatTable, timeAgo, shortId } from '../lib/output.js'

describe('formatTable', () => {
  it('returns "(none)" for empty rows', () => {
    expect(formatTable([], [{ key: 'id', label: 'ID' }])).toBe('  (none)')
  })

  it('formats rows with header and separator', () => {
    const result = formatTable(
      [
        { id: 'abc', name: 'Alice' },
        { id: 'def', name: 'Bob' },
      ],
      [
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name' },
      ]
    )

    const lines = result.split('\n')
    expect(lines[0]).toContain('ID')
    expect(lines[0]).toContain('Name')
    expect(lines[1]).toMatch(/─+/)
    expect(lines[2]).toContain('abc')
    expect(lines[2]).toContain('Alice')
    expect(lines[3]).toContain('def')
    expect(lines[3]).toContain('Bob')
  })

  it('truncates values exceeding column width', () => {
    const result = formatTable(
      [{ val: 'a very long value that should be truncated' }],
      [{ key: 'val', label: 'Val', width: 10 }]
    )

    const dataLine = result.split('\n')[2]
    expect(dataLine.length).toBeLessThanOrEqual(result.split('\n')[0].length)
  })

  it('handles undefined values', () => {
    const result = formatTable(
      [{ id: 'x', name: undefined }],
      [
        { key: 'id', label: 'ID' },
        { key: 'name', label: 'Name' },
      ]
    )

    expect(result).toContain('x')
    // undefined renders as empty string
    expect(result).not.toContain('undefined')
  })
})

describe('timeAgo', () => {
  it('returns "just now" for recent dates', () => {
    expect(timeAgo(new Date())).toBe('just now')
  })

  it('returns minutes ago', () => {
    const d = new Date(Date.now() - 5 * 60 * 1000)
    expect(timeAgo(d)).toBe('5m ago')
  })

  it('returns hours ago', () => {
    const d = new Date(Date.now() - 3 * 60 * 60 * 1000)
    expect(timeAgo(d)).toBe('3h ago')
  })

  it('returns days ago', () => {
    const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    expect(timeAgo(d)).toBe('7d ago')
  })

  it('returns months ago', () => {
    const d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    expect(timeAgo(d)).toBe('2mo ago')
  })

  it('returns years ago', () => {
    const d = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
    expect(timeAgo(d)).toBe('1y ago')
  })

  it('accepts ISO string input', () => {
    const d = new Date(Date.now() - 120 * 1000).toISOString()
    expect(timeAgo(d)).toBe('2m ago')
  })
})

describe('shortId', () => {
  it('returns first 8 characters', () => {
    expect(shortId('f609957b-cd0f-4fd4-a78b-e3ea69582e4c')).toBe('f609957b')
  })

  it('handles short strings', () => {
    expect(shortId('abc')).toBe('abc')
  })
})
