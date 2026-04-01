import PDFDocument from 'pdfkit'
import { convert as htmlToText } from 'html-to-text'
import TurndownService from 'turndown'
import archiver from 'archiver'
import EPub from 'epub-gen-memory'

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

export function chapterToHtml(chapter: Chapter): string {
  const parts: string[] = []
  parts.push(`<h1>${escapeHtml(chapter.container.title)}</h1>`)

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

export async function generateChaptersZip(
  chapters: Chapter[],
  format: 'pdf' | 'epub' | 'txt' | 'markdown',
  turndown: TurndownService
): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 6 } })

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

export function createTurndown(): TurndownService {
  return new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
}
