/**
 * Manuscript-import parser dispatcher.
 *
 * Each format has its own module in this directory; this index lazy-imports
 * the right one per parse request so cold-start cost is paid per format,
 * not per server boot. Phase 3 ships txt + markdown; later phases extend
 * the switch in parseBuffer().
 */

export type SupportedFormat =
  | 'txt'
  | 'markdown'
  | 'html'
  | 'docx'
  | 'epub'
  | 'odt'
  | 'rtf'
  | 'pdf'

export interface ImportSegment {
  tempId: string
  suggestedTitle: string
  html: string
  wordCount: number
  firstLine: string
}

export interface ImportWarning {
  code:
    | 'IMAGE_FAILED'
    | 'EXTERNAL_IMAGE_LEFT'
    | 'FORMATTING_LOST'
    | 'STRUCTURE_GUESSED'
    | 'EMPTY_DOCUMENT'
  message: string
  detail?: string
}

export interface ParserContext {
  userId: string
  projectId: string
}

export interface ParserResult {
  segments: ImportSegment[]
  warnings: ImportWarning[]
  sourceFormat: SupportedFormat
}

/** Map an upload's stored Content-Type to a parser format. Null = unsupported. */
export function formatFromMime(mime: string): SupportedFormat | null {
  switch (mime) {
    case 'text/plain':
      return 'txt'
    case 'text/markdown':
      return 'markdown'
    case 'text/html':
      return 'html'
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx'
    case 'application/epub+zip':
      return 'epub'
    case 'application/vnd.oasis.opendocument.text':
      return 'odt'
    case 'application/rtf':
    case 'text/rtf':
      return 'rtf'
    case 'application/pdf':
      return 'pdf'
    default:
      return null
  }
}

export class UnsupportedFormatError extends Error {
  constructor(public format: SupportedFormat) {
    super(`Format '${format}' is not yet supported in this build`)
    this.name = 'UnsupportedFormatError'
  }
}

export async function parseBuffer(
  format: SupportedFormat,
  buffer: Buffer,
  ctx: ParserContext,
): Promise<ParserResult> {
  switch (format) {
    case 'txt': {
      const { parseTxt } = await import('./txt')
      return parseTxt(buffer, ctx)
    }
    case 'markdown': {
      const { parseMarkdown } = await import('./markdown')
      return parseMarkdown(buffer, ctx)
    }
    case 'docx': {
      const { parseDocx } = await import('./docx')
      return parseDocx(buffer, ctx)
    }
    case 'html':
    case 'epub':
    case 'odt':
    case 'rtf':
    case 'pdf':
      throw new UnsupportedFormatError(format)
  }
}
