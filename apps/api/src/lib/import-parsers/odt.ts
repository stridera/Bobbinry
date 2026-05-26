/**
 * OpenDocument Text (.odt) manuscript parser.
 *
 * Unzips the package, walks content.xml with fast-xml-parser (preserveOrder
 * so interleaved text:p / text:h / soft-page-break elements stay in document
 * order), and emits a Tiptap-safe HTML subset. Splits primarily on
 * <text:soft-page-break/> markers (LibreOffice's automatic pagination) and
 * falls back to top-level <h1> headings when no page breaks exist.
 *
 * Inline styling (bold/italic/etc.) is dropped in v1 — preserving it
 * requires resolving text:span style-name references against styles.xml,
 * which is significantly more work than the rest of the parser combined.
 * The wizard's warnings banner surfaces this so users know to re-check.
 *
 * Embedded images in the Pictures/ folder are uploaded to S3 through the
 * shared images helper, with <img src> rewritten before sanitization.
 */

import { randomUUID } from 'crypto'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import * as cheerio from 'cheerio'
import type {
  ImportSegment,
  ImportWarning,
  ParserContext,
  ParserResult,
} from './index'
import { sanitizeImportedHtml } from './sanitize'
import { uploadImportImage } from './images'
import { assertSafeZip } from './zip-safe'

const PAGE_BREAK_MARKER = '☃___bbnr_odt_pb___☃'
const FIRST_LINE_LIMIT = 140
const TITLE_FALLBACK_LIMIT = 80

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  parseAttributeValue: false,
  trimValues: false,
})

interface ImageRef {
  zipPath: string
  alt: string
}

type XmlNode = Record<string, unknown>

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;')
}

function tagOf(node: XmlNode): string | null {
  for (const key of Object.keys(node)) {
    if (key !== ':@') return key
  }
  return null
}

function attrsOf(node: XmlNode): Record<string, string> {
  const raw = node[':@']
  return (raw && typeof raw === 'object' ? raw : {}) as Record<string, string>
}

function asNodeArray(value: unknown): XmlNode[] {
  if (!Array.isArray(value)) return []
  return value as XmlNode[]
}

/** Walk parsed XML to find office:document-content > office:body > office:text. */
function findOfficeText(parsed: XmlNode[]): XmlNode[] {
  for (const top of parsed) {
    const docContent = top['office:document-content']
    if (!Array.isArray(docContent)) continue
    for (const child of docContent as XmlNode[]) {
      const body = child['office:body']
      if (!Array.isArray(body)) continue
      for (const inner of body as XmlNode[]) {
        const text = inner['office:text']
        if (Array.isArray(text)) return text as XmlNode[]
      }
    }
  }
  return []
}

class EmitContext {
  images: Map<string, ImageRef> = new Map()

  /** Register an image href and return a placeholder string the emitter
   *  embeds in the rendered HTML. The caller does an async pass after
   *  emission to swap placeholders for uploaded URLs. */
  reserveImage(href: string, alt: string): string {
    const placeholder = `__bbnr_odt_img_${this.images.size}__`
    this.images.set(placeholder, { zipPath: href, alt })
    return placeholder
  }
}

function emitNode(node: XmlNode, ctx: EmitContext): string {
  const tag = tagOf(node)
  if (!tag) return ''
  const children = asNodeArray(node[tag])

  if (tag === '#text') {
    // `node[tag]` for #text is the raw string (preserveOrder shape).
    const raw = (node['#text'] ?? '') as string
    return escapeHtml(String(raw))
  }

  const attrs = attrsOf(node)

  switch (tag) {
    case 'text:p':
      return `<p>${emitChildren(children, ctx)}</p>`

    case 'text:h': {
      const levelRaw = attrs['@_text:outline-level'] ?? '1'
      const level = Math.min(Math.max(parseInt(levelRaw, 10) || 1, 1), 6)
      return `<h${level}>${emitChildren(children, ctx)}</h${level}>`
    }

    case 'text:soft-page-break':
      return PAGE_BREAK_MARKER

    case 'text:line-break':
      return '<br/>'

    case 'text:tab':
      return '    '

    case 'text:s': {
      // text:s c="N" → N spaces
      const count = parseInt(attrs['@_text:c'] ?? '1', 10) || 1
      return ' '.repeat(count)
    }

    case 'text:list':
      return `<ul>${emitChildren(children, ctx)}</ul>`

    case 'text:list-item':
      return `<li>${emitChildren(children, ctx)}</li>`

    case 'text:a': {
      const href = attrs['@_xlink:href'] ?? ''
      return `<a href="${escapeAttr(href)}">${emitChildren(children, ctx)}</a>`
    }

    case 'text:span':
      // Drop inline styling for v1; emit children inline.
      return emitChildren(children, ctx)

    case 'draw:frame':
      // Unwrap; the <draw:image> inside emits the actual <img>.
      return emitChildren(children, ctx)

    case 'draw:image': {
      const href = attrs['@_xlink:href'] ?? ''
      if (!href) return ''
      const placeholder = ctx.reserveImage(href, '')
      return `<img src="${escapeAttr(placeholder)}" alt=""/>`
    }

    case 'table:table':
      // Drop tables for v1 — Tiptap's starter kit doesn't render them
      // without the @tiptap/extension-table plugin, which manuscript
      // doesn't load. Keep the cell text so content isn't lost.
      return `<p>${emitChildren(children, ctx)}</p>`

    case 'table:table-row':
    case 'table:table-cell':
      return emitChildren(children, ctx) + ' '

    default:
      // Unknown / structural tag: emit children, drop the wrapper.
      return emitChildren(children, ctx)
  }
}

