/**
 * Microsoft Word (.docx) manuscript parser.
 *
 * Splitting strategy is a four-stage cascade, in decreasing order of
 * reliability:
 *
 *   1. **OOXML pre-pass.** Before handing the buffer to mammoth, we
 *      unzip the package, walk `word/document.xml`, and record the text
 *      content of every paragraph that has either `<w:pageBreakBefore/>`
 *      in its `<w:pPr>` or a `<w:br w:type="page"/>` in its descendants.
 *      Mammoth strips both signals silently, so we have to read them
 *      ourselves. After mammoth runs, we find those paragraphs in the
 *      rendered HTML by text-content matching and inject a sentinel.
 *
 *   2. Top-level `<h1>` headings. Many manuscripts use Word's "Heading 1"
 *      style for chapter titles without inserting any page break.
 *
 *   3. Chapter-keyword text pattern. A `<p>` whose text matches
 *      /^(chapter|prologue|epilogue|part|book)\b/ and is ≤ 80 chars.
 *      Catches docs that label chapters in plain bold text and use no
 *      heading styles.
 *
 *   4. Single segment with a STRUCTURE_GUESSED warning.
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
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import * as cheerio from 'cheerio'
import type {
  ImportSegment,
  ImportWarning,
  ParserContext,
  ParserResult,
} from './index'
import { sanitizeImportedHtml } from '../sanitize-html'
import { uploadImportImage } from './images'

const PAGE_BREAK_MARKER = '☃___bbnr_pb_marker___☃'
// Alignment markers carry the value inline (`center`, `right`, `justify`).
// transformDocument prepends one of these as a text run into each non-left
// paragraph; a cheerio post-pass strips it and writes a `text-align` inline
// style on the rendered <p> / <h*>. Left-aligned paragraphs are untouched
// because that's the editor default.
const ALIGN_MARKER_RE = /☃___bbnr_align___([a-z]+)___☃/
const FIRST_LINE_LIMIT = 140
const TITLE_FALLBACK_LIMIT = 80
const CHAPTER_PARAGRAPH_RE = /^(chapter|prologue|epilogue|part|book)\b/i
const CHAPTER_PARAGRAPH_MAX_LEN = 80
const MATCH_PREFIX_LEN = 80
const SUBTITLE_MAX_LEN = 120
const TITLE_SEPARATOR = ' — '
const INLINE_WRAPPER_TAGS = new Set(['strong', 'em', 'u', 's', 'b', 'i'])

const ooxmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  parseAttributeValue: false,
  trimValues: false,
})

type XmlNode = Record<string, unknown>

function isObject(value: unknown): value is XmlNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Walk a preserveOrder XML tree, invoking `visit` for each `<w:p>` in
 *  document order. Recurses into the visited paragraph's children too so
 *  nested paragraphs (text boxes, footnotes) are reached — mammoth walks
 *  the same tree depth-first so this matches its ordering. */
function walkParagraphs(node: unknown, visit: (paraChildren: unknown[]) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkParagraphs(item, visit)
    return
  }
  if (!isObject(node)) return
  for (const [key, value] of Object.entries(node)) {
    if (key === ':@') continue
    if (key === 'w:p' && Array.isArray(value)) {
      visit(value)
      walkParagraphs(value, visit)
    } else {
      walkParagraphs(value, visit)
    }
  }
}

function paragraphHasPageBreakBefore(paraChildren: unknown[]): boolean {
  for (const child of paraChildren) {
    if (!isObject(child)) continue
    const pPr = child['w:pPr']
    if (!Array.isArray(pPr)) continue
    for (const pPrItem of pPr) {
      if (isObject(pPrItem) && 'w:pageBreakBefore' in pPrItem) {
        return true
      }
    }
  }
  return false
}

function paragraphHasExplicitBreak(paraChildren: unknown[]): boolean {
  function find(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(find)
    if (!isObject(value)) return false
    for (const [key, val] of Object.entries(value)) {
      if (key === ':@') continue
      if (key === 'w:br') {
        const items = Array.isArray(val) ? val : [val]
        for (const item of items) {
          if (!isObject(item)) continue
          const attrs = item[':@']
          if (isObject(attrs) && attrs['@_w:type'] === 'page') return true
        }
      }
      if (find(val)) return true
    }
    return false
  }
  return find(paraChildren)
}

