import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { env } from '../lib/env'

/**
 * Run database migrations
 * This should be called on server startup to ensure the database schema is up to date
 */
export async function runMigrations() {
  const connectionString = env.DATABASE_URL
  
  // Create a dedicated connection for migrations
  const migrationClient = postgres(connectionString, { max: 1 })
  const db = drizzle(migrationClient)

  try {
    console.log('Running database migrations...')
    await migrate(db, { migrationsFolder: '../../infra/db/migrations' })
    console.log('Migrations completed successfully')
  } catch (error) {
    console.error('Migration failed:', error)
    throw error
  } finally {
    await migrationClient.end()
  }
}
