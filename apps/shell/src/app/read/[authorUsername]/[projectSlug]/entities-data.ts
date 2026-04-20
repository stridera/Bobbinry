/**
 * Types + helpers for the reader's Entities tab.
 *
 * Keeps the server response shape (mirrored from /api/public/projects/:id/entities)
 * and the small amount of variant-resolution logic needed to merge overrides
 * onto the base entity for display. The variant helper is intentionally inlined
 * here rather than imported from @bobbinry/entities — the bobbin package doesn't
 * export its helpers, and duplicating ~10 lines is cheaper than wiring exports.
 */

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
