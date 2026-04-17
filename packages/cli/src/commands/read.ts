import { Command } from 'commander'
import { createClient, getGlobalOpts } from '../cli.js'
import { output } from '../lib/output.js'
import { handleError } from '../lib/errors.js'

export function registerReadCommand(program: Command): void {
  const read = program
    .command('read')
    .description('Read published content (no auth required)')

  read
    .command('resolve')
    .description('Resolve a project by slug')
    .argument('<slug>', 'Project slug (or author/slug)')
    .action(async (slug: string) => {
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        let data: any

        if (slug.includes('/')) {
          const [username, projectSlug] = slug.split('/', 2)
          data = await client.resolveByAuthorAndSlug(username, projectSlug)
        } else {
          data = await client.resolveSlug(slug)
        }

        if (opts.json) {
          output(data, true)
          return
        }

        const p = data.project || data
        console.log(`  Title:  ${p.name || p.title}`)
        console.log(`  ID:     ${p.id}`)
        if (p.author) console.log(`  Author: ${p.author.username || p.author.name}`)
        if (p.description) console.log(`  About:  ${p.description}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  read
    .command('toc')
    .description('Show table of contents for a project')
    .argument('<project-id>', 'Project ID')
    .action(async (projectId: string) => {
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        const data = await client.getToc(projectId)

        if (opts.json) {
          output(data, true)
          return
        }

        const chapters = data.chapters || data.toc || data
        if (!Array.isArray(chapters) || chapters.length === 0) {
          console.log('  No published chapters.')
          return
        }

        console.log('  Table of Contents')
        console.log('  ─────────────────')
        for (const ch of chapters) {
          const title = ch.title || ch.name || '(untitled)'
          const words = ch.wordCount ? ` (${ch.wordCount.toLocaleString()} words)` : ''
          console.log(`  ${ch.order ?? ''}. ${title}${words}`)
        }
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  read
    .command('chapter')
    .description('Read a specific chapter')
    .argument('<project-id>', 'Project ID')
    .argument('<chapter-id>', 'Chapter ID')
    .action(async (projectId: string, chapterId: string) => {
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        const data = await client.getChapter(projectId, chapterId)

        if (opts.json) {
          output(data, true)
          return
        }

        const ch = data.chapter || data
        if (ch.title) console.log(`\n  ${ch.title}\n`)

        // Strip HTML for terminal display
        if (ch.body || ch.content) {
          const html = ch.body || ch.content
          const text = html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<[^>]*>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .trim()
          console.log(text)
        }

        if (ch.wordCount) {
          console.log(`\n  ─── ${ch.wordCount.toLocaleString()} words ───`)
        }
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })
}
