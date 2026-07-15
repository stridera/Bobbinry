/**
 * Types + helpers for the reader's Entities tab.
 *
 * Keeps the server response shape (mirrored from /api/public/projects/:id/entities)
 * and the small amount of variant-resolution logic needed to merge overrides
 * onto the base entity for display. The inlined variant helper mirrors
 * `bobbins/entities/src/variants.ts` — gallery helpers are imported from
 * @bobbinry/entities directly.
 */

import { getEntityThumbnail, type EntityThumbnail } from '@bobbinry/entities'

export interface VariantAxis {
  id: string
  label: string
  kind: 'ordered' | 'unordered'
}

export interface VariantItem {
  label: string
  axis_value?: number | string | null
  overrides?: Record<string, unknown>
}

export interface VariantsBlock {
  axis_id: string | null
  active: string | null
  order: string[]
  items: Record<string, VariantItem>
}

export interface FieldDefinition {
  name: string
  type: string
  label?: string
  [extra: string]: unknown
}

export interface PublishedType {
  typeId: string
  label: string
  icon: string
  listLayout: Record<string, unknown> | null
  editorLayout: Record<string, unknown> | null
  customFields: FieldDefinition[]
  baseFields: string[]
  versionableBaseFields: string[]
  subtitleFields: string[]
  variantAxis: VariantAxis | null
  minimumTierLevel: number
  publishOrder: number
  /** Count of entities in this type the caller can't see yet, keyed by the tier level that would unlock them. */
  lockedByTier?: Record<number, number>
  entities: PublishedEntity[]
}

export interface PublishedEntity {
  id: string
  /** Reader-URL slug (current); null until the entity is published with one. */
  slug?: string | null
  typeId: string
  name: string | null
  description: string | null
  imageUrl: string | null
  tags: string[]
  entityData: Record<string, any> & { _variants?: VariantsBlock }
  publishOrder: number
  minimumTierLevel: number
  publishedAt: string | null
  publishBase: boolean
  publishedVariantIds: string[]
}

export interface EntitiesPayload {
  installed: boolean
  callerTierLevel: number
  types: PublishedType[]
  lockedPreviews: { types: number; entities: number }
}

/**
 * Description for card previews and search. When the base view isn't
 * published, the server strips base fields that every visible variant
 * overrides, so `entity.description` can be null even though the visible
 * variants carry one — fall back to the first published variant's override,
 * matching the display-name fallback and what the drawer opens to.
 */
export function resolveCardDescription(entity: PublishedEntity): string | null {
  if (entity.publishBase) return entity.description
  const firstVariantId = entity.publishedVariantIds[0]
  const override = firstVariantId
    ? entity.entityData._variants?.items?.[firstVariantId]?.overrides?.description
    : undefined
  return typeof override === 'string' ? override : entity.description
}

/**
 * Thumbnail (url + optional crop) for card previews. Mirrors the
 * description fallback above: when the base view isn't published, overlay
 * the first published variant's gallery overrides so the card matches what
 * the drawer opens to.
 */
export function resolveCardThumbnail(entity: PublishedEntity): EntityThumbnail | null {
  let data: Record<string, unknown> = entity.entityData
  if (!entity.publishBase) {
    const firstVariantId = entity.publishedVariantIds[0]
    const overrides = firstVariantId
      ? entity.entityData._variants?.items?.[firstVariantId]?.overrides
      : undefined
    if (overrides) data = { ...data, ...overrides }
  }
  return getEntityThumbnail(data)
}

/**
 * Strip the `_variants` block and overlay a variant's overrides on top of the
 * base entity. Null variantId returns the base (with variants stripped).
 * Only fields declared versionable are allowed through as overrides — matches
 * the logic in `bobbins/entities/src/variants.ts`.
 */
export function resolveEntityForVariant(
  entity: Record<string, any>,
  versionableFieldSet: Set<string>,
  variantId: string | null
): Record<string, any> {
  const { _variants, ...base } = entity
  if (!variantId) return base
  const item = _variants?.items?.[variantId]
  if (!item || !item.overrides) return base
  const result: Record<string, any> = { ...base }
  for (const [key, value] of Object.entries(item.overrides)) {
    if (versionableFieldSet.has(key)) result[key] = value
  }
  return result
}
