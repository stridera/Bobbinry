/**
 * HTML → plain text, and the one word tokenizer.
 *
 * Every word count in the system must come from here. Chapter word counts are
 * user-visible (dashboard totals, the change feed's before/after, streaks and
 * daily reports), and the change feed's word deltas only reconcile with the
 * stored `word_count` if the counting tokenizer and the diffing tokenizer are
 * literally the same function. Eight private copies of "split on whitespace"
 * used to live across the routes and import parsers; they are all thin wrappers
 * over `countWords` / `countWordsFromHtml` now.
 *
 * The two bugs this replaces, both of which shifted real counts:
 *  - Replacing *every* tag with a space split `<em>in</em>line` into two words,
 *    so italicised part-words inflated counts.
 *  - Mapping `&[a-z]+;` to a space split `don&#39;t` into two words — and did
 *    not touch numeric entities at all, which is the form TipTap emits.
 *
 * Deliberately a regex scanner rather than a cheerio/parse5 parse. This runs on
 * the editor's autosave path (~1 save/sec/active writer) and shares an event
 * loop with the DB health check that restarts the process on stalls; ~0.2ms of
 * regex beats ~5ms of DOM building. It does not need to be a correct HTML
 * parser — it needs to find token boundaries.
 */

/**
 * Tags whose boundaries are word boundaries. Everything not listed is treated
 * as inline and contributes nothing, so `<em>in</em>line` stays one word.
 */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'div',
  'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

/** Tags whose *content* is not prose and must not be counted. */
const VOID_CONTENT_TAGS = new Set(['script', 'style'])

/**
 * Named entities worth resolving. The whitespace-ish ones matter most: they
 * decide token boundaries. Anything unlisted is left verbatim, which keeps it
 * as a single token either way.
 */
const NAMED_ENTITIES: Record<string, string> = {
  // separators
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  // zero-width: joiners must NOT become spaces or they split words
  shy: '', zwnj: '', zwj: '',
  // punctuation TipTap emits
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  mdash: '—', ndash: '–', hellip: '…', bull: '•', middot: '·',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', sbquo: '‚', bdquo: '„', prime: '′', Prime: '″',
  copy: '©', reg: '®', trade: '™', deg: '°', times: '×', frasl: '/',
}

/**
 * Resolve HTML entities in a single pass. Deliberately not recursive: `&amp;lt;`
 * means the literal text `&lt;`, not `<`.
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#[Xx]?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (full, body: string) => {
    if (body.charCodeAt(0) === 35 /* # */) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      // Reject out-of-range and surrogate code points — fromCodePoint throws.
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return full
      if (code >= 0xd800 && code <= 0xdfff) return full
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? full
  })
}

/**
 * Flatten HTML to plain text, preserving word and block boundaries.
 *
 * Block-level tags become newlines so `<p>end</p><p>Start</p>` yields two
 * words; inline tags vanish so `<em>in</em>line` yields one. Callers that need
 * paragraph structure (the revision diff) can split the result on `\n`.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (typeof html !== 'string' || html.length === 0) return ''

  let out = ''
  let cursor = 0
  // Comments first so `<!-- <p> -->` can't emit a spurious break.
  const token = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g
  let match: RegExpExecArray | null

  while ((match = token.exec(html)) !== null) {
    out += html.slice(cursor, match.index)
    cursor = match.index + match[0].length

    const tag = match[2]?.toLowerCase()
    if (tag === undefined) continue // comment

    if (VOID_CONTENT_TAGS.has(tag)) {
      // Skip to the matching close tag; its content is not prose.
      if (match[1] === '') {
        const end = html.slice(cursor).search(new RegExp(`</${tag}\\s*>`, 'i'))
        if (end !== -1) {
          cursor += end
          token.lastIndex = cursor
        }
      }
      out += '\n'
      continue
    }

    if (BLOCK_TAGS.has(tag)) out += '\n'
  }
  out += html.slice(cursor)

  return decodeHtmlEntities(out)
}

/** Split plain text into words. The single definition of "a word". */
export function tokenizeWords(text: string | null | undefined): string[] {
  if (typeof text !== 'string' || text.length === 0) return []
  const words: string[] = []
  for (const word of text.split(/\s+/)) {
    if (word.length > 0) words.push(word)
  }
  return words
}

/** Count words in already-plain text (import parsers, plain-text bodies). */
export function countWords(text: string | null | undefined): number {
  return tokenizeWords(text).length
}

/** Count words in an HTML body. The authoritative chapter word count. */
export function countWordsFromHtml(html: string | null | undefined): number {
  return tokenizeWords(htmlToPlainText(html)).length
}

/**
 * Tokenize an HTML body once, returning both the plain text and its words.
 *
 * The autosave path needs the count *and* (once change-feed deltas land) the
 * token list for the same body; this hands back both from a single pass so the
 * hot path never flattens the same HTML twice.
 */
export function tokenizeHtml(html: string | null | undefined): { text: string; words: string[]; count: number } {
  const text = htmlToPlainText(html)
  const words = tokenizeWords(text)
  return { text, words, count: words.length }
}

/** Plain-text paragraphs of an HTML body, blanks dropped. */
export function htmlToParagraphs(html: string | null | undefined): string[] {
  const paragraphs: string[] = []
  for (const line of htmlToPlainText(html).split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length > 0) paragraphs.push(trimmed)
  }
  return paragraphs
}
