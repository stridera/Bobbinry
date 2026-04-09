/**
 * Type definitions for the Entities bobbin
 */

export type FieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'multi-select'
  | 'boolean'
  | 'date'
  | 'json'
  | 'rich-text'
  | 'image'
  | 'relation'

export type LayoutTemplate = 'compact-card' | 'hero-image' | 'list-details' | 'custom'

export type ImagePosition = 'top-right' | 'top-full-width' | 'left-sidebar' | 'none'

export type ImageSize = 'small' | 'medium' | 'large'

export type SectionDisplay = 'inline' | 'stacked' | 'json-editor' | 'rich-text'

// JSON schema types for structured data fields
export type JsonSchemaFieldType = 'text' | 'number' | 'boolean' | 'select'

export interface JsonSchemaField {
  type: JsonSchemaFieldType
  label?: string           // Human-readable label; defaults to humanized key
  default?: any
  options?: string[]       // For select type
  min?: number             // For number type
  max?: number             // For number type
}

export type JsonSchemaMode = 'object' | 'list' | 'keyed-list'

export interface JsonSchema {
  mode: JsonSchemaMode
  fields: Record<string, JsonSchemaField>
  keyLabel?: string          // For keyed-list: label of the key column (e.g., "Level")
  keyType?: 'text' | 'number'  // For keyed-list: type of key (defaults to text)
  itemLabel?: string         // For list/keyed-list: singular label (e.g., "Ability")
}

export interface FieldDefinition {
  name: string
  type: FieldType
  label: string
  required?: boolean
  default?: any
  options?: string[]  // For select/multi-select
  min?: number  // For number
  max?: number  // For number
  multiline?: boolean  // For text type
  schema?: JsonSchema | Record<string, string>  // For json type
  targetEntityType?: string  // For relation: typeId of the target entity type
  allowMultiple?: boolean  // For relation: if true, stores array of IDs
}

/** Normalize old Record<string,string> schema format to JsonSchema */
export function normalizeJsonSchema(
  raw: JsonSchema | Record<string, string> | undefined
): JsonSchema | undefined {
  if (!raw) return undefined
  if ('mode' in raw) return raw as JsonSchema
  // Old format: Record<string, string> where value is a type name
  const fields: Record<string, JsonSchemaField> = {}
  for (const [key, typeStr] of Object.entries(raw)) {
    fields[key] = {
      type: (['number', 'boolean', 'select'].includes(typeStr) ? typeStr : 'text') as JsonSchemaFieldType,
      label: key.charAt(0).toUpperCase() + key.slice(1),
    }
  }
  return { mode: 'object', fields }
}

/** Create a default value for a JSON field based on its schema */
export function createDefaultJsonValue(schema: JsonSchema | undefined): any {
  if (!schema) return ''
  switch (schema.mode) {
    case 'object': {
      const obj: Record<string, any> = {}
      for (const [key, field] of Object.entries(schema.fields)) {
        obj[key] = field.default ?? (field.type === 'number' ? 0 : field.type === 'boolean' ? false : '')
      }
      return obj
    }
    case 'list':
      return []
    case 'keyed-list':
      return {}
  }
}

export interface LayoutSection {
  title: string
  fields: string[]  // Field names
  display: SectionDisplay
}

export interface EditorLayout {
  template: LayoutTemplate
  imagePosition: ImagePosition
  imageSize: ImageSize
  headerFields: string[]  // Fields shown in the first row
  sections: LayoutSection[]
}

export interface ListLayout {
  display: 'grid' | 'list'
  cardSize?: 'small' | 'medium' | 'large'
  showFields: string[]  // Which fields to display in cards/list items
}

export interface EntityTemplate {
  id: string  // e.g., 'template-characters'
  shareId: string  // Stable shareable ID (e.g., 'official-characters')
  version: number  // Integer version, bumped on updates
  label: string
  icon: string
  description: string
  tags?: string[]
  baseFields: string[]  // Always: name, description, image_url, tags
  customFields: FieldDefinition[]
  editorLayout: EditorLayout
  listLayout: ListLayout
  subtitleFields: string[]  // For disambiguation
}

export interface SharedTemplate {
  share_id: string
  version: number
  label: string
  icon: string
  description: string
  tags: string[]
  official: boolean
  author_id: string | null
  author_name: string | null
  base_fields: string[]
  custom_fields: FieldDefinition[]
  editor_layout: EditorLayout
  list_layout: ListLayout
  subtitle_fields: string[]
  installs: number
  published_at: string
}

export interface EntityTypeDefinition {
  id: string
  projectId: string
  bobbinId: string
  typeId: string  // e.g., 'characters', 'spells'
  label: string
  icon: string
  templateId: string | null  // NULL if created from scratch
  baseFields: string[]
  customFields: FieldDefinition[]
  editorLayout: EditorLayout
  listLayout: ListLayout
  subtitleFields: string[]
  allowDuplicates: boolean
  createdAt: Date
  updatedAt: Date
}

/** Extract typeId from an entity type definition, handling both camelCase and snake_case */
export function getTypeId(type: EntityTypeDefinition): string {
  return (type as any).type_id || type.typeId
}

/** Normalize API response (snake_case) to camelCase EntityTypeDefinition */
export function normalizeTypeConfig(config: any): EntityTypeDefinition {
  return {
    ...config,
    typeId: config.typeId || config.type_id,
    templateId: config.templateId ?? config.template_id ?? null,
    baseFields: config.baseFields || config.base_fields || [],
    customFields: config.customFields || config.custom_fields || [],
    editorLayout: config.editorLayout || config.editor_layout,
    listLayout: config.listLayout || config.list_layout,
    subtitleFields: config.subtitleFields || config.subtitle_fields || [],
    allowDuplicates: config.allowDuplicates ?? config.allow_duplicates ?? true,
  }
}

export interface EntityMatch {
  id: string
  name: string
  entityType: string
  description?: string
  imageUrl?: string
  subtitleText?: string  // Computed from subtitleFields
  score: number  // For ranking search results
  lastAccessed?: Date
  [key: string]: any  // Custom fields
}

export interface DisambiguationPreferences {
  prioritizeRecent: boolean
  useContextHints: boolean
  preferredType?: string  // Entity type to always show first
  showTypeIcons: boolean
  showTypeLabels: boolean
  warnOnDuplicates: boolean
}
