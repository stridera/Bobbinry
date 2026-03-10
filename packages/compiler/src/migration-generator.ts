/**
 * Migration Generator for Collection Definitions
 * 
 * Generates Drizzle migrations for bobbin collections
 */

import type { Collection, Field } from '@bobbinry/types'

export interface MigrationOptions {
  bobbinId: string
  projectId: string
}

/**
 * Generate a migration for a collection (JSONB storage)
 */
export function generateCollectionMigration(
  collection: Collection,
  options: MigrationOptions
): string {
  return generateTier1Migration(collection, options)
}

/**
 * Generate Tier 1 migration (JSONB in entities table)
 * 
 * Tier 1 uses the unified entities table with JSONB storage
 * No additional tables created, but we may need indexes
 */
function generateTier1Migration(
  collection: Collection,
  options: MigrationOptions
): string {
  const { bobbinId, projectId } = options
  
  const lines: string[] = []
  lines.push(`-- Tier 1 Migration for collection: ${collection.name}`)
  lines.push(`-- Bobbin: ${bobbinId}`)
  lines.push(`-- Project: ${projectId}`)
  lines.push(`-- Storage: JSONB in entities table`)
  lines.push('')
  lines.push(`-- No physical table needed - uses entities.entity_data JSONB column`)
  lines.push('')
  
  // Generate indexes for searchable/sortable fields
  const indexableFields = collection.fields.filter(f => 
    f.hints?.searchable || f.hints?.sortable
  )
  
  if (indexableFields.length > 0) {
    lines.push(`-- Add indexes for performance`)
    lines.push(`-- Note: These are GIN indexes on JSONB paths`)
    lines.push('')
    
    for (const field of indexableFields) {
      const indexName = `idx_${projectId}_${bobbinId}_${collection.name}_${field.name}`
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .substring(0, 63) // PostgreSQL identifier limit
      
      lines.push(`CREATE INDEX IF NOT EXISTS ${indexName}`)
      lines.push(`  ON entities USING GIN ((entity_data->'${field.name}'))`)
      lines.push(`  WHERE project_id = '${projectId}'`)
      lines.push(`    AND bobbin_id = '${bobbinId}'`)
      lines.push(`    AND collection_name = '${collection.name}';`)
      lines.push('')
    }
  }
  
  lines.push(`-- Collection '${collection.name}' ready for use in Tier 1`)
  return lines.join('\n')
}

/**
 * Generate Drizzle schema code for a collection
 * This is used for TypeScript type generation
 */
export function generateDrizzleSchema(
  collection: Collection,
  tableName: string
): string {
  const lines: string[] = []
  
  lines.push(`import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, numeric } from 'drizzle-orm/pg-core'`)
  lines.push('')
  lines.push(`export const ${tableName} = pgTable('${tableName}', {`)
  lines.push(`  id: uuid('id').primaryKey().defaultRandom(),`)
  lines.push(`  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),`)
  
  for (const field of collection.fields) {
    const drizzleType = getDrizzleType(field)
    lines.push(`  ${field.name}: ${drizzleType},`)
  }
  
  lines.push(`  createdAt: timestamp('created_at').notNull().defaultNow(),`)
  lines.push(`  updatedAt: timestamp('updated_at').notNull().defaultNow(),`)
  lines.push(`  lastEditedBy: uuid('last_edited_by').references(() => users.id),`)
  lines.push(`  lastEditedAt: timestamp('last_edited_at')`)
  lines.push(`})`)
  
  return lines.join('\n')
}

function getDrizzleType(field: Field): string {
  let type: string
  
  switch (field.type) {
    case 'text':
    case 'rich_text':
    case 'markdown':
    case 'image':
    case 'file':
      type = `text('${field.name}')`
      break
    case 'number':
      type = `numeric('${field.name}')`
      break

    case 'boolean':
      type = `boolean('${field.name}')`
      break
    case 'date':
    case 'datetime':
      type = `timestamp('${field.name}')`
      break
    case 'reference':
      type = `uuid('${field.name}')`
      break
    case 'json':
      type = `jsonb('${field.name}')`
      break
    default:
      type = `text('${field.name}')`
  }
  
  if (field.required) {
    type += '.notNull()'
  }
  
  if (field.default !== undefined) {
    if (typeof field.default === 'string') {
      type += `.default('${field.default}')`
    } else {
      type += `.default(${field.default})`
    }
  }
  
  return type
}
