import { describe, it, expect } from '@jest/globals'
import JSZip from 'jszip'
import {
  type Chapter,
  chapterToPlainText,
  chapterToMarkdown,
  chapterToHtml,
  escapeHtml,
  generatePdf,
  generateEpub,
  generateDocx,
  generateChaptersZip,
  buildOutline,
  outlineToPlainText,
  outlineToMarkdown,
  outlineToHtml,
  generateOutline,
  createTurndown,
} from '../../lib/export-converters'

// ──────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────

function makeChapter(title: string, body: string): Chapter {
  return {
    container: { id: 'c1', title, type: 'chapter', order: 100, parentId: null },
    scenes: [{ id: 's1', title, body, containerId: 'c1', order: 100, status: 'draft' }],
  }
}

function makeChapters(): Chapter[] {
  return [
    makeChapter('Prologue', '<p>It was a dark night.</p>'),
    {
      container: { id: 'c2', title: 'Chapter One', type: 'chapter', order: 200, parentId: null },
      scenes: [{ id: 's2', title: 'Chapter One', body: '<p>The hero arrived.</p>', containerId: 'c2', order: 200, status: 'draft' }],
    },
    {
      container: { id: 'c3', title: 'Chapter Two', type: 'chapter', order: 300, parentId: null },
      scenes: [{ id: 's3', title: 'Chapter Two', body: '<p>Danger <strong>loomed</strong>.</p>', containerId: 'c3', order: 300, status: 'draft' }],
    },
  ]
}

// ──────────────────────────────────────────
// escapeHtml
// ──────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes angle brackets, ampersands, and quotes', () => {
    expect(escapeHtml('<script>"alert&1"</script>')).toBe(
      '&lt;script&gt;&quot;alert&amp;1&quot;&lt;/script&gt;'
    )
  })

  it('returns plain text unchanged', () => {
    expect(escapeHtml('Hello world')).toBe('Hello world')
  })
})

// ──────────────────────────────────────────
// chapterToPlainText
// ──────────────────────────────────────────

describe('chapterToPlainText', () => {
  it('converts chapter title to uppercase with underline', () => {
    const ch = makeChapter('My Chapter', '<p>Some text.</p>')
    const text = chapterToPlainText(ch)

    expect(text).toContain('MY CHAPTER')
    expect(text).toContain('==========')
  })

  it('strips HTML tags', () => {
    const ch = makeChapter('Test', '<p><strong>Bold</strong> and <em>italic</em></p>')
    const text = chapterToPlainText(ch)

    expect(text).toContain('Bold')
    expect(text).toContain('italic')
    expect(text).not.toContain('<p>')
    expect(text).not.toContain('<strong>')
    expect(text).not.toContain('<em>')
  })

  it('handles empty body', () => {
    const ch = makeChapter('Empty', '')
    const text = chapterToPlainText(ch)

    expect(text).toContain('EMPTY')
    // Should not throw
  })

  it('converts list items', () => {
    const ch = makeChapter('Lists', '<ul><li>One</li><li>Two</li></ul>')
    const text = chapterToPlainText(ch)

    expect(text).toContain('One')
    expect(text).toContain('Two')
  })
})

// ──────────────────────────────────────────
// chapterToMarkdown
// ──────────────────────────────────────────

describe('chapterToMarkdown', () => {
  const turndown = createTurndown()

  it('uses ATX heading for chapter title', () => {
    const ch = makeChapter('My Title', '<p>Body text.</p>')
    const md = chapterToMarkdown(ch, turndown)

    expect(md).toContain('# My Title')
    expect(md).toContain('Body text.')
  })

  it('preserves bold and italic as markdown', () => {
    const ch = makeChapter('Styled', '<p><strong>Bold</strong> and <em>italic</em></p>')
    const md = chapterToMarkdown(ch, turndown)

    expect(md).toContain('**Bold**')
    expect(md).toContain('_italic_')
  })

  it('converts lists to markdown', () => {
    const ch = makeChapter('With List', '<ul><li>First</li><li>Second</li></ul>')
    const md = chapterToMarkdown(ch, turndown)

    expect(md).toContain('First')
    expect(md).toContain('Second')
  })

  it('handles empty body', () => {
    const ch = makeChapter('Empty', '')
    const md = chapterToMarkdown(ch, turndown)

    expect(md).toContain('# Empty')
  })
})

// ──────────────────────────────────────────
// chapterToHtml
// ──────────────────────────────────────────

describe('chapterToHtml', () => {
  it('wraps title in h1 and includes body', () => {
    const ch = makeChapter('Title', '<p>Content here</p>')
    const html = chapterToHtml(ch)

    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<p>Content here</p>')
  })

  it('escapes HTML in title', () => {
    const ch = makeChapter('A <b>Bold</b> Title', '<p>Body</p>')
    const html = chapterToHtml(ch)

    expect(html).toContain('&lt;b&gt;Bold&lt;/b&gt;')
  })
})

// ──────────────────────────────────────────
// generatePdf
// ──────────────────────────────────────────

