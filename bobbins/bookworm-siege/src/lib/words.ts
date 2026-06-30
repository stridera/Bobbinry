/**
 * Word extraction from the editor's full-text updates.
 *
 * The manuscript editor broadcasts the *entire* document text on each edit
 * (`bobbinry:editor-content-update`), not a per-keystroke delta. To drive the
 * game we need to know which words were just *completed* (i.e. the writer typed
 * a word and then a boundary — space, punctuation, or newline — after it). The
 * in-progress trailing token must not fire until the writer finishes it.
 *
 * These helpers are pure so they can be unit-tested without a DOM.
 */

// A "token" is a run of word characters (letters, digits, apostrophes/hyphens
// inside words). We treat anything else as a boundary.
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu

/**
 * Return the list of *completed* words in `text` — every word that is followed
 * by a boundary character. The final token is only included when the text ends
 * with a boundary (meaning the writer finished that word).
 */
export function completedWords(text: string): string[] {
  if (!text) return []
  const matches = Array.from(text.matchAll(WORD_RE))
  if (matches.length === 0) return []

  const words = matches.map((m) => m[0])

  // Is the last token still being typed? It is "in progress" when the very last
  // character of the text is part of that final token (no trailing boundary).
  const last = matches[matches.length - 1]
  if (!last) return words
  const lastEnd = (last.index ?? 0) + last[0].length
  const trailingInProgress = lastEnd === text.length

  return trailingInProgress ? words.slice(0, -1) : words
}

/**
 * Given the previous and next full-text snapshots, return the words that became
 * newly completed in `next`. We compare completed-word lists and return the tail
 * that grew. This mirrors the cat bobbin's "only react to growth" constraint:
 * we ignore edits that don't increase the completed-word count (deletions,
 * mid-document tweaks), which keeps the game forgiving and cheap.
 */
export function newlyCompleted(prev: string, next: string): string[] {
  if (next.length <= prev.length) return []

  const prevWords = completedWords(prev)
  const nextWords = completedWords(next)
  const delta = nextWords.length - prevWords.length
  if (delta <= 0) return []

  return nextWords.slice(nextWords.length - delta)
}

/**
 * Normalise a word for secret-word matching: lowercase, stripped of surrounding
 * punctuation. (The WORD_RE already excludes leading/trailing punctuation, but
 * config-supplied secret words may carry stray characters.)
 */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}
