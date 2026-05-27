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
  /** Structured title-detection metadata for parsers that can identify a
   *  distinct title element (heading, chapter-marker paragraph, optionally
   *  with a matching subtitle paragraph). Used by the wizard to recompute
   *  the displayed title when the user picks a different separator and to
   *  decide whether the "strip title from body" toggle should be available. */
  titleStructure?: {
    label: string
    subtitle?: string
  }
  /** Body HTML with the title source paragraph(s) removed. Only set when
   *  `titleStructure` is set. Surrounding empty paragraphs are kept so
   *  vertical spacing stays intact. Used when the wizard's strip-from-body
   *  option is enabled. */
  htmlWithoutTitle?: string
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
    case 'epub': {
      const { parseEpub } = await import('./epub')
      return parseEpub(buffer, ctx)
    }
    case 'odt': {
      const { parseOdt } = await import('./odt')
      return parseOdt(buffer, ctx)
    }
    case 'rtf': {
      const { parseRtf } = await import('./rtf')
      return parseRtf(buffer, ctx)
    }
    case 'pdf': {
      const { parsePdf } = await import('./pdf')
      return parsePdf(buffer, ctx)
    }
    case 'html':
      throw new UnsupportedFormatError(format)
  }
}
