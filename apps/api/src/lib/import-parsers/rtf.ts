/**
 * Rich Text Format (.rtf) manuscript parser.
 *
 * A minimal hand-rolled extractor: walks the RTF byte stream, skips known
 * non-content destinations (font/color/style tables, info, generator,
 * pictures), and emits the remaining text grouped into paragraphs on
 * \par / \page / \sect boundaries. Splits the resulting HTML on top-level
 * <h1>-like markers (RTF doesn't have a reliable explicit page break,
 * see the FORMATTING_LOST warning we always surface).
 *
 * Inline emphasis (bold, italic, etc.) is dropped on purpose — preserving
 * it from RTF reliably across producers (Word, LibreOffice, Mac TextEdit,
 * Apache OpenOffice) is brittle and the planner's notes flag the existing
 * RTF library landscape as "genuinely weak". We trade fidelity for
 * reliability and tell the user upfront.
 */

import { randomUUID } from 'crypto'
import * as cheerio from 'cheerio'
import type {
  ImportSegment,
  ImportWarning,
  ParserContext,
  ParserResult,
} from './index'
import { sanitizeImportedHtml } from './sanitize'

const FIRST_LINE_LIMIT = 140
const TITLE_FALLBACK_LIMIT = 80
const CHAPTER_HINT = /^(chapter|prologue|epilogue|part|book)\b/i

const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'filetbl', 'colortbl', 'stylesheet', 'info', 'pict',
  'object', 'rsidtbl', 'generator', 'listtable', 'listoverridetable',
  'xmlnstbl', 'datastore', 'header', 'footer', 'header1', 'footer1',
  'headerf', 'footerf', 'headerl', 'footerl', 'headerr', 'footerr',
  'comment', 'atnauthor', 'atndate', 'atnid', 'atnref', 'atntime',
  'bkmkstart', 'bkmkend', 'footnote', 'annotation', 'falt',
  'fldinst', 'private', 'themedata', 'colorschememapping',
  'latentstyles', 'datafield',
])

interface ParserState {
  /** Text buffer for the current paragraph */
  buf: string[]
  /** Completed paragraphs, plain text */
  paragraphs: string[]
  /** Stack of "skip text" flags, one per group depth */
  skipStack: boolean[]
  /** Whether the next control word is the destination marker after \\* */
  ignoreNextUnknown: boolean
}

function flushParagraph(state: ParserState) {
  const text = state.buf.join('').trim()
  if (text.length > 0) {
    state.paragraphs.push(text)
  }
  state.buf = []
}

function appendChar(state: ParserState, ch: string) {
  if (state.skipStack[state.skipStack.length - 1]) return
  state.buf.push(ch)
}

