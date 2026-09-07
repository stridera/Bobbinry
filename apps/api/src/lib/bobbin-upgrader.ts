import { sql, eq } from 'drizzle-orm'
import { bobbinsInstalled, manifestsVersions } from '../db/schema'
import type { db as dbType } from '../db/connection'
import { UUID_RE } from './slugs'
import { moduleLogger } from './logger'

const log = moduleLogger('bobbin-upgrade')

export interface Migration {
  version: string
  description: string
  up: string
  down?: string
}

export interface UpgradeResult {
  bobbinId: string
  fromVersion: string
  toVersion: string
  migrationsRun: number
  success: boolean
  error?: string
}

type DB = typeof dbType


/**
 * Deterministic JSON string for deep comparison.
 * JSONB sorts keys alphabetically, so we do the same for the disk manifest.
 */
function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val
  )
}

/**
 * Compare two semver strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)
  const len = Math.max(partsA.length, partsB.length)

  for (let i = 0; i < len; i++) {
    const numA = partsA[i] ?? 0
    const numB = partsB[i] ?? 0
    if (numA < numB) return -1
    if (numA > numB) return 1
  }
  return 0
}

/**
 * Filter and sort migrations that need to run for an upgrade from `fromVersion`.
 * Returns migrations where migration.version > fromVersion, sorted ascending.
 */
export function getMigrationsToRun(migrations: Migration[], fromVersion: string): Migration[] {
  return migrations
    .filter(m => compareSemver(m.version, fromVersion) > 0)
    .sort((a, b) => compareSemver(a.version, b.version))
}

/**
 * Check if a bobbin needs upgrading and perform the upgrade in a transaction.
 * Returns null if no upgrade needed, or an UpgradeResult.
 */
export async function checkAndUpgradeBobbin(
  db: DB,
  installedRow: typeof bobbinsInstalled.$inferSelect,
  diskManifest: Record<string, any>,
  projectId: string
): Promise<UpgradeResult | null> {
  const installedVersion = installedRow.version
  const diskVersion = diskManifest.version as string

  if (!diskVersion || compareSemver(diskVersion, installedVersion) <= 0) {
    // Auto-sync DB manifest when content drifted without a version bump.
    // Runtime reads all go through disk now, but this keeps the DB copy fresh
    // for SQL inspection and future worker processes.
    if (diskVersion && compareSemver(diskVersion, installedVersion) === 0) {
      const diskStr = stableStringify(diskManifest)
      const dbStr = stableStringify(installedRow.manifestJson)
      if (diskStr !== dbStr) {
        log.info(`${installedRow.bobbinId}: syncing drifted manifest at version ${diskVersion}`)
        await db.update(bobbinsInstalled)
          .set({ manifestJson: diskManifest })
          .where(eq(bobbinsInstalled.id, installedRow.id))
      }
    }
    return null
  }

  const bobbinId = installedRow.bobbinId
  const startTime = Date.now()
  const migrations = getMigrationsToRun(
    (diskManifest.compatibility?.migrations as Migration[]) ?? [],
    installedVersion
  )

  const logCtx = `${bobbinId}: ${installedVersion} → ${diskVersion} (project: ${projectId})`

  try {
    await db.transaction(async (tx) => {
      // Snapshot old manifest into version history
      await tx.insert(manifestsVersions).values({
        bobbinId,
        version: installedVersion,
        manifestJson: installedRow.manifestJson
      }).onConflictDoNothing()

      // Run migrations
      if (migrations.length > 0) {
        if (!UUID_RE.test(projectId)) {
          throw new Error(`Invalid project ID format: ${projectId}`)
        }

        log.info(`${logCtx}`)
        for (let i = 0; i < migrations.length; i++) {
          const migration = migrations[i]!
          const migrationSql = migration.up.replaceAll('{{project_id}}', projectId)
          log.info(`  Migration ${i + 1}/${migrations.length}: "${migration.description}" — running`)

          // Safety: only allow whitelisted SQL statement types in bobbin migrations
          const firstWord = migrationSql.trimStart().split(/\s/)[0]?.toUpperCase()
          const allowedStatements = new Set(['CREATE', 'ALTER', 'DROP', 'INSERT', 'UPDATE', 'DELETE', 'WITH'])
          if (!firstWord || !allowedStatements.has(firstWord)) {
            throw new Error(`Disallowed SQL statement in migration: "${firstWord}..."`)
          }

          await tx.execute(sql.raw(migrationSql))

          log.info(`  Migration ${i + 1}/${migrations.length}: "${migration.description}" — OK`)
        }
      }

      // Update installed version and manifest
      await tx.update(bobbinsInstalled)
        .set({
          version: diskVersion,
          manifestJson: diskManifest,
          installedAt: new Date()
        })
        .where(eq(bobbinsInstalled.id, installedRow.id))
    })

    const elapsed = Date.now() - startTime
    if (migrations.length > 0) {
      log.info(`  Completed in ${elapsed}ms`)
    } else {
      log.info(`${logCtx} — no migrations, ${elapsed}ms`)
    }

    return {
      bobbinId,
      fromVersion: installedVersion,
      toVersion: diskVersion,
      migrationsRun: migrations.length,
      success: true
    }
  } catch (error: any) {
    log.error(`${logCtx}`)
    log.error(`  FAILED: ${error.message}`)
    log.error(`  Transaction rolled back. Project stays on ${installedVersion}`)

    return {
      bobbinId,
      fromVersion: installedVersion,
      toVersion: diskVersion,
      migrationsRun: 0,
      success: false,
      error: error.message
    }
  }
}
