/**
 * Microsoft Word (.docx) manuscript parser.
 *
 * Uses `mammoth` for OOXML → HTML conversion, then splits the result on
 * explicit page breaks (`<w:br w:type="page"/>`). If the document has no
 * page breaks, the parser falls back to splitting on top-level `<h1>`
 * headings — most Word manuscripts use the "Heading 1" style for chapter
 * titles without ever inserting a page break, and a single-segment fallback
 * would be a poor experience.
 *
 * Embedded images are extracted via mammoth's `convertImage` hook, uploaded
 * to S3 by the shared image helper, and the `<img src>` rewritten in place
 * before the HTML is sanitized.
 *
 * Soft page breaks (Word's automatic pagination markers) are ignored on
 * purpose — they are layout-dependent and unreliable.
 */

import { randomUUID } from 'crypto'
import mammoth from 'mammoth'
import * as cheerio from 'cheerio'
import type {
  ImportSegment,
  ImportWarning,
  ParserContext,
  ParserResult,
} from './index'
import { sanitizeImportedHtml } from './sanitize'
import { uploadImportImage } from './images'

const PAGE_BREAK_MARKER = '☃___bbnr_pb_marker___☃'
const FIRST_LINE_LIMIT = 140
const TITLE_FALLBACK_LIMIT = 80

interface DocxParaNode {
  type: string
  children?: DocxParaNode[]
  styleId?: string | null
  styleName?: string | null
  numbering?: unknown
  alignment?: unknown
  value?: string
  breakType?: string
}

function hasExplicitPageBreak(paragraph: DocxParaNode): boolean {
  if (!Array.isArray(paragraph.children)) return false
  return paragraph.children.some(child =>
    child.type === 'run'
    && Array.isArray(child.children)
    && child.children.some(grand =>
      grand.type === 'break' && grand.breakType === 'page'
    )
  )
}

function injectPageBreakMarker(paragraph: DocxParaNode): DocxParaNode {
  return {
    ...paragraph,
    children: [
      {
        type: 'run',
        children: [{ type: 'text', value: PAGE_BREAK_MARKER }],
      },
      ...(paragraph.children ?? []),
    ],
  }
}

function countWordsFromText(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length
}

function firstSnippet(text: string, limit = FIRST_LINE_LIMIT): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length > limit ? trimmed.slice(0, limit) + '…' : trimmed
}

function extractTitle(html: string, fallback: string): string {
  const $ = cheerio.load(`<div id="root">${html}</div>`, null, false)
  const root = $('#root')

  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const el = root.find(tag).first()
    if (el.length > 0) {
      const text = el.text().trim()
      if (text) return text.length > TITLE_FALLBACK_LIMIT
        ? text.slice(0, TITLE_FALLBACK_LIMIT) + '…'
        : text
    }
  }

  const firstP = root.find('p').first()
  if (firstP.length > 0) {
    const text = firstP.text().trim()
    if (text) return text.length > TITLE_FALLBACK_LIMIT
      ? text.slice(0, TITLE_FALLBACK_LIMIT) + '…'
      : text
  }

  return fallback
}

/** Split rendered HTML on the page-break markers we injected via transformDocument. */
function splitByMarker(html: string): string[] {
  const $ = cheerio.load(`<div id="root">${html}</div>`, null, false)
  const root = $('#root')

  const segmentHtmls: string[] = []
  let current: string[] = []

  root.children().each((_idx, elem) => {
    const $elem = $(elem)
    const text = $elem.text()
    if (text.includes(PAGE_BREAK_MARKER)) {
      if (current.length > 0) segmentHtmls.push(current.join(''))
      const cleanedInner = ($elem.html() ?? '').split(PAGE_BREAK_MARKER).join('').trim()
      // Marker paragraphs are usually empty after stripping (the original
      // paragraph existed only to carry the page break). Drop them; if the
      // paragraph happens to also carry real content, keep it.
      if (cleanedInner.length === 0) {
        current = []
      } else {
        $elem.html(cleanedInner)
        current = [$.html(elem)]
      }
    } else {
      current.push($.html(elem))
    }
  })

  if (current.length > 0) segmentHtmls.push(current.join(''))
  return segmentHtmls
}

