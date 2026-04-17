import { Command } from 'commander'
import { createClient, getGlobalOpts } from '../cli.js'
import { output, formatTable, timeAgo, shortId } from '../lib/output.js'
import { handleError } from '../lib/errors.js'

export function registerProjectsCommand(program: Command): void {
  const projects = program
    .command('projects')
    .description('Manage projects')
    .action(async () => {
      // Default: list projects
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        const data = await client.listProjects()
        const list = data.projects || data

        if (opts.json) {
          output(data, true)
          return
        }

        if (!Array.isArray(list) || list.length === 0) {
          console.log('  No projects found.')
          return
        }

        console.log(formatTable(
          list.map((p: any) => ({
            id: shortId(p.id),
            name: p.name,
            updated: timeAgo(p.updatedAt),
          })),
          [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name', width: 40 },
            { key: 'updated', label: 'Updated' },
          ]
        ))
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  projects
    .command('get')
    .description('Get project details')
    .argument('<id>', 'Project ID')
    .action(async (id: string) => {
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        const data = await client.getProject(id)

        if (opts.json) {
          output(data, true)
          return
        }

        const p = data.project || data
        console.log(`  Name:        ${p.name}`)
        console.log(`  ID:          ${p.id}`)
        if (p.description) console.log(`  Description: ${p.description}`)
        console.log(`  Created:     ${new Date(p.createdAt).toLocaleDateString()}`)
        console.log(`  Updated:     ${timeAgo(p.updatedAt)}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  projects
    .command('create')
    .description('Create a new project')
    .argument('<name>', 'Project name')
    .option('-d, --description <desc>', 'Project description')
    .action(async (name: string, cmdOpts: { description?: string }) => {
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        const data = await client.createProject(name, cmdOpts.description)

        if (opts.json) {
          output(data, true)
          return
        }

        const p = data.project || data
        console.log(`  Created project: ${p.name}`)
        console.log(`  ID: ${p.id}`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })

  projects
    .command('bobbins')
    .description('List installed bobbins for a project')
    .argument('<id>', 'Project ID')
    .action(async (id: string) => {
      const opts = getGlobalOpts()
      try {
        const client = createClient(opts)
        const data = await client.getProjectBobbins(id)

        if (opts.json) {
          output(data, true)
          return
        }

        const list = data.bobbins || data
        if (!Array.isArray(list) || list.length === 0) {
          console.log('  No bobbins installed.')
          return
        }

        console.log(formatTable(
          list.map((b: any) => ({
            id: b.bobbinId || b.id,
            name: b.name || b.bobbinId || b.id,
            version: b.version || '-',
          })),
          [
            { key: 'id', label: 'ID', width: 25 },
            { key: 'name', label: 'Name', width: 30 },
            { key: 'version', label: 'Version' },
          ]
        ))
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })
}
