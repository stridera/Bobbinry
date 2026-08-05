import PDFDocument from 'pdfkit'
import { convert as htmlToText } from 'html-to-text'
import TurndownService from 'turndown'
import { ZipArchive } from 'archiver'
import EPub from 'epub-gen-memory'
import HTMLtoDOCX from '@turbodocx/html-to-docx'
import type { ExportFormat } from '@bobbinry/types'

// ============================================
// TYPES
// ============================================

export interface Container {
  id: string
  title: string
  type: string
  order: number
  parentId: string | null
}

export interface Content {
  id: string
  title: string
  body: string
  containerId: string
  order: number
  status: string
}

export interface Chapter {
  container: Container
  scenes: Content[]
}

// ============================================
// FORMAT CONVERTERS
// ============================================

export function chapterToPlainText(chapter: Chapter): string {
  const lines: string[] = []
  lines.push(chapter.container.title.toUpperCase())
  lines.push('='.repeat(chapter.container.title.length))
  lines.push('')

  for (const scene of chapter.scenes) {
    if (scene.body) {
      lines.push(
        htmlToText(scene.body, {
          wordwrap: 80,
          preserveNewlines: true,
        })
      )
      lines.push('')
    }
  }

  return lines.join('\n')
}

export function chapterToMarkdown(chapter: Chapter, turndown: TurndownService): string {
  const lines: string[] = []
  lines.push(`# ${chapter.container.title}`)
  lines.push('')

  for (const scene of chapter.scenes) {
    if (scene.body) {
      lines.push(turndown.turndown(scene.body))
      lines.push('')
    }
  }

  return lines.join('\n')
}

export function chapterToHtml(chapter: Chapter, opts?: { pageBreak?: boolean }): string {
  const parts: string[] = []
  // EPUB puts every chapter in its own XHTML file, so it needs no break hint.
  // DOCX is one continuous flow — the style is what starts each chapter on a
  // fresh page. `page-break-before` only fires on the value `always`.
  const style = opts?.pageBreak ? ' style="page-break-before: always;"' : ''
  parts.push(`<h1${style}>${escapeHtml(chapter.container.title)}</h1>`)

  for (const scene of chapter.scenes) {
    if (scene.body) {
      parts.push(scene.body)
    }
  }

  return parts.join('\n')
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function generatePdf(
  projectName: string,
  chapters: Chapter[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: {
        Title: projectName,
        Creator: 'Bobbinry',
      },
    })

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // Title page
    doc.fontSize(28).font('Helvetica-Bold')
    doc.moveDown(8)
    doc.text(projectName, { align: 'center' })
    doc.moveDown(2)
    doc.fontSize(12).font('Helvetica')
    doc.text('Exported from Bobbinry', { align: 'center' })

    // Chapters
    for (const chapter of chapters) {
      doc.addPage()

      // Chapter heading
      doc.fontSize(20).font('Helvetica-Bold')
      doc.text(chapter.container.title)
      doc.moveDown(1)

      // Scene content
      doc.fontSize(11).font('Helvetica')
      for (const scene of chapter.scenes) {
        if (scene.body) {
          const text = htmlToText(scene.body, {
            wordwrap: false,
            preserveNewlines: true,
          })
          doc.text(text, {
            align: 'left',
            lineGap: 4,
            paragraphGap: 8,
          })
          doc.moveDown(0.5)
        }
      }
    }

    doc.end()
  })
}

export async function generateEpub(
  projectName: string,
  chapters: Chapter[]
): Promise<Buffer> {
  const epubChapters = chapters.map((ch) => ({
    title: ch.container.title,
    content: chapterToHtml(ch),
  }))

  const epub = await EPub(
    {
      title: projectName,
      author: 'Unknown',
      publisher: 'Bobbinry',
      description: `${projectName} — exported from Bobbinry`,
      lang: 'en',
    },
    epubChapters
  )

  return Buffer.from(epub)
}

/**
 * html-to-docx returns a Buffer under Node but its types allow the browser
 * bundle's ArrayBuffer/Blob too. Normalize so callers always get a Buffer.
 */
async function toBuffer(out: ArrayBuffer | Blob | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(out)) return out
  if (out instanceof ArrayBuffer) return Buffer.from(out)
  return Buffer.from(await out.arrayBuffer())
}

/**
 * Unlike the PDF path — which flattens everything through htmlToText and loses
 * emphasis — DOCX consumes the stored TipTap HTML directly, so italics, bold,
 * headings, blockquotes, and lists survive the round trip.
 */
export async function generateDocx(
  projectName: string,
  chapters: Chapter[]
): Promise<Buffer> {
  const html = [
    `<h1 style="text-align: center;">${escapeHtml(projectName)}</h1>`,
    '<p style="text-align: center;">Exported from Bobbinry</p>',
    ...chapters.map((ch) => chapterToHtml(ch, { pageBreak: true })),
  ].join('\n')

  const out = await HTMLtoDOCX(html, null, {
    title: projectName,
    creator: 'Bobbinry',
  })

  return toBuffer(out)
}

