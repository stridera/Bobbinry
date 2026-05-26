/**
 * Plain-text manuscript parser.
 *
 * Splits the file on lines that look like chapter markers (Chapter / Prologue
 * / Epilogue / Part / Book + optional number). Blank-line-separated runs of
 * non-empty lines become <p> elements. If no markers are found, the whole
 * file becomes a single segment and the caller gets a STRUCTURE_GUESSED
 * warning so the UI can suggest the user splits manually.
 */

import { randomUUID } from 'crypto'
import type {
  ImportSegment,
  ImportWarning,
  ParserContext,
  ParserResult,
} from './index'
import { sanitizeImportedHtml } from './sanitize'

const CHAPTER_PATTERN = /^\s*(chapter|prologue|epilogue|part|book)\b.*$/i
const FIRST_LINE_LIMIT = 140

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function paragraphize(bodyLines: string[]): string {
  const paragraphs: string[] = []
  let buf: string[] = []
  for (const raw of bodyLines) {
    if (raw.trim() === '') {
      if (buf.length) {
        paragraphs.push(buf.join(' '))
        buf = []
      }
    } else {
      buf.push(raw.trim())
    }
  }
  if (buf.length) paragraphs.push(buf.join(' '))
  return paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('\n')
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length
}

function firstNonEmptyLine(lines: string[]): string {
  for (const l of lines) {
    const trimmed = l.trim()
    if (trimmed.length === 0) continue
    return trimmed.length > FIRST_LINE_LIMIT
      ? trimmed.slice(0, FIRST_LINE_LIMIT) + '…'
      : trimmed
  }
  return ''
}

export async function parseTxt(
  buffer: Buffer,
  _ctx: ParserContext,
): Promise<ParserResult> {
  const warnings: ImportWarning[] = []

  let text = buffer.toString('utf8')
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1) // strip BOM
  text = text.replace(/\r\n?/g, '\n')

  const lines = text.split('\n')
  const markers: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (CHAPTER_PATTERN.test(lines[i] ?? '')) markers.push(i)
  }

  if (markers.length === 0) {
    const html = sanitizeImportedHtml(paragraphize(lines))
    const wordCount = countWords(text)
    if (wordCount === 0) {
      warnings.push({
        code: 'EMPTY_DOCUMENT',
        message: 'The file appeared empty after parsing.',
      })
    } else {
      warnings.push({
        code: 'STRUCTURE_GUESSED',
        message:
          'No chapter markers found — imported as a single chapter. Split it manually in the preview.',
      })
    }
    return {
      segments: [{
        tempId: randomUUID(),
        suggestedTitle: 'Imported manuscript',
        html,
        wordCount,
        firstLine: firstNonEmptyLine(lines),
      }],
      warnings,
      sourceFormat: 'txt',
    }
  }

  const segments: ImportSegment[] = []
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i]!
    const end = i + 1 < markers.length ? markers[i + 1]! : lines.length
    const titleLine = (lines[start] ?? '').trim()
    const bodyLines = lines.slice(start + 1, end)
    const html = sanitizeImportedHtml(paragraphize(bodyLines))
    segments.push({
      tempId: randomUUID(),
      suggestedTitle: titleLine || `Chapter ${i + 1}`,
      html,
      wordCount: countWords(bodyLines.join(' ')),
      firstLine: firstNonEmptyLine(bodyLines),
    })
  }

  // Leading prose before the first marker → prepend a "Prelude" segment.
  if (markers[0]! > 0) {
    const preludeLines = lines.slice(0, markers[0]!)
    if (preludeLines.some(l => l.trim().length > 0)) {
      const html = sanitizeImportedHtml(paragraphize(preludeLines))
      segments.unshift({
        tempId: randomUUID(),
        suggestedTitle: 'Prelude',
        html,
        wordCount: countWords(preludeLines.join(' ')),
        firstLine: firstNonEmptyLine(preludeLines),
      })
    }
  }

  return { segments, warnings, sourceFormat: 'txt' }
}