function extractParagraphText(paraChildren: unknown[]): string {
  let out = ''
  function walk(value: unknown): void {
    if (typeof value === 'string') {
      out += value
      return
    }
    if (Array.isArray(value)) {
      for (const v of value) walk(v)
      return
    }
    if (!isObject(value)) return
    if ('#text' in value) {
      out += String(value['#text'] ?? '')
      return
    }
    for (const [key, val] of Object.entries(value)) {
      if (key === ':@') continue
      walk(val)
    }
  }
  walk(paraChildren)
  return out
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Pre-pass: walk the raw OOXML, gather paragraph metadata in document order,
 *  and return text snippets we can use to locate each break in the rendered
 *  HTML. If a break paragraph has no text of its own (the common Word idiom
 *  of an empty paragraph with pageBreakBefore set, followed by the chapter
 *  title in the next paragraph), the snippet falls through to the next
 *  non-empty paragraph since semantically the break belongs to that chapter. */
async function findPageBreakParagraphTexts(buffer: Buffer): Promise<string[]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    return []
  }
  const file = zip.file('word/document.xml')
  if (!file) return []
  const xmlText = await file.async('string')

  let parsed: unknown
  try {
    parsed = ooxmlParser.parse(xmlText)
  } catch {
    return []
  }

  const tuples: Array<{ hasBreak: boolean; text: string }> = []
  walkParagraphs(parsed, (paraChildren) => {
    const hasBreak =
      paragraphHasPageBreakBefore(paraChildren)
      || paragraphHasExplicitBreak(paraChildren)
    const text = normalizeWhitespace(extractParagraphText(paraChildren))
    tuples.push({ hasBreak, text })
  })

  const result: string[] = []
  for (let i = 0; i < tuples.length; i++) {
    if (!tuples[i]!.hasBreak) continue
    let snippet = tuples[i]!.text
    if (snippet.length === 0) {
      // Walk forward to the next non-empty paragraph.
      for (let j = i + 1; j < tuples.length; j++) {
        if (tuples[j]!.text.length > 0) {
          snippet = tuples[j]!.text
          break
        }
      }
    }
    if (snippet.length > 0) result.push(snippet)
  }
  return result
}

/** Inject the page-break sentinel into every paragraph in the rendered HTML
 *  whose text matches one of the pre-pass break texts, in document order.
 *  Each break is matched at most once and the search advances monotonically
 *  so repeated chapter titles ("Chapter One" appearing twice) don't double-fire. */
function injectMarkersByText(html: string, breakTexts: string[]): { html: string; matched: number } {
  if (breakTexts.length === 0) return { html, matched: 0 }

  const $ = cheerio.load(`<div id="root">${html}</div>`, null, false)
  const root = $('#root')
  const candidates = root.find('p, h1, h2, h3, h4, h5, h6').toArray()

  let cursor = 0
  let matched = 0
  for (const target of breakTexts) {
    const normalizedTarget = normalizeWhitespace(target)
    if (normalizedTarget.length === 0) continue
    const useExact = normalizedTarget.length <= MATCH_PREFIX_LEN
    const targetKey = normalizedTarget.slice(0, MATCH_PREFIX_LEN)

    let found = -1
    for (let i = cursor; i < candidates.length; i++) {
      const elem = candidates[i]!
      const elemText = normalizeWhitespace($(elem).text())
      if (elemText.length === 0) continue
      const ok = useExact
        ? elemText === normalizedTarget
        : elemText.startsWith(targetKey)
      if (ok) {
        found = i
        break
      }
    }
    if (found === -1) continue

    const target$ = $(candidates[found]!)
    const inner = target$.html() ?? ''
    target$.html(PAGE_BREAK_MARKER + inner)
    cursor = found + 1
    matched += 1
  }

  return { html: root.html() ?? html, matched }
}

function countWordsFromText(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length
}

function firstSnippet(text: string, limit = FIRST_LINE_LIMIT): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length > limit ? trimmed.slice(0, limit) + '…' : trimmed
}

function clampTitle(text: string): string {
  return text.length > TITLE_FALLBACK_LIMIT
    ? text.slice(0, TITLE_FALLBACK_LIMIT) + '…'
    : text
}

/** Extract `style="text-align:X"` from a paragraph, or null if unset. */
function paragraphAlignment($p: ReturnType<cheerio.CheerioAPI>): string | null {
  const style = $p.attr('style') ?? ''
  const m = style.match(/text-align:\s*([a-z]+)/i)
  return m ? m[1]!.toLowerCase() : null
}

