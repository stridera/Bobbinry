import { Command } from 'commander'
import { createClient, getGlobalOpts } from '../cli.js'
import { output, formatTable } from '../lib/output.js'
import { handleError } from '../lib/errors.js'

export function registerDiscoverCommand(program: Command): void {
  const discover = program
    .command('discover')
    .description('Browse published projects (no auth required)')
    .action(async () => {
      // Default: discover projects
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        const data = await client.discoverProjects({ sort: 'trending', limit: 20 })

        if (opts.json) {
          output(data, true)
          return
        }

        const list = data.projects || data
        if (!Array.isArray(list) || list.length === 0) {
          console.log('  No published projects found.')
          return
        }

        console.log('  Trending Projects')
        console.log('  ─────────────────')
        console.log(formatTable(
          list.map((p: any) => ({
            title: p.name || p.title,
            author: p.author?.username || p.authorName || '-',
            genre: p.genre || '-',
          })),
          [
            { key: 'title', label: 'Title', width: 40 },
            { key: 'author', label: 'Author', width: 20 },
            { key: 'genre', label: 'Genre' },
          ]
        ))
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  discover
    .command('projects')
    .description('Browse published projects')
    .option('-q, --query <text>', 'Search query')
    .option('-s, --sort <sort>', 'Sort by (trending, recent, popular)', 'trending')
    .option('-l, --limit <n>', 'Results', '20')
    .action(async (cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        const data = await client.discoverProjects({
          q: cmdOpts.query,
          sort: cmdOpts.sort,
          limit: parseInt(cmdOpts.limit),
        })

        if (opts.json) {
          output(data, true)
          return
        }

        const list = data.projects || data
        if (!Array.isArray(list) || list.length === 0) {
          console.log('  No projects found.')
          return
        }

        console.log(formatTable(
          list.map((p: any) => ({
            title: p.name || p.title,
            author: p.author?.username || p.authorName || '-',
            genre: p.genre || '-',
          })),
          [
            { key: 'title', label: 'Title', width: 40 },
            { key: 'author', label: 'Author', width: 20 },
            { key: 'genre', label: 'Genre' },
          ]
        ))
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  discover
    .command('authors')
    .description('Browse authors')
    .option('-q, --query <text>', 'Search query')
    .option('-s, --sort <sort>', 'Sort by (popular, recent)', 'popular')
    .option('-l, --limit <n>', 'Results', '20')
    .action(async (cmdOpts: any) => {
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        const data = await client.discoverAuthors({
          q: cmdOpts.query,
          sort: cmdOpts.sort,
          limit: parseInt(cmdOpts.limit),
        })

        if (opts.json) {
          output(data, true)
          return
        }

        const list = data.authors || data
        if (!Array.isArray(list) || list.length === 0) {
          console.log('  No authors found.')
          return
        }

        console.log(formatTable(
          list.map((a: any) => ({
            username: a.username,
            name: a.displayName || a.name || '-',
            projects: a.projectCount ?? '-',
          })),
          [
            { key: 'username', label: 'Username', width: 20 },
            { key: 'name', label: 'Name', width: 30 },
            { key: 'projects', label: 'Projects' },
          ]
        ))
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  discover
    .command('tags')
    .description('Browse popular tags')
    .action(async () => {
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        const data = await client.discoverTags()

        if (opts.json) {
          output(data, true)
          return
        }

        const list = data.tags || data
        if (!Array.isArray(list) || list.length === 0) {
          console.log('  No tags found.')
          return
        }

        for (const tag of list) {
          const name = typeof tag === 'string' ? tag : tag.name || tag.tag
          const count = typeof tag === 'object' && tag.count ? ` (${tag.count})` : ''
          console.log(`  ${name}${count}`)
        }
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })
}
