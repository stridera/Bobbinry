/**
 * Migration Generator for Collection Definitions
 * 
 * Generates Drizzle migrations for bobbin collections
 */

import type { Collection, Field } from '@bobbinry/types'

export interface MigrationOptions {
  bobbinId: string
  projectId: string
  tier: 'tier1' | 'tier2'
}

/**
 * Generate a migration for a collection
 */
export function generateCollectionMigration(
  collection: Collection,
  options: MigrationOptions
): string {
  if (options.tier === 'tier1') {
    return generateTier1Migration(collection, options)
  } else {
    return generateTier2Migration(collection, options)
  }
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
 * Generate Tier 2 migration (physical table)
 * 
 * Tier 2 creates a dedicated physical table for high-performance
 * collections (>50K rows, P95 latency >200ms)
 */
function generateTier2Migration(
  collection: Collection,
  options: MigrationOptions
): string {
  const { bobbinId, projectId } = options
  
  // Generate table name
  const tableName = `${bobbinId}_${collection.name}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
  
  const lines: string[] = []
  lines.push(`-- Tier 2 Migration for collection: ${collection.name}`)
  lines.push(`-- Bobbin: ${bobbinId}`)
  lines.push(`-- Project: ${projectId}`)
  lines.push(`-- Storage: Physical table`)
  lines.push('')
  lines.push(`CREATE TABLE IF NOT EXISTS ${tableName} (`)
  lines.push(`  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),`)
  lines.push(`  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,`)
  
  // Generate columns for each field
  for (const field of collection.fields) {
    const columnDef = generateColumnDefinition(field)
    lines.push(`  ${field.name} ${columnDef},`)
  }
  
  // Metadata columns
  lines.push(`  created_at TIMESTAMP NOT NULL DEFAULT NOW(),`)
  lines.push(`  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),`)
  lines.push(`  last_edited_by UUID REFERENCES users(id),`)
  lines.push(`  last_edited_at TIMESTAMP`)
  lines.push(`);`)
  lines.push('')
  
  // Generate indexes
  lines.push(`-- Indexes for ${tableName}`)
  lines.push(`CREATE INDEX IF NOT EXISTS idx_${tableName}_project_id ON ${tableName}(project_id);`)
  lines.push(`CREATE INDEX IF NOT EXISTS idx_${tableName}_updated_at ON ${tableName}(updated_at DESC);`)
  lines.push('')
  
  // Indexes for searchable/sortable fields
  const indexableFields = collection.fields.filter(f => 
    f.hints?.searchable || f.hints?.sortable
  )
  
  for (const field of indexableFields) {
    const indexName = `idx_${tableName}_${field.name}`.substring(0, 63)
    const indexType = field.type === 'text' && field.hints?.searchable ? 'GIN' : 'BTREE'
    
    if (field.type === 'text' && field.hints?.searchable) {
      // Full-text search index
      lines.push(`CREATE INDEX IF NOT EXISTS ${indexName}_fts`)
      lines.push(`  ON ${tableName} USING GIN (to_tsvector('english', ${field.name}));`)
    } else {
      // Regular B-tree index
      lines.push(`CREATE INDEX IF NOT EXISTS ${indexName}`)
      lines.push(`  ON ${tableName} USING ${indexType} (${field.name});`)
    }
    lines.push('')
  }
  
  // Create trigger for updated_at
  lines.push(`-- Auto-update updated_at timestamp`)
  lines.push(`CREATE OR REPLACE FUNCTION update_${tableName}_updated_at()`)
  lines.push(`RETURNS TRIGGER AS $$`)
  lines.push(`BEGIN`)
  lines.push(`  NEW.updated_at = NOW();`)
  lines.push(`  RETURN NEW;`)
  lines.push(`END;`)
  lines.push(`$$ LANGUAGE plpgsql;`)
  lines.push('')
  lines.push(`CREATE TRIGGER trigger_${tableName}_updated_at`)
  lines.push(`  BEFORE UPDATE ON ${tableName}`)
  lines.push(`  FOR EACH ROW`)
  lines.push(`  EXECUTE FUNCTION update_${tableName}_updated_at();`)
  lines.push('')
  
  return lines.join('\n')
}

/**
 * Generate SQL column definition from field spec
 */
function generateColumnDefinition(field: Field): string {
  let sqlType: string
  
  switch (field.type) {
    case 'text':
    case 'text':
      sqlType = field.validation?.max ? `VARCHAR(${field.validation.max})` : 'TEXT'
      break
    case 'number':
      sqlType = 'NUMERIC'
      break
    case 'boolean':
      sqlType = 'BOOLEAN'
      break
    case 'date':
      sqlType = 'DATE'
      break
    case 'datetime':
      sqlType = 'TIMESTAMP'
      break
    case 'reference':
      sqlType = 'UUID'
      break
    case 'json':
      sqlType = 'JSONB'
      break
    case 'rich_text':
      sqlType = 'TEXT'
      break
    case 'image':
    case 'file':
      sqlType = 'TEXT' // Store URL/path
      break
    default:
      sqlType = 'TEXT'
  }
  
  // Add constraints
  const constraints: string[] = []
  
  if (field.required) {
    constraints.push('NOT NULL')
  }
  
  // Unique constraints would need to be defined in hints or validation
  // For now, we don't support unique constraint in Field type
  
  if (field.default !== undefined) {
    if (typeof field.default === 'string') {
      constraints.push(`DEFAULT '${field.default}'`)
    } else if (typeof field.default === 'boolean') {
      constraints.push(`DEFAULT ${field.default}`)
    } else if (typeof field.default === 'number') {
      constraints.push(`DEFAULT ${field.default}`)
    }
  }
  
  return `${sqlType}${constraints.length > 0 ? ' ' + constraints.join(' ') : ''}`
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
