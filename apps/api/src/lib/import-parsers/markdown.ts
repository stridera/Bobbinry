/**
 * Markdown manuscript parser.
 *
 * Splits on top-level (# / ##) ATX headings — each heading starts a new
 * segment whose title is the heading text. Content between headings is
 * rendered with `marked` and sanitized to the Tiptap-safe whitelist.
 * Setext-style underlined headings (=== / ---) are recognized by marked
 * during render but not by the splitter — those documents come through as
 * one segment with a STRUCTURE_GUESSED warning.
 */

import { randomUUID } from 'crypto'
import { marked } from 'marked'
import type {
  ImportSegment,
  ImportWarning,
  ParserContext,
  ParserResult,
} from './index'
import { sanitizeImportedHtml } from './sanitize'

const ATX_HEADING_PATTERN = /^(#{1,2})\s+(.+?)\s*#*\s*$/
const FIRST_LINE_LIMIT = 140

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstSnippet(plain: string): string {
  return plain.length > FIRST_LINE_LIMIT
    ? plain.slice(0, FIRST_LINE_LIMIT) + '…'
    : plain
}

async function renderChunk(md: string): Promise<string> {
  const rendered = await marked.parse(md, { async: true })
  return sanitizeImportedHtml(rendered)
}

export async function parseMarkdown(
  buffer: Buffer,
  _ctx: ParserContext,
): Promise<ParserResult> {
  const warnings: ImportWarning[] = []

  let text = buffer.toString('utf8')
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  text = text.replace(/\r\n?/g, '\n')

  const lines = text.split('\n')
  const markers: Array<{ index: number; title: string }> = []
  for (let i = 0; i < lines.length; i++) {
    const match = (lines[i] ?? '').match(ATX_HEADING_PATTERN)
    if (match) markers.push({ index: i, title: match[2]!.trim() })
  }

  if (markers.length === 0) {
    const html = await renderChunk(text)
    const plain = htmlToPlain(html)
    if (plain.length === 0) {
      warnings.push({
        code: 'EMPTY_DOCUMENT',
        message: 'The file appeared empty after parsing.',
      })
    } else {
      warnings.push({
        code: 'STRUCTURE_GUESSED',
        message:
          'No # or ## headings found — imported as a single chapter. Split it manually in the preview.',
      })
    }
    return {
      segments: [{
        tempId: randomUUID(),
        suggestedTitle: 'Imported manuscript',
        html,
        wordCount: countWords(plain),
        firstLine: firstSnippet(plain),
      }],
      warnings,
      sourceFormat: 'markdown',
    }
  }

  const segments: ImportSegment[] = []
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i]!.index
    const end = i + 1 < markers.length ? markers[i + 1]!.index : lines.length
    const chunkMd = lines.slice(start + 1, end).join('\n')
    const html = await renderChunk(chunkMd)
    const plain = htmlToPlain(html)
    segments.push({
      tempId: randomUUID(),
      suggestedTitle: markers[i]!.title || `Chapter ${i + 1}`,
      html,
      wordCount: countWords(plain),
      firstLine: firstSnippet(plain),
    })
  }

  // Leading prose before the first heading → prepend a "Prelude" segment.
  if (markers[0]!.index > 0) {
    const preludeMd = lines.slice(0, markers[0]!.index).join('\n').trim()
    if (preludeMd.length > 0) {
      const html = await renderChunk(preludeMd)
      const plain = htmlToPlain(html)
      if (plain.length > 0) {
        segments.unshift({
          tempId: randomUUID(),
          suggestedTitle: 'Prelude',
          html,
          wordCount: countWords(plain),
          firstLine: firstSnippet(plain),
        })
      }
    }
  }

  return { segments, warnings, sourceFormat: 'markdown' }
}