export async function generateChaptersZip(
  chapters: Chapter[],
  format: ExportFormat,
  turndown: TurndownService
): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 6 } })

  for (const [i, ch] of chapters.entries()) {
    const prefix = String(i + 1).padStart(2, '0')
    const chapterFileName = `${prefix}-${ch.container.title.replace(/[^a-zA-Z0-9_\- ]/g, '')}`

    switch (format) {
      case 'pdf': {
        const pdf = await generatePdf(ch.container.title, [ch])
        archive.append(pdf, { name: `${chapterFileName}.pdf` })
        break
      }
      case 'epub': {
        const epub = await generateEpub(ch.container.title, [ch])
        archive.append(epub, { name: `${chapterFileName}.epub` })
        break
      }
      case 'txt': {
        archive.append(chapterToPlainText(ch), {
          name: `${chapterFileName}.txt`,
        })
        break
      }
      case 'markdown': {
        archive.append(chapterToMarkdown(ch, turndown), {
          name: `${chapterFileName}.md`,
        })
        break
      }
      case 'docx': {
        const docx = await generateDocx(ch.container.title, [ch])
        archive.append(docx, { name: `${chapterFileName}.docx` })
        break
      }
    }
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.on('error', reject)
    archive.finalize()
  })
}

// ============================================
// OUTLINE (chapter numbers + titles, no prose)
// ============================================

export interface OutlineEntry {
  number: number
  title: string
}

/**
 * Numbering is 1-based over the flat chapter list — the same ordering the
 * dashboard shows and that getManuscriptData() produces.
 */
export function buildOutline(chapters: Chapter[]): OutlineEntry[] {
  return chapters.map((ch, i) => ({
    number: i + 1,
    title: ch.container.title || 'Untitled',
  }))
}

export function outlineToPlainText(projectName: string, chapters: Chapter[]): string {
  const entries = buildOutline(chapters)
  // Right-align the numbers so titles line up once the count hits double digits.
  const width = String(entries.length).length

  const lines: string[] = [
    projectName.toUpperCase(),
    '='.repeat(projectName.length),
    '',
  ]

  for (const entry of entries) {
    lines.push(`${String(entry.number).padStart(width)}.  ${entry.title}`)
  }

  return lines.join('\n')
}

export function outlineToMarkdown(projectName: string, chapters: Chapter[]): string {
  const lines: string[] = [`# ${projectName}`, '']

  for (const entry of buildOutline(chapters)) {
    lines.push(`${entry.number}. ${entry.title}`)
  }

  return lines.join('\n')
}

export function outlineToHtml(projectName: string, chapters: Chapter[]): string {
  const items = buildOutline(chapters)
    .map((entry) => `<li>${escapeHtml(entry.title)}</li>`)
    .join('\n')

  return [`<h1>${escapeHtml(projectName)}</h1>`, '<ol>', items, '</ol>'].join('\n')
}

export async function generateOutlinePdf(
  projectName: string,
  chapters: Chapter[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: {
        Title: `${projectName} — Outline`,
        Creator: 'Bobbinry',
      },
    })

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(24).font('Helvetica-Bold')
    doc.text(projectName)
    doc.moveDown(0.5)
    doc.fontSize(12).font('Helvetica')
    doc.text('Outline')
    doc.moveDown(1.5)

    const entries = buildOutline(chapters)
    const width = String(entries.length).length

    doc.fontSize(12)
    for (const entry of entries) {
      doc.text(`${String(entry.number).padStart(width)}.  ${entry.title}`, {
        lineGap: 6,
      })
    }

    doc.end()
  })
}

/**
 * Dispatches the outline to whichever format the caller asked for. Mirrors
 * generateChaptersZip's shape so the route keeps a single small switch.
 * Text formats come back as strings; binary formats as Buffers.
 */
export async function generateOutline(
  projectName: string,
  chapters: Chapter[],
  format: ExportFormat
): Promise<Buffer | string> {
  switch (format) {
    case 'txt':
      return outlineToPlainText(projectName, chapters)
    case 'markdown':
      return outlineToMarkdown(projectName, chapters)
    case 'pdf':
      return generateOutlinePdf(projectName, chapters)
    case 'docx':
      return toBuffer(
        await HTMLtoDOCX(outlineToHtml(projectName, chapters), null, {
          title: `${projectName} — Outline`,
          creator: 'Bobbinry',
        })
      )
    case 'epub': {
      const epub = await EPub(
        {
          title: `${projectName} — Outline`,
          author: 'Unknown',
          publisher: 'Bobbinry',
          description: `${projectName} outline — exported from Bobbinry`,
          lang: 'en',
        },
        [{ title: 'Outline', content: outlineToHtml(projectName, chapters) }]
      )
      return Buffer.from(epub)
    }
  }
}

export function createTurndown(): TurndownService {
  return new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
}
