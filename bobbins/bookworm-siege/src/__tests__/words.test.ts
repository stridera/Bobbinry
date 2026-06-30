import { completedWords, newlyCompleted, normalizeWord } from '../lib/words'

describe('completedWords', () => {
  it('returns nothing for empty or whitespace-only text', () => {
    expect(completedWords('')).toEqual([])
    expect(completedWords('   ')).toEqual([])
  })

  it('treats a trailing token without a boundary as in-progress', () => {
    expect(completedWords('hello wor')).toEqual(['hello'])
    expect(completedWords('hello')).toEqual([])
  })

  it('counts a word once a boundary follows it', () => {
    expect(completedWords('hello ')).toEqual(['hello'])
    expect(completedWords('hello world ')).toEqual(['hello', 'world'])
  })

  it('treats punctuation as a boundary', () => {
    expect(completedWords('hello, world!')).toEqual(['hello', 'world'])
    expect(completedWords('one. two. three')).toEqual(['one', 'two'])
  })

  it('keeps apostrophes and hyphens inside words', () => {
    expect(completedWords("don't worry ")).toEqual(["don't", 'worry'])
    expect(completedWords('well-known fact ')).toEqual(['well-known', 'fact'])
  })

  it('handles newlines as boundaries', () => {
    expect(completedWords('first\nsecond ')).toEqual(['first', 'second'])
  })
})

describe('newlyCompleted', () => {
  it('returns nothing when text did not grow', () => {
    expect(newlyCompleted('hello world ', 'hello ')).toEqual([])
    expect(newlyCompleted('hello world ', 'hello world ')).toEqual([])
  })

  it('returns nothing while only an in-progress token grows', () => {
    expect(newlyCompleted('hello ', 'hello wor')).toEqual([])
  })

  it('returns the word that just completed', () => {
    expect(newlyCompleted('hello wor', 'hello world ')).toEqual(['world'])
  })

  it('returns multiple words when several complete at once (e.g. paste)', () => {
    expect(newlyCompleted('the ', 'the quick brown ')).toEqual(['quick', 'brown'])
  })

  it('completes a word when a boundary is added after it', () => {
    expect(newlyCompleted('hello world', 'hello world ')).toEqual(['world'])
  })
})

describe('normalizeWord', () => {
  it('lowercases and strips surrounding punctuation', () => {
    expect(normalizeWord('Ninjas!')).toBe('ninjas')
    expect(normalizeWord('  "Dragon" ')).toBe('dragon')
    expect(normalizeWord("don't")).toBe("don't")
  })
})
