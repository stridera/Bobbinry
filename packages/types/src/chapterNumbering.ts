/**
 * Automatic chapter numbering — a display-only transform.
 *
 * Numbers are derived from manuscript order every time they are shown and are
 * never written into a chapter's title. Titles drive published URL slugs, so
 * baking "Chapter 3:" into a title would break links the moment chapters move.
 *
 * Shared by the API (reader, SEO, exports) and the editor's navigation tree so
 * every surface agrees on the same numbers and wording.
 */

export type ChapterNumbering = 'off' | 'continuous' | 'per-book'

export const CHAPTER_NUMBERING_VALUES: readonly ChapterNumbering[] = ['off', 'continuous', 'per-book'] as const

export const CHAPTER_NUMBERING_LABELS: Record<ChapterNumbering, string> = {
  off: 'Off',
  continuous: 'Continuous',
  'per-book': 'Restart in each book',
}

export function isChapterNumbering(value: unknown): value is ChapterNumbering {
  return typeof value === 'string' && (CHAPTER_NUMBERING_VALUES as readonly string[]).includes(value)
}

/**
 * A manual number at the start of a title, so an author's existing
 * "Chapter 7 - Foo" does not become "Chapter 3: Chapter 7 - Foo".
 *
 * Matches, case-insensitively:
 *  - "Chapter 12" / "Ch. 12" / "Ch 12", optionally followed by a separator
 *    (":", ".", "-", en/em dash). The word form is unambiguous, so no
 *    separator is required.
 *  - a bare number of 1-3 digits followed by a separator or end of string
 *    ("12.", "12 -", "12"). The 3-digit cap, and requiring a separator,
 *    leave "1984", "2001: A Space Odyssey" and "12 Angry Men" alone.
 *    A "." directly followed by a digit ("3.14 Pi") is not a separator.
 */
const MANUAL_NUMBER_PREFIX = new RegExp(
  '^\\s*(?:' +
    '(?:chapter|ch)\\.?\\s*\\d+(?![\\d\\p{L}])(?:\\s*[:.\\-\\u2013\\u2014](?!\\d))?' +
    '|' +
    '\\d{1,3}(?:\\s*[:\\-\\u2013\\u2014]|\\.(?!\\d)|\\s*$)' +
  ')\\s*',
  'iu',
)

/** Title without a leading manual chapter number (trimmed). */
export function stripManualChapterNumber(title: string | null | undefined): string {
  return (title ?? '').replace(MANUAL_NUMBER_PREFIX, '').trim()
}

/** "Chapter N: Title", or "Chapter N" when the title is empty once any manual number is removed. */
export function formatChapterTitle(title: string | null | undefined, n: number): string {
  const rest = stripManualChapterNumber(title)
  return rest ? `Chapter ${n}: ${rest}` : `Chapter ${n}`
}

export interface NumberableChapter {
  id: string
  /** Id of the chapter's top-level folder (its "book"); null at the manuscript root. */
  bookId: string | null
}

/**
 * Chapter number per id. `ordered` must already be in manuscript order (and
 * contain only the chapters that should be counted). `continuous` counts
 * project-wide; `per-book` restarts at 1 within each top-level folder.
 * Returns an empty map for `off`.
 */
export function computeChapterNumbers(
  ordered: readonly NumberableChapter[],
  mode: ChapterNumbering,
): Map<string, number> {
  const numbers = new Map<string, number>()
  if (mode === 'off') return numbers
  const perBook = new Map<string, number>()
  let continuous = 0
  for (const chapter of ordered) {
    if (mode === 'continuous') {
      numbers.set(chapter.id, ++continuous)
    } else {
      const key = chapter.bookId ?? ''
      const next = (perBook.get(key) ?? 0) + 1
      perBook.set(key, next)
      numbers.set(chapter.id, next)
    }
  }
  return numbers
}
