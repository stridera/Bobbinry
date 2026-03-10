/**
 * Disk Manifest Loader
 *
 * All runtime manifest reads go through this module. Disk YAML files are the
 * single source of truth for manifest content. The DB `manifestJson` column
 * exists only for version-history snapshots and SQL inspection — it is never
 * read at runtime for business logic.
 */

import { parse as parseYAML } from 'yaml'
import * as path from 'path'
import * as fs from 'fs/promises'

// In-memory cache of parsed disk manifests, keyed by bobbinId.
// Invalidated on server restart (which happens on every deploy).
const manifestCache = new Map<string, Record<string, any>>()
const PROJECT_ROOT = path.resolve(__dirname, '../../../..')

export async function loadDiskManifests(bobbinIds: string[]): Promise<Map<string, Record<string, any>>> {
  const uncached = bobbinIds.filter(id => !manifestCache.has(id))

  if (uncached.length > 0) {
    const results = await Promise.allSettled(
      uncached.map(async (bobbinId) => {
        const manifestPath = path.resolve(PROJECT_ROOT, `bobbins/${bobbinId}/manifest.yaml`)
        const content = await fs.readFile(manifestPath, 'utf-8')
        return { bobbinId, manifest: parseYAML(content) }
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        manifestCache.set(result.value.bobbinId, result.value.manifest)
      } else if (!(result.reason as NodeJS.ErrnoException)?.code?.startsWith('ENOENT')) {
        console.error('[DISK MANIFEST] Failed to read manifest from disk:', result.reason)
      }
    }
  }

  const out = new Map<string, Record<string, any>>()
  for (const id of bobbinIds) {
    const cached = manifestCache.get(id)
    if (cached) out.set(id, cached)
  }
  return out
}

/**
 * Discover all bobbins on disk and load their manifests into cache.
 * Used at startup and by consumers that iterate all bobbins without knowing IDs upfront.
 */
export async function loadAllDiskManifests(): Promise<Map<string, Record<string, any>>> {
  const bobbinsDir = path.resolve(PROJECT_ROOT, 'bobbins')
  const entries = await fs.readdir(bobbinsDir, { withFileTypes: true })
  const bobbinIds = entries.filter(e => e.isDirectory()).map(e => e.name)
  return loadDiskManifests(bobbinIds)
}

/**
 * Find which installed bobbin owns a collection by checking disk manifests.
 * Returns the bobbinId or null if not found.
 */
export async function findBobbinForCollection(
  bobbinIds: string[],
  collectionName: string
): Promise<string | null> {
  const manifests = await loadDiskManifests(bobbinIds)
  for (const [bobbinId, manifest] of manifests) {
    const collections = manifest.data?.collections || []
    if (collections.some((c: any) => c.name === collectionName)) {
      return bobbinId
    }
  }
  return null
}