/** Returns the lowercased inline-formatting tag name if the paragraph's
 *  meaningful content is wrapped entirely in exactly one such tag (e.g.
 *  `<p><strong>...</strong></p>`). Mixed content returns null. */
function paragraphInlineWrapper(
  $p: ReturnType<cheerio.CheerioAPI>,
  $: cheerio.CheerioAPI,
): string | null {
  const meaningful = $p.contents().filter((_idx, n) => {
    if (n.type === 'text') return ($(n).text() ?? '').trim().length > 0
    return n.type === 'tag'
  })
  if (meaningful.length !== 1) return null
  const child = meaningful[0]
  if (!child || child.type !== 'tag') return null
  const tag = (child as unknown as { tagName?: string }).tagName?.toLowerCase()
  if (!tag || !INLINE_WRAPPER_TAGS.has(tag)) return null
  return tag
}

interface TitleDetection {
  /** Default display title with em-dash separator. The wizard can re-derive
   *  using `structure` if the user picks a different separator. */
  title: string
  /** Structured detection metadata. Present whenever the title came from a
   *  heading or a recognizable chapter-marker paragraph. Absent when we
   *  fell back to "first <p>" because the paragraph is real body content
   *  the user shouldn't be able to strip. */
  structure?: {
    label: string
    subtitle?: string
  }
  /** Body HTML with the title source paragraphs (heading, chapter marker,
   *  combined subtitle) removed. Surrounding empty paragraphs are kept so
   *  vertical spacing survives. Only present when `structure` is set. */
  htmlWithoutTitle?: string
}

function extractTitleAndBody(html: string, fallback: string): TitleDetection {
  const $ = cheerio.load(`<div id="root">${html}</div>`, null, false)
  const root = $('#root')

  // Heading → most reliable signal. Strip the heading element from the body
  // since the title field will hold it; users who want it as part of the
  // body too can toggle that off in the wizard.
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const $h = root.find(tag).first()
    if ($h.length > 0) {
      const text = $h.text().trim()
      if (text) {
        const clamped = clampTitle(text)
        $h.remove()
        return {
          title: clamped,
          structure: { label: text },
          htmlWithoutTitle: root.html() ?? html,
        }
      }
    }
  }

  // Empty paragraphs are now preserved as vertical spacing, so the first
  // <p> in a segment is often blank. Walk forward until we find one with text.
  const paragraphs = root.find('p')
  let titleIdx = -1
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs.eq(i).text().trim().length > 0) {
      titleIdx = i
      break
    }
  }
  if (titleIdx === -1) return { title: fallback }

  const $title = paragraphs.eq(titleIdx)
  const titleText = $title.text().trim()

  // Chapter-marker paragraph: maybe combine with the next paragraph as a
  // subtitle. Strict match — both alignment and inline wrapper must align,
  // and the subtitle must be short and not itself another chapter marker.
  if (titleText.length <= CHAPTER_PARAGRAPH_MAX_LEN && CHAPTER_PARAGRAPH_RE.test(titleText)) {
    let subText: string | null = null
    let subIdx = -1
    for (let i = titleIdx + 1; i < paragraphs.length; i++) {
      const $sub = paragraphs.eq(i)
      const candidate = $sub.text().trim()
      if (candidate.length === 0) continue
      // First non-empty after the title decides — don't peek further.
      if (candidate.length > SUBTITLE_MAX_LEN) break
      if (CHAPTER_PARAGRAPH_RE.test(candidate)) break
      if (paragraphAlignment($title) !== paragraphAlignment($sub)) break
      const wrap = paragraphInlineWrapper($title, $)
      if (wrap === null || wrap !== paragraphInlineWrapper($sub, $)) break
      subText = candidate
      subIdx = i
      break
    }

    if (subText !== null && subIdx >= 0) {
      const combined = clampTitle(`${titleText}${TITLE_SEPARATOR}${subText}`)
      paragraphs.eq(subIdx).remove()
      $title.remove()
      return {
        title: combined,
        structure: { label: titleText, subtitle: subText },
        htmlWithoutTitle: root.html() ?? html,
      }
    }

    // Chapter marker alone, no subtitle.
    $title.remove()
    return {
      title: clampTitle(titleText),
      structure: { label: titleText },
      htmlWithoutTitle: root.html() ?? html,
    }
  }

  // First non-empty <p> doesn't look like a chapter marker — treat its text
  // as the title but DON'T strip it from the body. It's real content the
  // user probably wants kept; the wizard hides the strip toggle when
  // structure is absent.
  return { title: clampTitle(titleText) }
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