describe('generatePdf', () => {
  it('produces a valid PDF buffer', async () => {
    const chapters = makeChapters()
    const pdf = await generatePdf('Test Novel', chapters)

    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.length).toBeGreaterThan(0)
    // PDF magic bytes
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
  })

  it('includes project name on title page', async () => {
    const pdf = await generatePdf('My Great Book', [makeChapter('Ch1', '<p>Text</p>')])
    const text = pdf.toString('latin1')

    expect(text).toContain('My Great Book')
  })

  it('handles single chapter', async () => {
    const pdf = await generatePdf('Single', [makeChapter('Only Chapter', '<p>Content</p>')])

    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
  })
})

// ──────────────────────────────────────────
// generateEpub
// ──────────────────────────────────────────

describe('generateEpub', () => {
  it('produces a valid EPUB buffer (ZIP format)', async () => {
    const chapters = makeChapters()
    const epub = await generateEpub('Test Novel', chapters)

    expect(Buffer.isBuffer(epub)).toBe(true)
    expect(epub.length).toBeGreaterThan(0)
    // EPUB is a ZIP — PK magic bytes
    expect(epub[0]).toBe(0x50)
    expect(epub[1]).toBe(0x4b)
  })

  it('handles single chapter', async () => {
    const epub = await generateEpub('Short', [makeChapter('One', '<p>Only chapter</p>')])

    expect(epub[0]).toBe(0x50)
    expect(epub[1]).toBe(0x4b)
  })
})

// ──────────────────────────────────────────
// generateDocx
// ──────────────────────────────────────────

/** DOCX is a ZIP — pull out the main document part for assertions. */
async function readDocxXml(docx: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(docx)
  const doc = zip.file('word/document.xml')
  expect(doc).not.toBeNull()
  return doc!.async('string')
}

describe('generateDocx', () => {
  it('produces a valid DOCX buffer containing word/document.xml', async () => {
    const docx = await generateDocx('Test Novel', makeChapters())

    expect(Buffer.isBuffer(docx)).toBe(true)
    expect(docx.length).toBeGreaterThan(0)
    // DOCX is a ZIP — PK magic bytes
    expect(docx[0]).toBe(0x50)
    expect(docx[1]).toBe(0x4b)

    const xml = await readDocxXml(docx)
    expect(xml).toContain('Prologue')
    expect(xml).toContain('It was a dark night.')
  })

  it('preserves emphasis instead of flattening to plain text', async () => {
    // This is what separates DOCX from the PDF path, which runs everything
    // through htmlToText and silently drops italics.
    const docx = await generateDocx('Emphasis', [
      makeChapter('One', '<p>She was <em>certain</em> and <strong>ready</strong>.</p>'),
    ])
    const xml = await readDocxXml(docx)

    expect(xml).toContain('<w:i')  // italic run from <em>
    expect(xml).toContain('<w:b')  // bold run from <strong>
    expect(xml).toContain('certain')
  })

  it('starts each chapter on a new page', async () => {
    const xml = await readDocxXml(await generateDocx('Breaks', makeChapters()))

    expect(xml).toContain('<w:pageBreakBefore')
  })

  it('handles single chapter', async () => {
    const docx = await generateDocx('Short', [makeChapter('One', '<p>Only chapter</p>')])

    expect(docx[0]).toBe(0x50)
    expect(docx[1]).toBe(0x4b)
  })
})

// ──────────────────────────────────────────
// generateChaptersZip
// ──────────────────────────────────────────

describe('generateChaptersZip', () => {
  const turndown = createTurndown()

  it('produces a valid ZIP for txt format', async () => {
    const chapters = makeChapters()
    const zip = await generateChaptersZip(chapters, 'txt', turndown)

    expect(Buffer.isBuffer(zip)).toBe(true)
    // ZIP magic bytes
    expect(zip[0]).toBe(0x50)
    expect(zip[1]).toBe(0x4b)
  })

  it('produces a valid ZIP for markdown format', async () => {
    const chapters = makeChapters()
    const zip = await generateChaptersZip(chapters, 'markdown', turndown)

    expect(zip[0]).toBe(0x50)
    expect(zip[1]).toBe(0x4b)
  })

  it('produces a valid ZIP for pdf format', async () => {
    const zip = await generateChaptersZip(
      [makeChapter('Ch1', '<p>Text</p>')],
      'pdf',
      turndown
    )

    expect(zip[0]).toBe(0x50)
    expect(zip[1]).toBe(0x4b)
  })

  it('produces a valid ZIP for epub format', async () => {
    const zip = await generateChaptersZip(
      [makeChapter('Ch1', '<p>Text</p>')],
      'epub',
      turndown
    )

    expect(zip[0]).toBe(0x50)
    expect(zip[1]).toBe(0x4b)
  })

  it('produces a ZIP with one .docx per chapter', async () => {
    const zip = await generateChaptersZip(makeChapters(), 'docx', turndown)

    expect(zip[0]).toBe(0x50)
    expect(zip[1]).toBe(0x4b)

    const names = Object.keys((await JSZip.loadAsync(zip)).files)
    expect(names).toEqual([
      '01-Prologue.docx',
      '02-Chapter One.docx',
      '03-Chapter Two.docx',
    ])
  })
})

