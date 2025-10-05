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

export type LayoutTemplate = 'compact-card' | 'hero-image' | 'list-details' | 'custom'

export type ImagePosition = 'top-right' | 'top-full-width' | 'left-sidebar' | 'none'

export type ImageSize = 'small' | 'medium' | 'large'

export type SectionDisplay = 'inline' | 'stacked' | 'json-editor' | 'rich-text'

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
  schema?: Record<string, string>  // For json type
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
  label: string
  icon: string
  description: string
  baseFields: string[]  // Always: name, description, image_url, tags
  customFields: FieldDefinition[]
  editorLayout: EditorLayout
  listLayout: ListLayout
  subtitleFields: string[]  // For disambiguation
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
