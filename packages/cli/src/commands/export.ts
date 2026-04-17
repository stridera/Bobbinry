import { Command } from 'commander'
import { writeFileSync } from 'node:fs'
import { createClient, getGlobalOpts } from '../cli.js'
import { output } from '../lib/output.js'
import { handleError, CliError } from '../lib/errors.js'

const VALID_FORMATS = ['pdf', 'epub', 'txt', 'markdown', 'json', 'html']

export function registerExportCommand(program: Command): void {
  program
    .command('export')
    .description('Export a project')
    .argument('<project-id>', 'Project ID')
    .argument('<format>', `Export format (${VALID_FORMATS.join(', ')})`)
    .option('-o, --output <path>', 'Output file path (default: <project-id>.<format>)')
    .action(async (projectId: string, format: string, cmdOpts: { output?: string }) => {
      const opts = getGlobalOpts()
      try {
        if (!VALID_FORMATS.includes(format)) {
          throw new CliError(
            `Invalid format: ${format}`,
            'INVALID_FORMAT',
            `Valid formats: ${VALID_FORMATS.join(', ')}`
          )
        }

        const client = createClient(opts)
        const res = await client.exportProject(projectId, format)

        const ext = format === 'markdown' ? 'md' : format
        const outPath = cmdOpts.output || `${projectId}.${ext}`

        const buffer = Buffer.from(await res.arrayBuffer())
        writeFileSync(outPath, buffer)

        if (opts.json) {
          output({ success: true, path: outPath, size: buffer.length, format }, true)
          return
        }

        console.log(`  Exported to ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })
}
