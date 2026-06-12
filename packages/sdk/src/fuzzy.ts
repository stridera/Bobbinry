/**
 * Tiny in-house fuzzy matcher: case-insensitive subsequence match with a
 * score that favors consecutive runs, word starts, and early matches.
 * Returns null when the query is not a subsequence of the text.
 */

export interface FuzzyMatch {
  score: number
  /** Indices into `text` of the matched characters, for highlighting. */
  indices: number[]
}

const WORD_BOUNDARY = /[\s\-_:.,/("']/

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (q.length === 0) return { score: 0, indices: [] }
  if (q.length > t.length) return null

  const indices: number[] = []
  let score = 0
  let ti = 0
  let prevMatch = -2

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!
    let found = -1
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti
        break
      }
      ti++
    }
    if (found === -1) return null

    indices.push(found)
    if (found === prevMatch + 1) {
      score += 8 // consecutive run
    } else {
      const gap = prevMatch < 0 ? found : found - prevMatch - 1
      score -= Math.min(gap, 10) // gap penalty, capped
    }
    if (found === 0 || WORD_BOUNDARY.test(t[found - 1]!)) {
      score += 10 // word-start bonus
    }
    prevMatch = found
    ti = found + 1
  }

  // Early-position + shortness bonuses keep "Chapter 1" above "Chapter 11: …"
  score += Math.max(0, 10 - indices[0]!)
  score -= Math.floor(t.length / 20)

  return { score, indices }
}
