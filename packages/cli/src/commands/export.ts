import { Command } from 'commander'
import { writeFileSync } from 'node:fs'
import { EXPORT_FORMATS, EXPORT_MODES } from '@bobbinry/types'
import { createClient, getGlobalOpts } from '../cli.js'
import { output } from '../lib/output.js'
import { handleError, CliError } from '../lib/errors.js'

/** Download extension per format — only markdown differs from its format name. */
const EXTENSIONS: Record<string, string> = {
  markdown: 'md',
}

export function registerExportCommand(program: Command): void {
  program
    .command('export')
    .description('Export a project')
    .argument('<project-id>', 'Project ID')
    .argument('<format>', `Export format (${EXPORT_FORMATS.join(', ')})`)
    .option('-m, --mode <mode>', `What to export (${EXPORT_MODES.join(', ')})`, 'full')
    .option('-o, --output <path>', 'Output file path (default: <project-id>.<format>)')
    .action(async (projectId: string, format: string, cmdOpts: { output?: string; mode?: string }) => {
      const opts = getGlobalOpts()
      try {
        if (!EXPORT_FORMATS.includes(format as never)) {
          throw new CliError(
            `Invalid format: ${format}`,
            'INVALID_FORMAT',
            `Valid formats: ${EXPORT_FORMATS.join(', ')}`
          )
        }

        const mode = cmdOpts.mode || 'full'
        if (!EXPORT_MODES.includes(mode as never)) {
          throw new CliError(
            `Invalid mode: ${mode}`,
            'INVALID_MODE',
            `Valid modes: ${EXPORT_MODES.join(', ')}`
          )
        }

        const client = createClient(opts)
        const res = await client.exportProject(projectId, format, mode)

        // `chapters` mode always returns a ZIP regardless of format; the other
        // modes return the format's own file, with outline suffixed for clarity.
        const ext = mode === 'chapters' ? 'zip' : (EXTENSIONS[format] || format)
        const suffix = mode === 'chapters' ? '-chapters' : mode === 'outline' ? '-outline' : ''
        const outPath = cmdOpts.output || `${projectId}${suffix}.${ext}`

        const buffer = Buffer.from(await res.arrayBuffer())
        writeFileSync(outPath, buffer)

        if (opts.json) {
          output({ success: true, path: outPath, size: buffer.length, format, mode }, true)
          return
        }

        console.log(`  Exported to ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`)
      } catch (err) {
        handleError(err, !!opts.json)
      }
    })
}