/** Split on paragraphs whose text content matches a chapter-keyword pattern.
 *
 * This is the last-resort fallback for documents that paginate via
 * `<w:pageBreakBefore/>` (which mammoth strips silently) and use no
 * heading styles — many manuscripts ship that way, with chapter starts
 * labeled in plain bold text like `<p><strong>Chapter One</strong></p>`.
 */
function splitByChapterParagraphs(html: string): string[] {
  const $ = cheerio.load(`<div id="root">${html}</div>`, null, false)
  const root = $('#root')

  const segmentHtmls: string[] = []
  let current: string[] = []
  let sawMarker = false

  root.children().each((_idx, elem) => {
    const tagName = $(elem).prop('tagName')?.toLowerCase()
    if (tagName === 'p') {
      const text = $(elem).text().trim()
      if (text.length > 0 && text.length <= CHAPTER_PARAGRAPH_MAX_LEN && CHAPTER_PARAGRAPH_RE.test(text)) {
        if (current.length > 0) segmentHtmls.push(current.join(''))
        current = [$.html(elem)]
        sawMarker = true
        return
      }
    }
    current.push($.html(elem))
  })

  if (current.length > 0) segmentHtmls.push(current.join(''))
  return sawMarker ? segmentHtmls : [html]
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

/** Strip alignment markers injected via transformDocument and translate them
 *  into a `text-align` inline style on the enclosing block element. */
function applyAlignmentMarkers(html: string): string {
  if (!html.includes('___bbnr_align___')) return html
  const $ = cheerio.load(`<div id="root">${html}</div>`, null, false)
  $('p, h1, h2, h3, h4, h5, h6').each((_idx, elem) => {
    const $el = $(elem)
    const inner = $el.html() ?? ''
    const match = inner.match(ALIGN_MARKER_RE)
    if (!match) return
    const alignment = match[1]!
    const cleaned = inner.replace(ALIGN_MARKER_RE, '').replace(/^\s+/, '')
    $el.html(cleaned)
    const existing = ($el.attr('style') ?? '')
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.toLowerCase().startsWith('text-align'))
    existing.push(`text-align: ${alignment}`)
    $el.attr('style', existing.join('; '))
  })
  return $('#root').html() ?? html
}

