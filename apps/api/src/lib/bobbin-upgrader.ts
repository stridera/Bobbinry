import { sql, eq } from 'drizzle-orm'
import { bobbinsInstalled, manifestsVersions } from '../db/schema'
import type { db as dbType } from '../db/connection'

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
    // Warn if manifest content drifted without a version bump (helps diagnose stale-manifest bugs)
    if (diskVersion && compareSemver(diskVersion, installedVersion) === 0) {
      const diskStr = stableStringify(diskManifest)
      const dbStr = stableStringify(installedRow.manifestJson)
      if (diskStr !== dbStr) {
        console.warn(
          `[BOBBIN UPGRADE] ${installedRow.bobbinId}: manifest on disk differs from DB at same version ${diskVersion} — bump the version to apply changes`
        )
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

        console.log(`[BOBBIN UPGRADE] ${logCtx}`)
        for (let i = 0; i < migrations.length; i++) {
          const migration = migrations[i]!
          const migrationSql = migration.up.replaceAll('{{project_id}}', projectId)
          console.log(`  Migration ${i + 1}/${migrations.length}: "${migration.description}" — running`)

          // Safety: only allow whitelisted SQL statement types in bobbin migrations
          const firstWord = migrationSql.trimStart().split(/\s/)[0]?.toUpperCase()
          const allowedStatements = new Set(['CREATE', 'ALTER', 'DROP', 'INSERT', 'UPDATE', 'DELETE', 'WITH'])
          if (!firstWord || !allowedStatements.has(firstWord)) {
            throw new Error(`Disallowed SQL statement in migration: "${firstWord}..."`)
          }

          await tx.execute(sql.raw(migrationSql))

          console.log(`  Migration ${i + 1}/${migrations.length}: "${migration.description}" — OK`)
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
      console.log(`  Completed in ${elapsed}ms`)
    } else {
      console.log(`[BOBBIN UPGRADE] ${logCtx} — no migrations, ${elapsed}ms`)
    }

    return {
      bobbinId,
      fromVersion: installedVersion,
      toVersion: diskVersion,
      migrationsRun: migrations.length,
      success: true
    }
  } catch (error: any) {
    console.error(`[BOBBIN UPGRADE] ${logCtx}`)
    console.error(`  FAILED: ${error.message}`)
    console.error(`  Transaction rolled back. Project stays on ${installedVersion}`)

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