/** Split a single HTML chunk on top-level <h1> elements. */
function splitByH1(html: string): string[] {
  const $ = cheerio.load(`<div id="root">${html}</div>`, null, false)
  const root = $('#root')

  const segmentHtmls: string[] = []
  let current: string[] = []
  let sawH1 = false

  root.children().each((_idx, elem) => {
    const tag = $(elem).prop('tagName')?.toLowerCase()
    if (tag === 'h1') {
      if (current.length > 0) segmentHtmls.push(current.join(''))
      current = [$.html(elem)]
      sawH1 = true
    } else {
      current.push($.html(elem))
    }
  })

  if (current.length > 0) segmentHtmls.push(current.join(''))
  return sawH1 ? segmentHtmls : [html]
}

function stripEmpty(htmls: string[]): string[] {
  return htmls.filter(h => h.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length > 0)
}

export async function parseDocx(
  buffer: Buffer,
  ctx: ParserContext,
): Promise<ParserResult> {
  const warnings: ImportWarning[] = []
  const imageErrors: string[] = []

  // Mammoth's TS types don't expose `transforms` directly; cast around it.
  const mammothAny = mammoth as unknown as {
    transforms: {
      paragraph: (fn: (p: DocxParaNode) => DocxParaNode) => unknown
    }
    images: { imgElement: (fn: (image: MammothImage) => Promise<{ src: string; alt?: string }>) => unknown }
  }

  const transformDocument = mammothAny.transforms.paragraph((para) => {
    if (hasExplicitPageBreak(para)) return injectPageBreakMarker(para)
    return para
  })

  interface MammothImage {
    contentType: string
    altText?: string
    read: (encoding: 'base64') => Promise<string>
  }

  const convertImage = mammothAny.images.imgElement(async (image: MammothImage) => {
    try {
      const b64 = await image.read('base64')
      const buf = Buffer.from(b64, 'base64')
      const { url, warning } = await uploadImportImage(buf, image.contentType, ctx)
      if (warning) imageErrors.push(warning)
      if (!url) {
        return { src: '', alt: image.altText || '[image]' }
      }
      return { src: url, alt: image.altText || '' }
    } catch (err) {
      imageErrors.push(err instanceof Error ? err.message : 'unknown image error')
      return { src: '', alt: image.altText || '[image]' }
    }
  })

  let html: string
  try {
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        transformDocument: transformDocument as never,
        convertImage: convertImage as never,
      },
    )
    html = result.value
  } catch (err) {
    throw new Error(`Word document could not be read: ${err instanceof Error ? err.message : 'unknown error'}`)
  }

  if (imageErrors.length > 0) {
    warnings.push({
      code: 'IMAGE_FAILED',
      message: `${imageErrors.length} embedded image${imageErrors.length === 1 ? '' : 's'} could not be imported.`,
      detail: imageErrors.slice(0, 3).join(' · '),
    })
  }

  if (!html.trim()) {
    warnings.push({
      code: 'EMPTY_DOCUMENT',
      message: 'The document appeared empty after parsing.',
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
      sourceFormat: 'docx',
    }
  }

  // First split by explicit page breaks. If exactly one chunk results, try H1.
  let rawSegments = stripEmpty(splitByMarker(html))
  if (rawSegments.length <= 1) {
    rawSegments = stripEmpty(splitByH1(rawSegments[0] ?? html))
    if (rawSegments.length === 1) {
      warnings.push({
        code: 'STRUCTURE_GUESSED',
        message:
          'No page breaks or top-level headings found — imported as a single chapter. Split it manually in the preview.',
      })
    }
  }

  const segments: ImportSegment[] = rawSegments.map((segHtml, i) => {
    const sanitized = sanitizeImportedHtml(segHtml)
    const $ = cheerio.load(`<div id="root">${sanitized}</div>`, null, false)
    const root = $('#root')
    // Word count: full text content.
    const plainAll = root.text()
    // First line: first non-heading paragraph, so the snippet isn't a
    // concatenation of "Chapter 1: TitleFirst paragraph text..."
    const firstP = root.find('p').filter((_idx, el) => $(el).text().trim().length > 0).first()
    const firstLineSource = firstP.length > 0 ? firstP.text() : plainAll
    return {
      tempId: randomUUID(),
      suggestedTitle: extractTitle(sanitized, `Chapter ${i + 1}`),
      html: sanitized,
      wordCount: countWordsFromText(plainAll),
      firstLine: firstSnippet(firstLineSource),
    }
  })

  return { segments, warnings, sourceFormat: 'docx' }
}
