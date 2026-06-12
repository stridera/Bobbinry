/**
 * EPUB (2 and 3) manuscript parser.
 *
 * Walks the OPF spine — every linear=yes item becomes one segment. Images
 * referenced from each chapter's XHTML are extracted from the zip and
 * uploaded to S3 via the shared images helper, with the <img src>
 * rewritten in place before sanitization.
 *
 * Nav documents (epub3 TOC) and items marked linear="no" are skipped so
 * the user doesn't get a "Table of Contents" segment in their manuscript.
 */

import { randomUUID } from 'crypto'
import path from 'path'
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
import { assertSafeZip, ZipBombError } from './zip-safe'

const FIRST_LINE_LIMIT = 140
const TITLE_FALLBACK_LIMIT = 80

interface ManifestItem {
  href: string          // path relative to the OPF directory
  mediaType: string
  /** Resolved path inside the zip — populated after we know the OPF directory. */
  zipPath: string
  properties: string    // epub3 'properties' attribute (e.g. 'nav', 'cover-image')
}

interface SpineItem {
  idref: string
  linear: boolean
}

interface OpfData {
  opfDir: string
  manifest: Map<string, ManifestItem>
  spine: SpineItem[]
}

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseAttributeValue: false,
})

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

async function parseContainerXml(zip: JSZip): Promise<string> {
  const file = zip.file('META-INF/container.xml')
  if (!file) throw new Error('Not a valid EPUB: META-INF/container.xml missing')
  const xmlText = await file.async('string')
  const parsed = xml.parse(xmlText)
  const rootfiles = asArray(parsed?.container?.rootfiles?.rootfile)
  const opf = rootfiles[0] as { '@_full-path'?: string } | undefined
  const fullPath = opf?.['@_full-path']
  if (!fullPath) throw new Error('Not a valid EPUB: container.xml has no rootfile')
  return fullPath
}

async function parseOpf(zip: JSZip, opfPath: string): Promise<OpfData> {
  const file = zip.file(opfPath)
  if (!file) throw new Error(`OPF file '${opfPath}' missing from archive`)
  const xmlText = await file.async('string')
  const parsed = xml.parse(xmlText)

  const opfDir = path.posix.dirname(opfPath)

  const manifest = new Map<string, ManifestItem>()
  const items = asArray(parsed?.package?.manifest?.item)
  for (const raw of items) {
    const item = raw as Record<string, string>
    const id = item['@_id']
    const href = item['@_href']
    const mediaType = item['@_media-type'] || 'application/octet-stream'
    if (!id || !href) continue
    const zipPath = path.posix.normalize(opfDir ? `${opfDir}/${href}` : href)
    manifest.set(id, {
      href,
      mediaType,
      zipPath,
      properties: item['@_properties'] ?? '',
    })
  }

  const spine: SpineItem[] = []
  const refs = asArray(parsed?.package?.spine?.itemref)
  for (const raw of refs) {
    const ref = raw as Record<string, string>
    const idref = ref['@_idref']
    if (!idref) continue
    const linearAttr = (ref['@_linear'] ?? 'yes').toLowerCase()
    spine.push({ idref, linear: linearAttr !== 'no' })
  }

  return { opfDir, manifest, spine }
}

function isChapterMediaType(mt: string): boolean {
  return /xhtml\+xml|html/i.test(mt)
}

function isImageMediaType(mt: string): boolean {
  return /^image\//i.test(mt)
}

function extractTitleFromXhtml($: cheerio.CheerioAPI): string | null {
  // First heading anywhere in body
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const el = $(`body ${tag}`).first()
    if (el.length > 0) {
      const text = el.text().trim()
      if (text) {
        return text.length > TITLE_FALLBACK_LIMIT
          ? text.slice(0, TITLE_FALLBACK_LIMIT) + '…'
          : text
      }
    }
  }
  // Fall back to <title>
  const title = $('head title').first().text().trim()
  if (title) {
    return title.length > TITLE_FALLBACK_LIMIT
      ? title.slice(0, TITLE_FALLBACK_LIMIT) + '…'
      : title
  }
  return null
}

function getBodyHtml($: cheerio.CheerioAPI): string {
  const body = $('body')
  if (body.length > 0) return body.html() ?? ''
  return $.root().html() ?? ''
}

function countWordsFromText(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length
}

function firstSnippet(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > FIRST_LINE_LIMIT ? t.slice(0, FIRST_LINE_LIMIT) + '…' : t
}

/** Look up an image in the manifest by its zip path (resolved relative to the chapter XHTML). */
function findManifestByZipPath(
  manifest: Map<string, ManifestItem>,
  zipPath: string,
): ManifestItem | null {
  for (const item of manifest.values()) {
    if (item.zipPath === zipPath) return item
  }
  return null
}

