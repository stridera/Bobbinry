import { describe, it, expect, jest } from '@jest/globals'
import JSZip from 'jszip'

// `marked` ships ESM-only and isn't in this project's Jest
// transformIgnorePatterns allowlist (jest.base.config.js), so a real import
// blows up under ts-jest's CommonJS transform ("Must use import to load ES
// Module"). markdown.ts only uses marked to render a markdown chunk to HTML;
// the chapter-splitting logic under test here (heading detection, word
// counts, prelude handling) doesn't depend on marked's actual rendering
// fidelity, so a minimal stand-in that wraps the chunk in a <p> is enough to
// exercise it without touching the shared Jest config.
jest.mock('marked', () => ({
  marked: {
    parse: async (md: string) => {
      const trimmed = md.replace(/\s+/g, ' ').trim()
      return trimmed.length > 0 ? `<p>${trimmed}</p>` : ''
    },
  },
}))
import {
  formatFromMime,
  parseBuffer,
  UnsupportedFormatError,
  type SupportedFormat,
} from '../../import-parsers/index'
import { parseMarkdown } from '../../import-parsers/markdown'
import { parseTxt } from '../../import-parsers/txt'
import { parseEpub } from '../../import-parsers/epub'
import {
  assertSafeZip,
  ZipBombError,
  MAX_ENTRY_COUNT,
  MAX_PER_ENTRY_BYTES,
} from '../../import-parsers/zip-safe'

const ctx = { userId: 'test-user', projectId: 'test-project' }

describe('formatFromMime', () => {
  it('maps every supported MIME type to its format', () => {
    expect(formatFromMime('text/plain')).toBe('txt')
    expect(formatFromMime('text/markdown')).toBe('markdown')
    expect(formatFromMime('text/html')).toBe('html')
    expect(formatFromMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx')
    expect(formatFromMime('application/epub+zip')).toBe('epub')
    expect(formatFromMime('application/vnd.oasis.opendocument.text')).toBe('odt')
    expect(formatFromMime('application/rtf')).toBe('rtf')
    expect(formatFromMime('text/rtf')).toBe('rtf')
    expect(formatFromMime('application/pdf')).toBe('pdf')
  })

  it('returns null for an unrecognized MIME type', () => {
    expect(formatFromMime('application/octet-stream')).toBeNull()
    expect(formatFromMime('')).toBeNull()
  })
})

describe('parseBuffer dispatch', () => {
  it('dispatches txt to parseTxt', async () => {
    const result = await parseBuffer('txt', Buffer.from('Hello world'), ctx)
    expect(result.sourceFormat).toBe('txt')
    expect(result.segments).toHaveLength(1)
  })

  it('dispatches markdown to parseMarkdown', async () => {
    const result = await parseBuffer('markdown', Buffer.from('# Chapter One\n\nBody text'), ctx)
    expect(result.sourceFormat).toBe('markdown')
  })

  it('throws UnsupportedFormatError for html (declared but not implemented)', async () => {
    await expect(parseBuffer('html' as SupportedFormat, Buffer.from(''), ctx))
      .rejects.toBeInstanceOf(UnsupportedFormatError)
  })

  it('UnsupportedFormatError carries the format and a matching message', async () => {
    try {
      await parseBuffer('html' as SupportedFormat, Buffer.from(''), ctx)
      throw new Error('expected parseBuffer to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedFormatError)
      const e = err as UnsupportedFormatError
      expect(e.format).toBe('html')
      expect(e.name).toBe('UnsupportedFormatError')
      expect(e.message).toBe("Format 'html' is not yet supported in this build")
    }
  })
})

describe('parseMarkdown', () => {
  it('splits on # and ## headings into segments with the heading as title', async () => {
    const md = [
      '# Chapter One',
      'First chapter body.',
      '',
      '## Chapter Two',
      'Second chapter body.',
    ].join('\n')

    const result = await parseMarkdown(Buffer.from(md), ctx)
    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]!.suggestedTitle).toBe('Chapter One')
    expect(result.segments[0]!.html).toContain('First chapter body.')
    expect(result.segments[1]!.suggestedTitle).toBe('Chapter Two')
    expect(result.segments[1]!.html).toContain('Second chapter body.')
    expect(result.warnings).toHaveLength(0)
  })

  it('computes correct word counts for a small known input', async () => {
    const md = '# Title\n\none two three four five'
    const result = await parseMarkdown(Buffer.from(md), ctx)
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]!.wordCount).toBe(5)
  })

  it('becomes a single segment with STRUCTURE_GUESSED when there are no headings', async () => {
    const md = 'Just some prose with no headings at all.'
    const result = await parseMarkdown(Buffer.from(md), ctx)
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]!.suggestedTitle).toBe('Imported manuscript')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]!.code).toBe('STRUCTURE_GUESSED')
  })

  it('emits EMPTY_DOCUMENT when the file has no content', async () => {
    const result = await parseMarkdown(Buffer.from(''), ctx)
    expect(result.warnings[0]!.code).toBe('EMPTY_DOCUMENT')
    expect(result.segments[0]!.wordCount).toBe(0)
  })

  it('prepends a Prelude segment for prose before the first heading', async () => {
    const md = 'Leading prose.\n\n# Chapter One\nBody.'
    const result = await parseMarkdown(Buffer.from(md), ctx)
    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]!.suggestedTitle).toBe('Prelude')
    expect(result.segments[1]!.suggestedTitle).toBe('Chapter One')
  })
})