export async function parseDocx(
  buffer: Buffer,
  ctx: ParserContext,
): Promise<ParserResult> {
  const warnings: ImportWarning[] = []
  const imageErrors: string[] = []

  // Pre-pass: read the raw OOXML to find paragraphs that carry a page break
  // (pageBreakBefore property OR <w:br w:type="page"/>). Mammoth strips both
  // signals silently, so we have to recover them ourselves and re-inject a
  // marker into the rendered HTML after mammoth runs.
  const breakTexts = await findPageBreakParagraphTexts(buffer)

  // Mammoth's TS types don't expose `images.imgElement` or `transforms`
  // cleanly. The cast surfaces both for the alignment + image-rewrite work.
  interface MammothImage {
    contentType: string
    altText?: string
    read: (encoding: 'base64') => Promise<string>
  }
  interface MammothParaForAlign {
    alignment?: string
    children?: Array<{ type: string; children?: Array<{ type: string; value?: string }> }>
  }
  const mammothAny = mammoth as unknown as {
    images: { imgElement: (fn: (image: MammothImage) => Promise<{ src: string; alt?: string }>) => unknown }
    transforms: { paragraph: (fn: (p: MammothParaForAlign) => MammothParaForAlign) => unknown }
  }

  // transformDocument: prepend an alignment-marker text run to every non-left
  // paragraph. The cheerio post-pass later converts these to inline
  // text-align styles. Left alignment is the editor default — no marker.
  const transformDocument = mammothAny.transforms.paragraph((para) => {
    const a = para.alignment
    if (a && a !== 'left' && (a === 'center' || a === 'right' || a === 'justify')) {
      return {
        ...para,
        children: [
          { type: 'run', children: [{ type: 'text', value: `☃___bbnr_align___${a}___☃` }] },
          ...(para.children ?? []),
        ],
      }
    }
    return para
  })

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
        // Keep empty paragraphs so the vertical whitespace authors place
        // around system-text blocks, between the chapter title and the
        // first body paragraph, etc. survives into the editor.
        ignoreEmptyParagraphs: false,
        transformDocument: transformDocument as never,
        convertImage: convertImage as never,
      },
    )
    html = result.value
  } catch (err) {
    throw new Error(`Word document could not be read: ${err instanceof Error ? err.message : 'unknown error'}`)
  }

  // Translate alignment markers (injected via transformDocument) into
  // text-align inline styles on the enclosing <p> / <h*>.
  html = applyAlignmentMarkers(html)

  // Post-pass: inject the page-break marker before each paragraph whose
  // OOXML counterpart had a break. Matches by text content so paragraph
  // restructuring inside mammoth (empty drops, merges) doesn't break
  // alignment.
  if (breakTexts.length > 0) {
    const injected = injectMarkersByText(html, breakTexts)
    html = injected.html
    if (injected.matched < breakTexts.length) {
      const unmatched = breakTexts.length - injected.matched
      warnings.push({
        code: 'STRUCTURE_GUESSED',
        message: `Couldn't locate ${unmatched} of ${breakTexts.length} page breaks in the rendered output — those chapters may not split correctly.`,
      })
    }
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

  // Cascade: pre-pass markers → top-level <h1> → chapter-keyword paragraphs.
  // Each stage is only tried if the previous produced no splits, because the
  // earlier signals are more reliable.
  let rawSegments = stripEmpty(splitByMarker(html))
  if (rawSegments.length <= 1) {
    rawSegments = stripEmpty(splitByH1(rawSegments[0] ?? html))
  }
  if (rawSegments.length <= 1) {
    rawSegments = stripEmpty(splitByChapterParagraphs(rawSegments[0] ?? html))
    if (rawSegments.length > 1) {
      // Tell the user we fell back to text-pattern detection so they know
      // to double-check the boundaries.
      warnings.push({
        code: 'STRUCTURE_GUESSED',
        message:
          'Chapters detected by text pattern (no page breaks or heading styles found). Review the boundaries before committing.',
      })
    } else {
      warnings.push({
        code: 'STRUCTURE_GUESSED',
        message:
          'No page breaks, heading styles, or chapter markers found — imported as a single chapter. Split it manually in the preview.',
      })
    }
  } else {
    // Pre-pass found breaks. Word manuscripts frequently lack a break
    // between the cover/title block and the first chapter (chapter 1 just
    // continues on the same page as the title). Re-run chapter-keyword
    // splitting on the leading segment so the cover doesn't bundle with
    // chapter one. Only the FIRST segment is re-split because every other
    // segment was already opened by an explicit page break.
    const firstSplit = stripEmpty(splitByChapterParagraphs(rawSegments[0] ?? ''))
    if (firstSplit.length > 1) {
      rawSegments = [...firstSplit, ...rawSegments.slice(1)]
    }
  }

  const segments: ImportSegment[] = rawSegments.map((segHtml, i) => {
    const sanitized = sanitizeImportedHtml(segHtml)
    const $ = cheerio.load(`<div id="root">${sanitized}</div>`, null, false)
    const root = $('#root')
    // Word count: full text content.
    const plainAll = root.text()
    // First-line snippet: skip empty paragraphs (vertical spacing) and the
    // chapter-title paragraph itself so the preview reads as body prose,
    // not "Chapter One" / "Chapter One" duplicated.
    const firstP = root.find('p').filter((_idx, el) => {
      const text = $(el).text().trim()
      if (text.length === 0) return false
      if (text.length <= CHAPTER_PARAGRAPH_MAX_LEN && CHAPTER_PARAGRAPH_RE.test(text)) return false
      return true
    }).first()
    const firstLineSource = firstP.length > 0 ? firstP.text() : plainAll
    const detection = extractTitleAndBody(sanitized, `Chapter ${i + 1}`)
    return {
      tempId: randomUUID(),
      suggestedTitle: detection.title,
      html: sanitized,
      wordCount: countWordsFromText(plainAll),
      firstLine: firstSnippet(firstLineSource),
      ...(detection.structure ? { titleStructure: detection.structure } : {}),
      ...(detection.htmlWithoutTitle ? { htmlWithoutTitle: detection.htmlWithoutTitle } : {}),
    }
  })

  return { segments, warnings, sourceFormat: 'docx' }
}
