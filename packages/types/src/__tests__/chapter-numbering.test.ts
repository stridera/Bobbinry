import {
  computeChapterNumbers,
  formatChapterTitle,
  stripManualChapterNumber,
} from '../chapterNumbering'
import { resolveDisplaySettings, sanitizeDisplaySettings } from '../manuscriptDisplay'

describe('formatChapterTitle', () => {
  it('prefixes the number', () => {
    expect(formatChapterTitle('The Storm', 3)).toBe('Chapter 3: The Storm')
  })

  it('drops the colon when the title is empty or whitespace', () => {
    expect(formatChapterTitle('', 4)).toBe('Chapter 4')
    expect(formatChapterTitle('   ', 4)).toBe('Chapter 4')
    expect(formatChapterTitle(null, 4)).toBe('Chapter 4')
    expect(formatChapterTitle(undefined, 4)).toBe('Chapter 4')
  })

  it('replaces a manual number instead of stacking a second one', () => {
    expect(formatChapterTitle('Chapter 7 - Foo', 3)).toBe('Chapter 3: Foo')
    expect(formatChapterTitle('Chapter 12: Foo', 3)).toBe('Chapter 3: Foo')
    expect(formatChapterTitle('CHAPTER 12 Foo', 3)).toBe('Chapter 3: Foo')
    expect(formatChapterTitle('Chapter 12', 3)).toBe('Chapter 3')
  })
})

describe('stripManualChapterNumber', () => {
  it.each([
    ['Chapter 12', ''],
    ['Chapter 12:', ''],
    ['Chapter 12 -', ''],
    ['Chapter 12 - The End', 'The End'],
    ['chapter 12: the end', 'the end'],
    ['Ch. 12.', ''],
    ['Ch. 12. Dawn', 'Dawn'],
    ['Ch 5 – Dawn', 'Dawn'],
    ['Chapter 5 — Dawn', 'Dawn'],
    ['12.', ''],
    ['12. Dawn', 'Dawn'],
    ['12 - Dawn', 'Dawn'],
    ['12: Dawn', 'Dawn'],
    ['12', ''],
    ['  7 – Dawn  ', 'Dawn'],
  ])('strips %j', (input, expected) => {
    expect(stripManualChapterNumber(input)).toBe(expected)
  })

  it.each([
    '1984',
    '12 Angry Men',
    '2001: A Space Odyssey',
    '3.14 Pi Day',
    'Chapter Zero',
    'Chaptered Lives',
    'Chapter 12abc',
    'Fahrenheit 451',
    'The 5 Rules',
    'Ch',
  ])('leaves %j alone', (input) => {
    expect(stripManualChapterNumber(input)).toBe(input)
  })
})

describe('computeChapterNumbers', () => {
  const ordered = [
    { id: 'a', bookId: 'book1' },
    { id: 'b', bookId: 'book1' },
    { id: 'c', bookId: 'book2' },
    { id: 'd', bookId: 'book2' },
    { id: 'e', bookId: null },
  ]

  it('returns nothing when off', () => {
    expect(computeChapterNumbers(ordered, 'off').size).toBe(0)
  })

  it('counts project-wide when continuous', () => {
    expect([...computeChapterNumbers(ordered, 'continuous')]).toEqual([
      ['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5],
    ])
  })

  it('restarts in each top-level folder when per-book', () => {
    expect([...computeChapterNumbers(ordered, 'per-book')]).toEqual([
      ['a', 1], ['b', 2], ['c', 1], ['d', 2], ['e', 1],
    ])
  })
})

describe('chapterNumbering in the display cascade', () => {
  it('defaults to off and cascades project over user', () => {
    expect(resolveDisplaySettings().chapterNumbering).toBe('off')
    expect(resolveDisplaySettings({ chapterNumbering: 'continuous' }, null).chapterNumbering).toBe('continuous')
    expect(resolveDisplaySettings({ chapterNumbering: 'continuous' }, { chapterNumbering: 'per-book' }).chapterNumbering).toBe('per-book')
    expect(resolveDisplaySettings({ chapterNumbering: 'continuous' }, { chapterNumbering: null }).chapterNumbering).toBe('continuous')
  })

  it('ignores a per-chapter value', () => {
    expect(resolveDisplaySettings(null, null, { chapterNumbering: 'continuous' }).chapterNumbering).toBe('off')
  })

  it('sanitizes junk values away', () => {
    expect(sanitizeDisplaySettings({ chapterNumbering: 'bogus' })).toEqual({})
    expect(sanitizeDisplaySettings({ chapterNumbering: 'per-book' })).toEqual({ chapterNumbering: 'per-book' })
  })
})
