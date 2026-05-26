/**
 * Portable Document Format (.pdf) manuscript parser.
 *
 * PDF is a layout format, not a content format — it has no concept of
 * paragraphs, chapters, or reading order beyond pixel positions. We do
 * the best we can with two heuristics:
 *
 *   1. Group text items into lines by Y position, then into paragraphs
 *      by vertical gap relative to the body line height.
 *   2. A line is a "chapter title" if its font size is at least 1.4× the
 *      body font size, OR it matches /^(chapter|prologue|epilogue|part|
 *      book)\b/i, AND the line is short (≤ 100 chars).
 *
 * Embedded images and any non-text drawing operations are dropped (pdfjs
 * doesn't surface them through getTextContent anyway). A persistent
 * FORMATTING_LOST warning tells the user PDF imports are lossy.
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
const CHAPTER_TITLE_MAX_CHARS = 100
const TITLE_FONT_RATIO = 1.4

interface PdfLine {
  text: string
  fontSize: number
  /** Y position (PDF user-space units, increasing upward) */
  y: number
  /** Page number (1-based) */
  page: number
}

interface PdfTextItem {
  str: string
  transform: number[]
  width: number
  height: number
  fontName: string
  hasEOL?: boolean
}

interface PdfTextContent {
  items: Array<PdfTextItem | { type: 'beginMarkedContent' | 'beginMarkedContentProps' | 'endMarkedContent' }>
}

interface PdfPage {
  getTextContent(): Promise<PdfTextContent>
}

interface PdfDocument {
  numPages: number
  getPage(n: number): Promise<PdfPage>
}

function isTextItem(item: unknown): item is PdfTextItem {
  return typeof item === 'object'
    && item !== null
    && 'str' in item
    && 'transform' in item
}

/** Group a page's items into lines by clustering on the Y coordinate. */
function itemsToLines(items: PdfTextItem[], pageNumber: number): PdfLine[] {
  if (items.length === 0) return []

  // PDF item transform = [a, b, c, d, e, f]; font height ≈ |d| (or |a| if d=0).
  // Y position is transform[5].
  type WorkingLine = { ys: number[]; texts: string[]; sizes: number[] }
  const lines: WorkingLine[] = []
  const Y_TOLERANCE = 2  // points

  for (const item of items) {
    const y = item.transform[5] ?? 0
    const size = Math.abs(item.transform[3] ?? 0) || Math.abs(item.transform[0] ?? 0) || 10
    const str = item.str ?? ''
    if (!str.trim() && !item.hasEOL) continue

    // Find an existing line within tolerance, or start a new one.
    let placed = false
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
      const line = lines[i]!
      const avgY = line.ys.reduce((s, n) => s + n, 0) / line.ys.length
      if (Math.abs(avgY - y) <= Y_TOLERANCE) {
        line.ys.push(y)
        line.texts.push(str)
        line.sizes.push(size)
        placed = true
        break
      }
    }
    if (!placed) {
      lines.push({ ys: [y], texts: [str], sizes: [size] })
    }
  }

  // Sort lines top-to-bottom (Y decreases as you move down on a PDF page).
  lines.sort((a, b) => {
    const ay = a.ys.reduce((s, n) => s + n, 0) / a.ys.length
    const by = b.ys.reduce((s, n) => s + n, 0) / b.ys.length
    return by - ay
  })

  return lines
    .map(line => ({
      text: line.texts.join('').replace(/\s+/g, ' ').trim(),
      fontSize: line.sizes.reduce((s, n) => s + n, 0) / line.sizes.length,
      y: line.ys.reduce((s, n) => s + n, 0) / line.ys.length,
      page: pageNumber,
    }))
    .filter(line => line.text.length > 0)
}

function modeFontSize(lines: PdfLine[]): number {
  if (lines.length === 0) return 10
  // Bin sizes to whole-number resolution to find the dominant body size.
  const bins = new Map<number, number>()
  for (const line of lines) {
    const k = Math.round(line.fontSize)
    bins.set(k, (bins.get(k) ?? 0) + line.text.length)  // weight by text length
  }
  let bestK = 10
  let bestN = 0
  for (const [k, n] of bins.entries()) {
    if (n > bestN) { bestK = k; bestN = n }
  }
  return bestK
}

function isTitleLine(line: PdfLine, bodySize: number): boolean {
  if (line.text.length > CHAPTER_TITLE_MAX_CHARS) return false
  if (line.fontSize >= bodySize * TITLE_FONT_RATIO) return true
  if (CHAPTER_HINT.test(line.text)) return true
  return false
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function linesToHtml(lines: PdfLine[], bodySize: number): string {
  const out: string[] = []
  let paragraphBuf: string[] = []
  let lastLine: PdfLine | null = null

  const flushParagraph = () => {
    if (paragraphBuf.length > 0) {
      out.push(`<p>${escapeHtml(paragraphBuf.join(' '))}</p>`)
      paragraphBuf = []
    }
  }

  for (const line of lines) {
    if (isTitleLine(line, bodySize)) {
      flushParagraph()
      out.push(`<h1>${escapeHtml(line.text)}</h1>`)
      lastLine = line
      continue
    }
    // Detect paragraph break by vertical gap larger than ~1.5 line-heights
    // OR by a page break.
    if (lastLine && (lastLine.page !== line.page || (lastLine.y - line.y) > bodySize * 1.8)) {
      flushParagraph()
    }
    paragraphBuf.push(line.text)
    lastLine = line
  }
  flushParagraph()
  return out.join('\n')
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

export async function parsePdf(
  buffer: Buffer,
  _ctx: ParserContext,
): Promise<ParserResult> {
  const warnings: ImportWarning[] = []

  // Use the legacy build — it's the Node-friendly entry point that bundles
  // the worker inline and doesn't require browser APIs. Plain `pdfjs-dist`
  // tries to spin up a Web Worker which fails outside a browser.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { getDocument } = pdfjs as { getDocument: (params: { data: Buffer | Uint8Array }) => { promise: Promise<PdfDocument> } }

  let pdf: PdfDocument
  try {
    const loadingTask = getDocument({ data: new Uint8Array(buffer) })
    pdf = await loadingTask.promise
  } catch (err) {
    throw new Error(`Could not read PDF: ${err instanceof Error ? err.message : 'unknown error'}`)
  }

  const allLines: PdfLine[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const content = await page.getTextContent()
    const items = content.items.filter(isTextItem)
    const lines = itemsToLines(items, n)
    allLines.push(...lines)
  }

  warnings.push({
    code: 'FORMATTING_LOST',
    message:
      'PDF imports are lossy: embedded images, complex layout, footnotes, and tables are dropped. Review each chapter and split where needed.',
  })

  if (allLines.length === 0) {
    warnings.push({
      code: 'EMPTY_DOCUMENT',
      message: 'No readable text found in the PDF.',
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
      sourceFormat: 'pdf',
    }
  }

  const bodySize = modeFontSize(allLines)
  const html = linesToHtml(allLines, bodySize)

  const rawSegments = splitByH1(html)
  if (rawSegments.length === 1) {
    warnings.push({
      code: 'STRUCTURE_GUESSED',
      message:
        'No chapter markers detected — imported as a single chapter. Use the preview to split manually.',
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

  if (segments.length === 0) {
    return {
      segments: [{
        tempId: randomUUID(),
        suggestedTitle: 'Imported manuscript',
        html: '',
        wordCount: 0,
        firstLine: '',
      }],
      warnings,
      sourceFormat: 'pdf',
    }
  }

  return { segments, warnings, sourceFormat: 'pdf' }
}
