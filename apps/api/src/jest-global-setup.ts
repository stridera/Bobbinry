import { readFileSync } from 'fs'
import { resolve } from 'path'
import { execFileSync } from 'child_process'

/**
 * Jest globalSetup — runs once before all test suites.
 * Verifies the test database exists and is reachable.
 */
export default async function globalSetup() {
  process.env.NODE_ENV = 'test'

  // Load .env the same way test-setup.ts does
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
    // .env file not found
  }

  // Derive the test database URL (same logic as test-setup.ts)
  const sourceUrl =
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://bobbinry:bobbinry@localhost:5432/bobbinry_test'

  let parsed: URL
  try {
    parsed = new URL(sourceUrl)
  } catch {
    throw new Error(`Invalid DATABASE_URL: "${sourceUrl}"`)
  }

  const dbName = parsed.pathname.replace(/^\//, '')
  const lowerDb = dbName.toLowerCase()
  if (!lowerDb.includes('test')) {
    const derivedName = lowerDb.endsWith('_dev')
      ? `${dbName.slice(0, -4)}_test`
      : `${dbName}_test`
    parsed.pathname = `/${derivedName}`
  }

  const testUrl = parsed.toString()
  const testDbName = parsed.pathname.replace(/^\//, '')
  process.env.DATABASE_URL = testUrl

  // Try to connect — dynamic import to avoid pulling in postgres at module level
  const { default: postgres } = await import('postgres')
  const sql = postgres(testUrl, { max: 1, connect_timeout: 5 })

  try {
    await sql`SELECT 1`
  } catch (err: any) {
    const code = err?.code
    const connInfo = `  URL: ${testUrl}`

    if (code === '3D000') {
      throw new Error(
        `Test database "${testDbName}" does not exist.\n\n` +
        `Create it and push the schema:\n` +
        `  createdb ${testDbName}\n` +
        `  cd apps/api && DATABASE_URL="${testUrl}" bunx drizzle-kit push\n\n` +
        connInfo
      )
    }

    throw new Error(
      `Cannot connect to test database "${testDbName}".\n\n` +
      `Error: ${err?.message || err}\n` +
      connInfo
    )
  } finally {
    await sql.end()
  }

  // Keep the disposable test database schema aligned with the current code.
  // Use `push` instead of migrations because the test DB may be recreated or
  // manually altered outside the migration journal.
  execFileSync(
    'bunx',
    ['drizzle-kit', 'push', '--config', 'drizzle.config.ts', '--force'],
    {
      cwd: resolve(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: testUrl,
      },
      stdio: 'inherit'
    }
  )
}
