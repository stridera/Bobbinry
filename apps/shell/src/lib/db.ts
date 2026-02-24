import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { pgTable, uuid, text, timestamp, jsonb, varchar, index } from 'drizzle-orm/pg-core'

// Database schema - entities table for Tier 1 JSONB storage
export const entities = pgTable('entities', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull(),
  bobbinId: varchar('bobbin_id', { length: 255 }).notNull(),
  collectionName: varchar('collection_name', { length: 255 }).notNull(),
  entityData: jsonb('entity_data').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  projectCollectionIdx: index('entities_project_collection_idx').on(table.projectId, table.collectionName)
}))

const schema = { entities }

// Connection configuration
import { env } from './env'

const connectionString = env.DATABASE_URL

// Create postgres client
const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: process.env.NODE_ENV === 'production' ? 'require' : false,
  prepare: true,
  transform: postgres.camel
})

// Create drizzle instance
export const db = drizzle(client, { schema })
