import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env file from project root before any imports
try {
  const envPath = resolve(__dirname, '../.env')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex)
    const value = trimmed.slice(eqIndex + 1)
    process.env[key] ??= value
  }
} catch {
  // .env file not found, use defaults
}

// Test setup - env vars must be set before importing env module
process.env.NODE_ENV = 'test'

function deriveTestDatabaseUrl(baseUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error(`Invalid DATABASE_URL for tests: "${baseUrl}"`)
  }

  const dbName = parsed.pathname.replace(/^\//, '')
  if (!dbName) {
    throw new Error(`DATABASE_URL is missing a database name: "${baseUrl}"`)
  }

  const lowerDb = dbName.toLowerCase()
  if (lowerDb.includes('test')) {
    return baseUrl
  }

  const derivedName = lowerDb.endsWith('_dev')
    ? `${dbName.slice(0, -4)}_test`
    : `${dbName}_test`

  parsed.pathname = `/${derivedName}`
  return parsed.toString()
}

function getDatabaseName(databaseUrl: string): string | null {
  try {
    const parsed = new URL(databaseUrl)
    const dbName = parsed.pathname.replace(/^\//, '')
    return dbName || null
  } catch {
    return null
  }
}

function assertSafeTestDatabase(databaseUrl: string): void {
  const dbName = getDatabaseName(databaseUrl)
  if (!dbName) {
    throw new Error(
      `Unsafe DATABASE_URL for tests: "${databaseUrl}". ` +
      'Could not parse database name.'
    )
  }

  const lowerDb = dbName.toLowerCase()
  const looksLikeTestDb = lowerDb.includes('test')
  const knownUnsafe = ['bobbins', 'bobbins_dev', 'postgres']

  if (!looksLikeTestDb || knownUnsafe.includes(lowerDb)) {
    throw new Error(
      `Refusing to run tests against non-test database "${dbName}". ` +
      'Set DATABASE_URL to a dedicated test database (for example, bobbinry_test).'
    )
  }
}

const sourceDatabaseUrl =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://bobbinry:bobbinry@localhost:5432/bobbinry_test'

process.env.DATABASE_URL = deriveTestDatabaseUrl(sourceDatabaseUrl)
assertSafeTestDatabase(process.env.DATABASE_URL)
