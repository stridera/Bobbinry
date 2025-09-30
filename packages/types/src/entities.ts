/**
 * Entity types for Bobbinry platform
 * These types ensure consistency between API responses and view code
 */

/**
 * Metadata attached to all entities returned by the API
 */
export interface EntityMetadata {
  bobbinId: string
  collection: string
  createdAt: Date | string
  updatedAt: Date | string
}

/**
 * Base entity type returned by the API
 * The entity data is spread directly on the response object,
 * NOT nested in a .data property
 */
export interface Entity extends Record<string, any> {
  id: string
  _meta: EntityMetadata
}

/**
 * Response from entity query endpoints
 */
export interface EntityQueryResponse {
  entities: Array<Entity & Record<string, any>>
  total: number
}

/**
 * Manuscript-specific entity types
 */

export interface BookData {
  title: string
  order: number
  description?: string
}

export interface ChapterData {
  title: string
  order: number
  book_id: string
  description?: string
}

export interface SceneData {
  title: string
  order: number
  chapter_id: string
  word_count?: number
  content?: string
}

/**
 * Typed entity responses for Manuscript bobbin
 */
export type BookEntity = Entity & BookData
export type ChapterEntity = Entity & ChapterData
export type SceneEntity = Entity & SceneData