function emitChildren(children: XmlNode[], ctx: EmitContext): string {
  return children.map(c => emitNode(c, ctx)).join('')
}

async function rewriteImages(
  html: string,
  ctx: EmitContext,
  zip: JSZip,
  parseCtx: ParserContext,
  imageErrors: string[],
): Promise<string> {
  let out = html
  for (const [placeholder, ref] of ctx.images.entries()) {
    const file = zip.file(ref.zipPath)
    if (!file) {
      imageErrors.push(`Image not found in archive: ${ref.zipPath}`)
      out = out.split(placeholder).join('')
      continue
    }
    let buffer: Buffer
    try {
      buffer = await file.async('nodebuffer')
    } catch (err) {
      imageErrors.push(`Could not read image '${ref.zipPath}': ${err instanceof Error ? err.message : 'unknown'}`)
      out = out.split(placeholder).join('')
      continue
    }
    // Sniff the MIME from the file extension since ODT doesn't carry it.
    const mime = mimeFromName(ref.zipPath)
    const { url, warning } = await uploadImportImage(buffer, mime, parseCtx)
    if (warning) imageErrors.push(warning)
    if (!url) {
      out = out.split(placeholder).join('')
      continue
    }
    out = out.split(placeholder).join(url)
  }
  return out
}

function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    default: return 'application/octet-stream'
  }
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
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
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

function splitByMarker(html: string): string[] {
  const parts = html.split(PAGE_BREAK_MARKER)
  return parts.map(p => p.trim()).filter(p => p.length > 0)
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

export async function parseOdt(
  buffer: Buffer,
  ctx: ParserContext,
): Promise<ParserResult> {
  const warnings: ImportWarning[] = []
  const imageErrors: string[] = []

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch (err) {
    throw new Error(`Not a valid ODT archive: ${err instanceof Error ? err.message : 'unknown'}`)
  }

  assertSafeZip(zip)

  const contentEntry = zip.file('content.xml')
  if (!contentEntry) throw new Error('ODT is missing content.xml')
  const contentXmlText = await contentEntry.async('string')
  const parsed = xml.parse(contentXmlText) as XmlNode[]

  const officeText = findOfficeText(parsed)
  if (officeText.length === 0) {
    warnings.push({
      code: 'EMPTY_DOCUMENT',
      message: 'ODT document body is empty.',
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
      sourceFormat: 'odt',
    }
  }

  const emitCtx = new EmitContext()
  const rawHtml = emitChildren(officeText, emitCtx)
  const htmlWithImages = await rewriteImages(rawHtml, emitCtx, zip, ctx, imageErrors)

  if (imageErrors.length > 0) {
    warnings.push({
      code: 'IMAGE_FAILED',
      message: `${imageErrors.length} embedded image${imageErrors.length === 1 ? '' : 's'} could not be imported.`,
      detail: imageErrors.slice(0, 3).join(' · '),
    })
  }

  warnings.push({
    code: 'FORMATTING_LOST',
    message: 'Inline emphasis (bold, italic) is not preserved from ODT in this build.',
  })

  // First split by soft page breaks. If exactly one chunk, try H1.
  let rawSegments = splitByMarker(htmlWithImages)
  if (rawSegments.length <= 1) {
    rawSegments = splitByH1(rawSegments[0] ?? htmlWithImages)
    if (rawSegments.length === 1) {
      warnings.push({
        code: 'STRUCTURE_GUESSED',
        message:
          'No page breaks or top-level headings found — imported as a single chapter. Split it manually in the preview.',
      })
    }
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
    warnings.push({
      code: 'EMPTY_DOCUMENT',
      message: 'No readable text found in the ODT.',
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
      sourceFormat: 'odt',
    }
  }

  return { segments, warnings, sourceFormat: 'odt' }
}