describe('parseTxt', () => {
  it('splits on chapter-marker lines (Chapter/Prologue/Epilogue/Part/Book)', async () => {
    const txt = [
      'Chapter 1',
      'First chapter body.',
      '',
      'Chapter 2',
      'Second chapter body.',
    ].join('\n')

    const result = await parseTxt(Buffer.from(txt), ctx)
    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]!.suggestedTitle).toBe('Chapter 1')
    expect(result.segments[0]!.html).toContain('First chapter body.')
    expect(result.segments[1]!.suggestedTitle).toBe('Chapter 2')
  })

  it('becomes a single segment with STRUCTURE_GUESSED when no markers are found', async () => {
    const txt = 'Just plain prose.\n\nNo chapter markers here.'
    const result = await parseTxt(Buffer.from(txt), ctx)
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]!.suggestedTitle).toBe('Imported manuscript')
    expect(result.warnings[0]!.code).toBe('STRUCTURE_GUESSED')
  })

  it('emits EMPTY_DOCUMENT for an empty file', async () => {
    const result = await parseTxt(Buffer.from(''), ctx)
    expect(result.warnings[0]!.code).toBe('EMPTY_DOCUMENT')
  })

  it('parses CRLF line endings identically to LF', async () => {
    const lf = 'Chapter 1\nFirst paragraph.\n\nSecond paragraph.'
    const crlf = lf.replace(/\n/g, '\r\n')

    const lfResult = await parseTxt(Buffer.from(lf), ctx)
    const crlfResult = await parseTxt(Buffer.from(crlf), ctx)

    expect(crlfResult.segments).toHaveLength(lfResult.segments.length)
    expect(crlfResult.segments[0]!.suggestedTitle).toBe(lfResult.segments[0]!.suggestedTitle)
    expect(crlfResult.segments[0]!.html).toBe(lfResult.segments[0]!.html)
    expect(crlfResult.segments[0]!.wordCount).toBe(lfResult.segments[0]!.wordCount)
  })

  it('wraps blank-line-separated runs of text into <p> elements', async () => {
    const txt = 'Chapter 1\nFirst paragraph line one.\n\nSecond paragraph.'
    const result = await parseTxt(Buffer.from(txt), ctx)
    expect(result.segments[0]!.html).toContain('<p>First paragraph line one.</p>')
    expect(result.segments[0]!.html).toContain('<p>Second paragraph.</p>')
  })
})

describe('zip-safe: assertSafeZip', () => {
  it('passes a small legitimate ZIP', async () => {
    const zip = new JSZip()
    zip.file('hello.txt', 'hello world')
    zip.file('nested/dir/file.txt', 'more content')
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    const loaded = await JSZip.loadAsync(buffer)
    expect(() => assertSafeZip(loaded)).not.toThrow()
  })

  it('throws ZipBombError when the entry count exceeds the cap', async () => {
    const zip = new JSZip()
    for (let i = 0; i < MAX_ENTRY_COUNT + 1; i++) {
      zip.file(`f${i}.txt`, 'x')
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    const loaded = await JSZip.loadAsync(buffer)
    expect(() => assertSafeZip(loaded)).toThrow(ZipBombError)
  })

  it('throws ZipBombError when a single entry exceeds the per-entry uncompressed cap', async () => {
    // Highly compressible content so the ZIP stays small on disk while the
    // uncompressed size jszip reports exceeds MAX_PER_ENTRY_BYTES.
    const zip = new JSZip()
    const big = Buffer.alloc(MAX_PER_ENTRY_BYTES + 1024, 'a')
    zip.file('huge.txt', big, { compression: 'DEFLATE' })
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    const loaded = await JSZip.loadAsync(buffer)
    expect(() => assertSafeZip(loaded)).toThrow(ZipBombError)
  }, 30000)
})

function buildMinimalEpub(): JSZip {
  const zip = new JSZip()
  // The mimetype entry is conventionally stored (uncompressed) and must be
  // the first entry in a real EPUB; jszip's ordering isn't load-bearing for
  // our parser since it reads META-INF/container.xml by name, not by index.
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)
  zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
  </metadata>
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`)
  zip.file('OEBPS/chapter1.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter One</title></head>
<body><h1>Chapter One</h1><p>The first chapter's body text.</p></body>
</html>`)
  zip.file('OEBPS/chapter2.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter Two</title></head>
<body><h1>Chapter Two</h1><p>The second chapter's body text.</p></body>
</html>`)
  return zip
}

describe('parseEpub', () => {
  it('produces two segments with titles taken from the spine chapters', async () => {
    const buffer = await buildMinimalEpub().generateAsync({ type: 'nodebuffer' })
    const result = await parseEpub(buffer, ctx)

    expect(result.sourceFormat).toBe('epub')
    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]!.suggestedTitle).toBe('Chapter One')
    expect(result.segments[0]!.html).toContain("The first chapter's body text.")
    expect(result.segments[1]!.suggestedTitle).toBe('Chapter Two')
    expect(result.segments[1]!.html).toContain("The second chapter's body text.")
  })

  it('rejects an archive that fails the zip-bomb guard', async () => {
    const zip = buildMinimalEpub()
    for (let i = 0; i < MAX_ENTRY_COUNT + 1; i++) {
      zip.file(`OEBPS/filler${i}.txt`, 'x')
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer' })
    await expect(parseEpub(buffer, ctx)).rejects.toBeInstanceOf(ZipBombError)
  })
})
