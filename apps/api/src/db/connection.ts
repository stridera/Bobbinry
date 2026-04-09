import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { env } from '../lib/env'

// Connection configuration with security settings
const connectionString = env.DATABASE_URL

// Detect Neon pooler (transaction-mode PgBouncer) from the connection string
const isPooledConnection = connectionString.includes('-pooler.')

// Create postgres client with comprehensive security
const client = postgres(connectionString, {
  // Connection pool settings
  max: 20,                    // Maximum connections
  idle_timeout: 20,           // Close idle connections after 20s
  max_lifetime: 60 * 30,      // Close connections after 30 minutes
  connect_timeout: 10,        // Connection timeout in seconds

  // Security settings
  ssl: process.env.NODE_ENV === 'production' ? 'require' : false,

  // Performance and reliability
  // Prepared statements are incompatible with Neon's transaction-mode pooler
  prepare: !isPooledConnection,
  transform: {
    column: postgres.camel.column,  // Convert column names only (not JSONB content)
  },

  // Logging and monitoring (only in development)
  ...(process.env.NODE_ENV === 'development' && { onnotice: console.log }),

  // Error handling
  connection: {
    application_name: 'bobbinry-api',
    timezone: 'UTC',                                // Ensure timestamps are stored/read as UTC
    statement_timeout: 30000,     // 30 seconds in milliseconds
    idle_in_transaction_session_timeout: 60000  // 60 seconds in milliseconds
  }
})

// Create drizzle instance
export const db = drizzle(client, { schema })

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}, closing database connections...`)
  try {
    await client.end()
    console.log('Database connections closed successfully')
    process.exit(0)
  } catch (error) {
    console.error('Error closing database connections:', error)
    process.exit(1)
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')) // Nodemon restart

// ─── Health check + self-healing on stuck pool ──────────────────────
//
// The `/health` endpoint on Fastify calls this function. Fly's HTTP
// health check has a 5s timeout, but without an internal timeout the
// underlying `client\`SELECT 1\`` can hang arbitrarily long (we've seen
// >13s) when `postgres-js` gets into a stuck-pool state, during which
// the machine is serving traffic that all 500s out because every query
// times out.
//
// Two guards:
//
//  1. A 3s Promise.race timeout so this function always returns within
//     ~3s. That gives Fly's check a fast, deterministic result.
//  2. A consecutive-failure counter that triggers `process.exit(1)`
//     after `MAX_CONSECUTIVE_HEALTH_FAILURES` failures in a row. Fly's
//     default behavior is to restart exited machines, and a fresh
//     machine rebuilds the connection pool from scratch — which is
//     exactly what manual intervention did during the 2026-04-09 incident
//     (see `infra/post-mortems/2026-04-09-env-validator-crash-loop.md`).
//     With the 30s check interval, 3 consecutive failures = ~90s of
//     confirmed unhealthiness before we self-heal.
const HEALTH_CHECK_TIMEOUT_MS = 3000
const MAX_CONSECUTIVE_HEALTH_FAILURES = 3
let consecutiveHealthFailures = 0

export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    await Promise.race([
      client`SELECT 1`,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`health check query timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`)),
          HEALTH_CHECK_TIMEOUT_MS
        )
      ),
    ])
    if (consecutiveHealthFailures > 0) {
      console.log(`[db] health check recovered after ${consecutiveHealthFailures} consecutive failures`)
    }
    consecutiveHealthFailures = 0
    return true
  } catch (error) {
    consecutiveHealthFailures++
    console.error(
      `[db] health check failed (${consecutiveHealthFailures}/${MAX_CONSECUTIVE_HEALTH_FAILURES}):`,
      error instanceof Error ? error.message : error
    )
    if (consecutiveHealthFailures >= MAX_CONSECUTIVE_HEALTH_FAILURES) {
      console.error(
        `[db] ${consecutiveHealthFailures} consecutive health check failures — exiting so Fly can restart the machine with a fresh connection pool`
      )
      // Give the log line a chance to flush before the process dies.
      setTimeout(() => process.exit(1), 500)
    }
    return false
  }
}

// For cleanup/testing
export const closeConnection = () => client.end()