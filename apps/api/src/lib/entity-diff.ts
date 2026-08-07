/**
 * Prose diff between two versions of a chapter.
 *
 * This is the *pull-based* half of the change feed. The feed itself carries
 * only cheap multiset counts (lib/text.ts `wordDelta`), computed inline on
 * every autosave; the actual before/after prose lives here and is computed on
 * demand for one entity at a time.
 *
 * That split is what makes real diffing affordable. jsdiff's Myers algorithm is
 * O(n·d), and the inputs that drive d toward n — a search-replace or an import
 * that rewrites the whole body — are exactly the ones a writing tool sees. On
 * the autosave path that would share an event loop with the DB health check
 * that restarts the process on stalls. Here it runs once, for one chapter, on
 * an explicit request, behind a size cap and a timeout.
 *
 * The output is shaped for a reader, human or model: paragraph-level hunks
 * pairing what a passage said before with what it says now.
 */

import { diffArrays, diffWords } from 'diff'
import { htmlToParagraphs, tokenizeWords, wordDelta } from './text'

/** Above this, diffing stops being worth the CPU; callers get stats only. */
export const MAX_DIFF_CHARS = 500_000

/** Myers gets a hard budget rather than trust. */
const DIFF_TIMEOUT_MS = 500

export type HunkType = 'add' | 'remove' | 'replace'

export interface DiffHunk {
  type: HunkType
  /** Paragraph index in the *after* text (or where the removal was). */
  index: number
  before?: string
  after?: string
  /** Word-level highlights within a replace, when they're informative. */
  wordsAdded?: number
  wordsRemoved?: number
}

export interface EntityDiff {
  stats: {
    wordsAdded: number
    wordsRemoved: number
    wordCountBefore: number
    wordCountAfter: number
    paragraphs: { added: number; removed: number; modified: number }
  }
  hunks: DiffHunk[]
  /** True when output was capped — never degrade silently. */
  truncated: boolean
}

/**
 * Pair up adjacent removals and additions into `replace` hunks.
 *
 * A rewritten sentence shows up in a line diff as "these paragraphs left, these
 * arrived". Reporting that as two unrelated events would bury the thing the
 * caller actually wants — that *this* became *that*.
 */
function pairHunks(
  removed: string[],
  added: string[],
  indexAfter: number,
  out: DiffHunk[],
): void {
  const pairs = Math.min(removed.length, added.length)
  for (let i = 0; i < pairs; i++) {
    const delta = wordDelta(tokenizeWords(removed[i]!), tokenizeWords(added[i]!))
    out.push({
      type: 'replace',
      index: indexAfter + i,
      before: removed[i]!,
      after: added[i]!,
      wordsAdded: delta.added,
      wordsRemoved: delta.removed,
    })
  }
  for (let i = pairs; i < removed.length; i++) {
    out.push({ type: 'remove', index: indexAfter + pairs, before: removed[i]! })
  }
  for (let i = pairs; i < added.length; i++) {
    out.push({ type: 'add', index: indexAfter + i, after: added[i]! })
  }
}

/**
 * Diff two HTML bodies into paragraph-level hunks.
 *
 * `maxHunks` bounds the response: a whole-manuscript rewrite would otherwise
 * produce thousands of hunks and a response nobody can read.
 */
export function diffHtmlBodies(
  beforeHtml: string | null | undefined,
  afterHtml: string | null | undefined,
  options?: { maxHunks?: number },
): EntityDiff {
  const maxHunks = options?.maxHunks ?? 100

  const beforeParas = htmlToParagraphs(beforeHtml)
  const afterParas = htmlToParagraphs(afterHtml)

  const beforeWords = beforeParas.flatMap(p => tokenizeWords(p))
  const afterWords = afterParas.flatMap(p => tokenizeWords(p))
  const totals = wordDelta(beforeWords, afterWords)

  const stats = {
    wordsAdded: totals.added,
    wordsRemoved: totals.removed,
    wordCountBefore: beforeWords.length,
    wordCountAfter: afterWords.length,
    paragraphs: { added: 0, removed: 0, modified: 0 },
  }

  const tooBig =
    (beforeHtml?.length ?? 0) > MAX_DIFF_CHARS || (afterHtml?.length ?? 0) > MAX_DIFF_CHARS
  if (tooBig) {
    return { stats, hunks: [], truncated: true }
  }

  // Paragraph-granularity line diff. `diffArrays` compares whole paragraphs, so
  // an unchanged paragraph costs one comparison rather than a word walk.
  //
  // jsdiff returns undefined when it hits the timeout. Report that as truncated
  // rather than as "no changes" — the counts above are still exact, and a
  // consumer must be able to tell "nothing changed" from "we gave up".
  const parts = diffArrays(beforeParas, afterParas, { timeout: DIFF_TIMEOUT_MS })
  if (!parts) return { stats, hunks: [], truncated: true }

  const hunks: DiffHunk[] = []
  let indexAfter = 0
  let pendingRemoved: string[] = []

  for (const part of parts) {
    const values = part.value as string[]
    if (part.removed) {
      pendingRemoved.push(...values)
      continue
    }
    if (part.added) {
      pairHunks(pendingRemoved, values, indexAfter, hunks)
      stats.paragraphs.modified += Math.min(pendingRemoved.length, values.length)
      stats.paragraphs.added += Math.max(0, values.length - pendingRemoved.length)
      stats.paragraphs.removed += Math.max(0, pendingRemoved.length - values.length)
      pendingRemoved = []
      indexAfter += values.length
      continue
    }
    // Unchanged run: flush any removals that had no counterpart.
    if (pendingRemoved.length > 0) {
      pairHunks(pendingRemoved, [], indexAfter, hunks)
      stats.paragraphs.removed += pendingRemoved.length
      pendingRemoved = []
    }
    indexAfter += values.length
  }
  if (pendingRemoved.length > 0) {
    pairHunks(pendingRemoved, [], indexAfter, hunks)
    stats.paragraphs.removed += pendingRemoved.length
  }

  const truncated = hunks.length > maxHunks
  return { stats, hunks: truncated ? hunks.slice(0, maxHunks) : hunks, truncated }
}

/**
 * Word-level segments within one paragraph pair, for rendering an inline diff.
 *
 * Separate from `diffHtmlBodies` because most callers — a daily-report bot in
 * particular — only need the before/after pair and would pay for this for
 * nothing.
 */
export function diffParagraph(before: string, after: string) {
  // Undefined on timeout; fall back to the whole paragraph as one replacement
  // rather than pretending it is unchanged.
  const parts = diffWords(before, after, { timeout: DIFF_TIMEOUT_MS })
  if (!parts) {
    return [
      { value: before, kind: 'removed' as const },
      { value: after, kind: 'added' as const },
    ]
  }
  return parts.map(part => ({
    value: part.value,
    kind: part.added ? ('added' as const) : part.removed ? ('removed' as const) : ('same' as const),
  }))
}