async function rewriteImages(
  $: cheerio.CheerioAPI,
  chapterDir: string,
  zip: JSZip,
  manifest: Map<string, ManifestItem>,
  ctx: ParserContext,
  imageErrors: string[],
): Promise<void> {
  const imgs = $('img').toArray()
  for (const img of imgs) {
    const $img = $(img)
    const src = $img.attr('src')
    if (!src) {
      $img.attr('alt', $img.attr('alt') || '[image]')
      $img.attr('data-import-error', 'true')
      continue
    }
    if (/^(https?|data):/i.test(src)) {
      // External / data-URI images: leave alone for the sanitizer to decide
      continue
    }
    const resolved = path.posix.normalize(chapterDir ? `${chapterDir}/${src}` : src)
    const manifestItem = findManifestByZipPath(manifest, resolved)
    if (!manifestItem) {
      imageErrors.push(`Manifest entry not found for image: ${src}`)
      $img.attr('alt', $img.attr('alt') || '[image]')
      $img.attr('data-import-error', 'true')
      $img.removeAttr('src')
      continue
    }

    const file = zip.file(manifestItem.zipPath)
    if (!file) {
      imageErrors.push(`Zip entry missing for image: ${manifestItem.zipPath}`)
      $img.attr('alt', $img.attr('alt') || '[image]')
      $img.attr('data-import-error', 'true')
      $img.removeAttr('src')
      continue
    }

    let buffer: Buffer
    try {
      buffer = await file.async('nodebuffer')
    } catch (err) {
      imageErrors.push(`Failed to read image '${manifestItem.zipPath}': ${err instanceof Error ? err.message : 'unknown'}`)
      $img.removeAttr('src')
      $img.attr('data-import-error', 'true')
      continue
    }

    const { url, warning } = await uploadImportImage(buffer, manifestItem.mediaType, ctx)
    if (warning) imageErrors.push(warning)
    if (!url) {
      $img.removeAttr('src')
      $img.attr('alt', $img.attr('alt') || '[image]')
      $img.attr('data-import-error', 'true')
      continue
    }
    $img.attr('src', url)
  }
}

export async function parseEpub(
  buffer: Buffer,
  ctx: ParserContext,
): Promise<ParserResult> {
  const warnings: ImportWarning[] = []
  const imageErrors: string[] = []

  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch (err) {
    throw new Error(`Not a valid EPUB archive: ${err instanceof Error ? err.message : 'unknown error'}`)
  }

  try {
    assertSafeZip(zip)
  } catch (err) {
    if (err instanceof ZipBombError) throw err
    throw err
  }

  const opfPath = await parseContainerXml(zip)
  const { manifest, spine } = await parseOpf(zip, opfPath)

  if (spine.length === 0) {
    warnings.push({
      code: 'EMPTY_DOCUMENT',
      message: 'EPUB has no spine items — nothing to import.',
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
      sourceFormat: 'epub',
    }
  }

  const segments: ImportSegment[] = []
  let chapterIndex = 0

  for (const ref of spine) {
    if (!ref.linear) continue
    const item = manifest.get(ref.idref)
    if (!item) {
      warnings.push({
        code: 'STRUCTURE_GUESSED',
        message: `Skipped spine item with no manifest entry: ${ref.idref}`,
      })
      continue
    }
    // EPUB3 nav documents are sometimes in the spine. Skip them.
    if (item.properties.split(/\s+/).includes('nav')) continue
    if (!isChapterMediaType(item.mediaType)) {
      // A cover image referenced directly in the spine — skip.
      if (isImageMediaType(item.mediaType)) continue
      warnings.push({
        code: 'STRUCTURE_GUESSED',
        message: `Skipped non-text spine item: ${item.href} (${item.mediaType})`,
      })
      continue
    }

    const file = zip.file(item.zipPath)
    if (!file) {
      warnings.push({
        code: 'STRUCTURE_GUESSED',
        message: `Spine references missing file: ${item.zipPath}`,
      })
      continue
    }

    const xhtml = await file.async('string')
    const $ = cheerio.load(xhtml, { xml: false })

    const chapterDir = path.posix.dirname(item.zipPath)
    await rewriteImages($, chapterDir, zip, manifest, ctx, imageErrors)

    const detectedTitle = extractTitleFromXhtml($)
    const bodyHtml = getBodyHtml($)
    const sanitized = sanitizeImportedHtml(bodyHtml)

    const $sanitized = cheerio.load(`<div id="root">${sanitized}</div>`, null, false)
    const root = $sanitized('#root')
    const fullText = root.text()
    if (fullText.replace(/\s+/g, '').length === 0) continue

    const firstPara = root.find('p').filter((_idx, el) => $sanitized(el).text().trim().length > 0).first()
    const firstLineSource = firstPara.length > 0 ? firstPara.text() : fullText

    chapterIndex += 1
    segments.push({
      tempId: randomUUID(),
      suggestedTitle: detectedTitle ?? `Chapter ${chapterIndex}`,
      html: sanitized,
      wordCount: countWordsFromText(fullText),
      firstLine: firstSnippet(firstLineSource),
    })
  }

  if (imageErrors.length > 0) {
    warnings.push({
      code: 'IMAGE_FAILED',
      message: `${imageErrors.length} embedded image${imageErrors.length === 1 ? '' : 's'} could not be imported.`,
      detail: imageErrors.slice(0, 3).join(' · '),
    })
  }

  if (segments.length === 0) {
    warnings.push({
      code: 'EMPTY_DOCUMENT',
      message: 'No readable chapters found in the EPUB.',
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
      sourceFormat: 'epub',
    }
  }

  return { segments, warnings, sourceFormat: 'epub' }
}