function appendText(state: ParserState, text: string) {
  if (state.skipStack[state.skipStack.length - 1]) return
  state.buf.push(text)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Decode the byte from `\\'XX` as Windows-1252 (the most common RTF
 *  character set; full Unicode passes through `\\uN` separately). */
function decodeHexByte(hex: string): string {
  const byte = parseInt(hex, 16)
  if (isNaN(byte)) return ''
  // Windows-1252 special range 0x80-0x9F maps to specific code points.
  const cp1252Specials: Record<number, number> = {
    0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E,
    0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6,
    0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152,
    0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C,
    0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A,
    0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
  }
  if (cp1252Specials[byte] !== undefined) {
    return String.fromCodePoint(cp1252Specials[byte]!)
  }
  return String.fromCharCode(byte)
}

function extractText(rtf: string): string[] {
  const state: ParserState = {
    buf: [],
    paragraphs: [],
    skipStack: [false],
    ignoreNextUnknown: false,
  }

  let i = 0
  const len = rtf.length

  while (i < len) {
    const ch = rtf[i]!

    if (ch === '{') {
      // New group — inherit parent's skip state
      const top = state.skipStack[state.skipStack.length - 1]!
      state.skipStack.push(top)
      i++
      continue
    }

    if (ch === '}') {
      state.skipStack.pop()
      // Restore to non-empty stack
      if (state.skipStack.length === 0) state.skipStack.push(false)
      i++
      continue
    }

    if (ch === '\\') {
      const next = rtf[i + 1]
      if (next === undefined) { i++; continue }

      // Escaped specials
      if (next === '\\' || next === '{' || next === '}') {
        appendChar(state, next)
        i += 2
        continue
      }

      // Hex-encoded byte: \'XX
      if (next === "'") {
        const hex = rtf.substr(i + 2, 2)
        appendText(state, decodeHexByte(hex))
        i += 4
        continue
      }

      // Unicode escape: \uN[?] — N is signed 16-bit decimal
      if (next === 'u') {
        // Read signed decimal after 'u'
        let j = i + 2
        let sign = 1
        if (rtf[j] === '-') { sign = -1; j++ }
        let digits = ''
        while (j < len && /\d/.test(rtf[j]!)) {
          digits += rtf[j]
          j++
        }
        if (digits.length > 0) {
          let code = parseInt(digits, 10) * sign
          if (code < 0) code = code + 0x10000
          appendText(state, String.fromCodePoint(code))
          // Skip the alternate replacement char (typically '?')
          if (rtf[j] === ' ') j++
          if (rtf[j] === '?') j++
          i = j
          continue
        }
      }

      // Special "ignore-if-unknown destination" marker: \*
      if (next === '*') {
        state.ignoreNextUnknown = true
        i += 2
        continue
      }

      // Control word: \word[N][ ]
      if (/[a-zA-Z]/.test(next)) {
        let j = i + 1
        let word = ''
        while (j < len && /[a-zA-Z]/.test(rtf[j]!)) {
          word += rtf[j]
          j++
        }
        // Optional numeric parameter
        let param = ''
        if (rtf[j] === '-') { param = '-'; j++ }
        while (j < len && /\d/.test(rtf[j]!)) {
          param += rtf[j]
          j++
        }
        // Optional single trailing space (eaten as part of the control word)
        if (rtf[j] === ' ') j++

        handleControlWord(state, word, param)
        i = j
        continue
      }

      // Other control symbol (single character, no param) — skip
      i += 2
      continue
    }

    if (ch === '\r' || ch === '\n') {
      // Whitespace between control words / formatting — ignore (RTF doesn't
      // use \n for paragraph breaks; \par does).
      i++
      continue
    }

    // Plain text byte
    appendChar(state, ch)
    i++
  }

  flushParagraph(state)
  return state.paragraphs
}

function handleControlWord(state: ParserState, word: string, _param: string) {
  // Destination control words — push true onto the skip stack for known
  // non-content destinations. If we see \* and don't recognize the next
  // control word, also skip its group.
  const wasIgnoreNext = state.ignoreNextUnknown
  state.ignoreNextUnknown = false

  if (SKIP_DESTINATIONS.has(word)) {
    if (state.skipStack.length > 0) {
      state.skipStack[state.skipStack.length - 1] = true
    }
    return
  }

  if (wasIgnoreNext) {
    // Unknown extension destination — skip the group.
    if (state.skipStack.length > 0) {
      state.skipStack[state.skipStack.length - 1] = true
    }
    return
  }

  // Paragraph breaks
  if (word === 'par' || word === 'sect' || word === 'page' || word === 'pard') {
    if (word === 'par' || word === 'sect' || word === 'page') {
      flushParagraph(state)
    }
    return
  }

  // Tab + line break
  if (word === 'tab') { appendChar(state, '\t'); return }
  if (word === 'line') { appendChar(state, '\n'); return }

  // Common special characters
  if (word === 'emdash') { appendText(state, '—'); return }
  if (word === 'endash') { appendText(state, '–'); return }
  if (word === 'lquote') { appendText(state, '‘'); return }
  if (word === 'rquote') { appendText(state, '’'); return }
  if (word === 'ldblquote') { appendText(state, '“'); return }
  if (word === 'rdblquote') { appendText(state, '”'); return }
  if (word === 'bullet') { appendText(state, '•'); return }
  if (word === 'nbsp') { appendText(state, ' '); return }
  if (word === 'tilde') { appendText(state, '~'); return }

  // Everything else (formatting commands like \b, \i, fonts, colors, etc.)
  // is ignored. We're text-only for v1.
}

function paragraphsToHtml(paragraphs: string[]): string {
  return paragraphs
    .map(p => {
      // Detect chapter-keyword paragraphs and promote to <h1> so the
      // splitter can use them. Otherwise emit <p>.
      if (CHAPTER_HINT.test(p) && p.length < 120) {
        return `<h1>${escapeHtml(p)}</h1>`
      }
      return `<p>${escapeHtml(p)}</p>`
    })
    .join('\n')
}

function countWordsFromText(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length
}

function firstSnippet(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > FIRST_LINE_LIMIT ? t.slice(0, FIRST_LINE_LIMIT) + '…' : t
}

function extractTitle(html: string, fallback: string): string {
  const $ = cheerio.load(`<div id="root">${html}</div>`, null, false)
  const root = $('#root')
  for (const tag of ['h1', 'h2', 'h3']) {
    const el = root.find(tag).first()
    if (el.length > 0) {
      const text = el.text().trim()
      if (text) {
        return text.length > TITLE_FALLBACK_LIMIT
          ? text.slice(0, TITLE_FALLBACK_LIMIT) + '…'
          : text
      }
    }
  }
  const firstP = root.find('p').first()
  const text = firstP.text().trim()
  if (text) {
    return text.length > TITLE_FALLBACK_LIMIT
      ? text.slice(0, TITLE_FALLBACK_LIMIT) + '…'
      : text
  }
  return fallback
}

function splitByH1(html: string): string[] {
  const $ = cheerio.load(`<div id="root">${html}</div>`, null, false)
  const root = $('#root')
  const segs: string[] = []
  let buf: string[] = []
  let sawH1 = false
  root.children().each((_idx, elem) => {
    const tagName = $(elem).prop('tagName')?.toLowerCase()
    if (tagName === 'h1') {
      if (buf.length > 0) segs.push(buf.join(''))
      buf = [$.html(elem)]
      sawH1 = true
    } else {
      buf.push($.html(elem))
    }
  })
  if (buf.length > 0) segs.push(buf.join(''))
  return sawH1 ? segs : [html]
}

export async function parseRtf(
  buffer: Buffer,
  _ctx: ParserContext,
): Promise<ParserResult> {
  const warnings: ImportWarning[] = []
  const text = buffer.toString('utf8')

  if (!text.startsWith('{\\rtf')) {
    throw new Error('Not a valid RTF document (missing {\\rtf header)')
  }

  const paragraphs = extractText(text)
  if (paragraphs.length === 0) {
    warnings.push({
      code: 'EMPTY_DOCUMENT',
      message: 'No readable text found in the RTF document.',
    })
    return {
      segments: [{
        tempId: randomUUID(),
        suggestedTitle: 'Imported manuscript',
        html: '',
        wordCount: 0,
        firstLine: '',
      }],
      warnings,
      sourceFormat: 'rtf',
    }
  }

  warnings.push({
    code: 'FORMATTING_LOST',
    message: 'RTF imports preserve text and paragraph structure only; inline emphasis, images, fonts, and tables are dropped.',
  })

  const html = paragraphsToHtml(paragraphs)

  // Split on the synthetic <h1> chapter markers we inserted during emit.
  const rawSegments = splitByH1(html)
  if (rawSegments.length === 1) {
    warnings.push({
      code: 'STRUCTURE_GUESSED',
      message:
        'No chapter markers found — imported as a single chapter. Split it manually in the preview.',
    })
  }

  const segments: ImportSegment[] = []
  for (let i = 0; i < rawSegments.length; i++) {
    const segHtml = rawSegments[i]!
    const sanitized = sanitizeImportedHtml(segHtml)
    const $ = cheerio.load(`<div id="root">${sanitized}</div>`, null, false)
    const root = $('#root')
    const fullText = root.text()
    if (fullText.replace(/\s+/g, '').length === 0) continue
    const firstPara = root.find('p').filter((_idx, el) => $(el).text().trim().length > 0).first()
    const firstLineSource = firstPara.length > 0 ? firstPara.text() : fullText
    segments.push({
      tempId: randomUUID(),
      suggestedTitle: extractTitle(sanitized, `Chapter ${i + 1}`),
      html: sanitized,
      wordCount: countWordsFromText(fullText),
      firstLine: firstSnippet(firstLineSource),
    })
  }

  return { segments, warnings, sourceFormat: 'rtf' }
}
