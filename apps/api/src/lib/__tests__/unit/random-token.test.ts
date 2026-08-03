import { randomBase62 } from '../../random-token'

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

describe('randomBase62', () => {
  it('returns exactly the requested length', () => {
    // Rejection sampling refills in a loop, so a short draw would show up here.
    for (const length of [1, 8, 32, 64, 200]) {
      expect(randomBase62(length)).toHaveLength(length)
    }
  })

  it('emits only base62 characters', () => {
    expect(randomBase62(2000)).toMatch(/^[0-9A-Za-z]+$/)
  })

  it('does not repeat across calls', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => randomBase62(32)))
    expect(tokens.size).toBe(500)
  })

  it('does not over-represent the first eight characters of the alphabet', () => {
    // The bug this replaced used `byte % 62`, which mapped bytes 0-7 and
    // 248-255 onto '0'-'7' — giving them 5/256 against 4/256 for the other 54,
    // a 25% excess. Sample enough that such a skew cannot hide in noise.
    const SAMPLES = 200_000
    const counts = new Map<string, number>()
    for (const char of randomBase62(SAMPLES)) {
      counts.set(char, (counts.get(char) ?? 0) + 1)
    }

    expect(counts.size).toBe(62)

    const expected = SAMPLES / 62
    const biasedChars = BASE62.slice(0, 8)
    const biasedMean =
      [...biasedChars].reduce((sum, char) => sum + (counts.get(char) ?? 0), 0) / biasedChars.length

    // The old implementation put this at ~1.25. Tolerance is wide enough that
    // a fair generator will not flake, but 25% bias cannot slip through.
    expect(biasedMean / expected).toBeGreaterThan(0.9)
    expect(biasedMean / expected).toBeLessThan(1.1)
  })
})
