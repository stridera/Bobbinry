#!/usr/bin/env bun
/**
 * generate-native-view-map.ts
 *
 * Scans all native bobbins in the workspace and generates the NATIVE_VIEW_MAP
 * used by native-view-loader.ts. This ensures the static import map stays in
 * sync with bobbin manifests automatically.
 *
 * Key format convention (must match how ExtensionProvider registers views):
 *   - Views (ui.views):       "${bobbinId}.${view.id}"     → import("${pkg}/views/${view.id}")
 *   - Panels (contributions):  "${bobbinId}.${entry}"       → import("${pkg}/${entry}")
 *
 * Usage:
 *   bun run apps/shell/scripts/generate-native-view-map.ts
 *
 * Or via the shell's package.json script:
 *   bun run generate:views
 */

import { readdir, readFile, writeFile, access } from 'fs/promises'
import { join, resolve } from 'path'
import { parse as parseYAML } from 'yaml'

const BOBBINS_DIR = resolve(import.meta.dirname, '../../../bobbins')
const OUTPUT_FILE = resolve(import.meta.dirname, '../src/lib/native-view-map.generated.ts')

interface ViewEntry {
  key: string       // e.g. "manuscript.outline"
  importPath: string // e.g. "@bobbinry/manuscript/views/outline"
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function main() {
  const entries: ViewEntry[] = []
  const bobbinDirs = await readdir(BOBBINS_DIR)

  for (const dir of bobbinDirs) {
    const manifestPath = join(BOBBINS_DIR, dir, 'manifest.yaml')
    const pkgJsonPath = join(BOBBINS_DIR, dir, 'package.json')

    // Must have both a manifest and a package.json (workspace package)
    if (!await fileExists(manifestPath) || !await fileExists(pkgJsonPath)) {
      continue
    }

    const manifestContent = await readFile(manifestPath, 'utf-8')
    const manifest = parseYAML(manifestContent)

    // Only process native bobbins
    if (manifest.execution?.mode !== 'native') {
      continue
    }

    const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'))
    const pkgName = pkgJson.name as string // e.g. "@bobbinry/manuscript"
    const bobbinId = manifest.id as string

    console.log(`  ${bobbinId} (${pkgName})`)

    // Collect views from ui.views[]
    // Key uses view.id (NOT view.source — source may be a data collection name).
    // Import path is always views/<view.id> since that's where component files live.
    if (manifest.ui?.views) {
      for (const view of manifest.ui.views) {
        if (!view.id) continue

        const viewId = view.id as string
        entries.push({
          key: `${bobbinId}.${viewId}`,
          importPath: `${pkgName}/views/${viewId}`,
        })
        console.log(`    view: ${viewId}`)
      }
    }

    // Collect panels from extensions.contributions[]
    // Key and import both use contribution.entry (already a file path like "panels/navigation").
    if (manifest.extensions?.contributions) {
      for (const contrib of manifest.extensions.contributions) {
        if (contrib.entry && contrib.type === 'panel') {
          const entry = contrib.entry as string
          const key = `${bobbinId}.${entry}`

          // Avoid duplicates (a view might be listed in both places)
          if (!entries.some(e => e.key === key)) {
            entries.push({
              key,
              importPath: `${pkgName}/${entry}`,
            })
            console.log(`    panel: ${entry}`)
          }
        }
      }
    }
  }

  // Generate the TypeScript file
  const lines = [
    '/**',
    ' * AUTO-GENERATED — do not edit manually.',
    ' * Run `bun run generate:views` to regenerate from bobbin manifests.',
    ' */',
    '',
    '// Static import map for native bobbin views.',
    '// Next.js/webpack requires static strings in import() calls, so this map',
    '// must be generated at build time rather than constructed dynamically.',
    'export const NATIVE_VIEW_MAP: Record<string, () => Promise<any>> = {',
  ]

  for (const entry of entries) {
    lines.push(`  '${entry.key}': () => import('${entry.importPath}'),`)
  }

  lines.push('}')
  lines.push('')

  const output = lines.join('\n')
  await writeFile(OUTPUT_FILE, output)

  console.log(`\nGenerated ${entries.length} view entries → ${OUTPUT_FILE}`)
}

console.log('Scanning native bobbins...\n')
main().catch((err) => {
  console.error('Failed to generate native view map:', err)
  process.exit(1)
})
