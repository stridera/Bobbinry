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
const BOBBINS_DIR = path.resolve(PROJECT_ROOT, 'bobbins')

export function getCanonicalManifestPath(bobbinId: string): string {
  return path.resolve(BOBBINS_DIR, bobbinId, 'manifest.yaml')
}

export function normalizeManifestPathInput(manifestPath: string): string {
  const legacyMatch = manifestPath.match(/^bobbins\/([a-z0-9-]+)\.manifest\.ya?ml$/i)
  if (legacyMatch) {
    return `bobbins/${legacyMatch[1]}/manifest.yaml`
  }
  return manifestPath
}

/**
 * Result of a sandboxed manifest load. Either succeeds with content + format,
 * or returns a status + error suitable for `reply.status(...).send(...)`.
 */
export type LoadManifestResult =
  | { ok: true; content: string; type: 'yaml' | 'json' }
  | { ok: false; status: number; error: string; message?: string }

/**
 * Safely load a manifest from a user-supplied path, restricted to the
 * `bobbins/` directory. Resolves symlinks via `fs.realpath` (no silent
 * fallback) and reads from the canonical realpath to eliminate TOCTOU
 * windows where the file could be swapped between validation and read.
 *
 * Callers should propagate the returned status/error directly.
 */
export async function loadManifestFromBobbinsPath(manifestPath: string): Promise<LoadManifestResult> {
  const normalizedManifestPath = normalizeManifestPathInput(manifestPath)
  const fullPath = path.resolve(PROJECT_ROOT, normalizedManifestPath)

  // Resolve symlinks. If realpath fails (ENOENT, EACCES, ELOOP), reject —
  // never fall back to the raw user-supplied path.
  let realPath: string
  try {
    realPath = await fs.realpath(fullPath)
  } catch {
    return {
      ok: false,
      status: 404,
      error: 'Manifest file not found',
      message: 'The manifest path could not be resolved on disk',
    }
  }

  // Confine to BOBBINS_DIR. The trailing separator prevents `bobbinsXX/...`
  // sibling-prefix bypasses.
  if (realPath !== BOBBINS_DIR && !realPath.startsWith(BOBBINS_DIR + path.sep)) {
    return {
      ok: false,
      status: 403,
      error: 'Access denied',
      message: 'Manifest path must be within the bobbins directory',
    }
  }

  // Read via the validated realpath, not the user-supplied fullPath, so a
  // symlink swap between realpath() and readFile() can't escape the sandbox.
  let content: string
  try {
    content = await fs.readFile(realPath, 'utf-8')
  } catch (err: any) {
    return {
      ok: false,
      status: 400,
      error: 'Failed to read manifest file',
      message: err?.message ?? 'Unknown error',
    }
  }

  const type: 'yaml' | 'json' =
    normalizedManifestPath.endsWith('.yaml') || normalizedManifestPath.endsWith('.yml') ? 'yaml' : 'json'

  return { ok: true, content, type }
}

export async function loadDiskManifests(bobbinIds: string[]): Promise<Map<string, Record<string, any>>> {
  const uncached = bobbinIds.filter(id => !manifestCache.has(id))

  if (uncached.length > 0) {
    const results = await Promise.allSettled(
      uncached.map(async (bobbinId) => {
        const manifestPath = getCanonicalManifestPath(bobbinId)
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
  const entries = await fs.readdir(BOBBINS_DIR, { withFileTypes: true })
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

/**
 * Get the supported installation scopes from a manifest.
 * Defaults to ['project'] when the install field is omitted.
 */
export function getManifestScopes(manifest: Record<string, any>): string[] {
  return manifest.install?.scopes || ['project']
}

/**
 * Find a bobbin for a collection across multiple scopes, with priority ordering.
 * Returns the bobbinId and scope info for the first match (project > collection > global).
 */
export async function findBobbinForCollectionAcrossScopes(
  effectiveBobbins: Array<{ bobbinId: string; scope: string; scopeOwnerId: string }>,
  collectionName: string
): Promise<{ bobbinId: string; scope: string; scopeOwnerId: string } | null> {
  const bobbinIds = effectiveBobbins.map(b => b.bobbinId)
  const manifests = await loadDiskManifests(bobbinIds)

  // effectiveBobbins is already in priority order (project > collection > global)
  for (const eb of effectiveBobbins) {
    const manifest = manifests.get(eb.bobbinId)
    if (!manifest) continue
    const collections = manifest.data?.collections || []
    if (collections.some((c: any) => c.name === collectionName)) {
      return eb
    }
  }
  return null
}
