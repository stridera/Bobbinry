import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Connection configuration
const connectionString = process.env.DATABASE_URL || 'postgres://bobbinry:bobbinry@localhost:5432/bobbinry'

// Create postgres client
const client = postgres(connectionString, {
  max: 10, // Connection pool size
  idle_timeout: 20,
  connect_timeout: 10
})

// Create drizzle instance
export const db = drizzle(client, { schema })

// For cleanup/testing
export const closeConnection = () => client.end()