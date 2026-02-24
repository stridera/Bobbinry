import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { env } from '../lib/env'

// Connection configuration with security settings
const connectionString = env.DATABASE_URL

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
  prepare: true,              // Use prepared statements
  transform: postgres.camel,  // Convert snake_case to camelCase

  // Logging and monitoring (only in development)
  ...(process.env.NODE_ENV === 'development' && { onnotice: console.log }),

  // Error handling
  connection: {
    application_name: 'bobbinry-api',
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

// Health check function
export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    await client`SELECT 1`
    return true
  } catch (error) {
    console.error('Database health check failed:', error)
    return false
  }
}

// For cleanup/testing
export const closeConnection = () => client.end()