// ──────────────────────────────────────────
// Outline
// ──────────────────────────────────────────

describe('buildOutline', () => {
  it('numbers chapters 1-based in list order', () => {
    expect(buildOutline(makeChapters())).toEqual([
      { number: 1, title: 'Prologue' },
      { number: 2, title: 'Chapter One' },
      { number: 3, title: 'Chapter Two' },
    ])
  })

  it('falls back to Untitled for blank titles', () => {
    expect(buildOutline([makeChapter('', '<p>x</p>')])).toEqual([
      { number: 1, title: 'Untitled' },
    ])
  })

  it('returns an empty list for no chapters', () => {
    expect(buildOutline([])).toEqual([])
  })
})

describe('outlineToPlainText', () => {
  it('lists numbered titles under the project name', () => {
    const text = outlineToPlainText('Test Novel', makeChapters())

    expect(text).toContain('TEST NOVEL')
    expect(text).toContain('1.  Prologue')
    expect(text).toContain('2.  Chapter One')
    expect(text).toContain('3.  Chapter Two')
  })

  it('omits body prose entirely', () => {
    const text = outlineToPlainText('Test Novel', makeChapters())

    expect(text).not.toContain('It was a dark night')
    expect(text).not.toContain('The hero arrived')
    expect(text).not.toContain('loomed')
  })

  it('right-aligns numbers once the count reaches double digits', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      makeChapter(`Chapter ${i + 1}`, '<p>body</p>')
    )
    const text = outlineToPlainText('Long', many)

    expect(text).toContain(' 1.  Chapter 1')
    expect(text).toContain('10.  Chapter 10')
  })
})

describe('outlineToMarkdown', () => {
  it('renders an ordered list under an ATX heading', () => {
    const md = outlineToMarkdown('Test Novel', makeChapters())

    expect(md).toContain('# Test Novel')
    expect(md).toContain('1. Prologue')
    expect(md).toContain('2. Chapter One')
    expect(md).toContain('3. Chapter Two')
    expect(md).not.toContain('It was a dark night')
  })
})

describe('outlineToHtml', () => {
  it('escapes titles', () => {
    const html = outlineToHtml('Novel', [makeChapter('<script>', '<p>x</p>')])

    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})

describe('generateOutline', () => {
  it('returns text for txt and markdown', async () => {
    const chapters = makeChapters()

    expect(await generateOutline('Novel', chapters, 'txt')).toContain('1.  Prologue')
    expect(await generateOutline('Novel', chapters, 'markdown')).toContain('1. Prologue')
  })

  it('returns a valid PDF buffer', async () => {
    const pdf = await generateOutline('Novel', makeChapters(), 'pdf')

    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect((pdf as Buffer).subarray(0, 4).toString()).toBe('%PDF')
  })

  it('returns a DOCX with titles but no prose', async () => {
    const docx = (await generateOutline('Novel', makeChapters(), 'docx')) as Buffer

    expect(docx[0]).toBe(0x50)
    expect(docx[1]).toBe(0x4b)

    const xml = await readDocxXml(docx)
    expect(xml).toContain('Prologue')
    expect(xml).not.toContain('It was a dark night')
  })

  it('returns a valid EPUB buffer', async () => {
    const epub = (await generateOutline('Novel', makeChapters(), 'epub')) as Buffer

    expect(epub[0]).toBe(0x50)
    expect(epub[1]).toBe(0x4b)
  })
})

// ──────────────────────────────────────────
// Full manuscript text assembly
// ──────────────────────────────────────────

describe('Full manuscript assembly', () => {
  it('joins chapters with separators in plain text', () => {
    const chapters = makeChapters()
    const parts = chapters.map((ch) => chapterToPlainText(ch))
    const fullText = parts.join('\n\n---\n\n')

    expect(fullText).toContain('PROLOGUE')
    expect(fullText).toContain('CHAPTER ONE')
    expect(fullText).toContain('CHAPTER TWO')
    expect(fullText).toContain('---')
    // Order preserved
    expect(fullText.indexOf('PROLOGUE')).toBeLessThan(fullText.indexOf('CHAPTER ONE'))
    expect(fullText.indexOf('CHAPTER ONE')).toBeLessThan(fullText.indexOf('CHAPTER TWO'))
  })

  it('joins chapters with separators in markdown', () => {
    const turndown = createTurndown()
    const chapters = makeChapters()
    const parts = chapters.map((ch) => chapterToMarkdown(ch, turndown))
    const fullMd = parts.join('\n\n---\n\n')

    expect(fullMd).toContain('# Prologue')
    expect(fullMd).toContain('# Chapter One')
    expect(fullMd).toContain('# Chapter Two')
    expect(fullMd).toContain('It was a dark night.')
    expect(fullMd).toContain('**loomed**')
  })
})
