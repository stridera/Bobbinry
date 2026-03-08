/**
 * Type definitions for the Notes & Research bobbin
 */

export interface NoteFolder {
  id: string
  projectId: string
  bobbinId: string
  name: string
  parent_folder: string | null
  order: number
  color: string | null
  icon: string | null
  created_at: string
  updated_at: string
}

export interface Note {
  id: string
  projectId: string
  bobbinId: string
  title: string
  content: string | null
  folder_id: string | null
  tags: string[]
  linked_entities: LinkedEntity[]
  pinned: boolean
  color: string | null
  icon: string | null
  created_at: string
  updated_at: string
}

export interface LinkedEntity {
  entityId: string
  collection: string
  bobbinId: string
  label: string
}
