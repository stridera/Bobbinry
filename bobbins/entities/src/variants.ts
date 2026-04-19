/**
 * Entity variant helpers.
 *
 * A variant is a named overlay of per-field values on top of an entity's
 * base data. Only fields marked `versionable: true` on the entity type
 * can be overridden per-variant; every other field is always the base value.
 */

import type { EntityTypeDefinition, EntityVariants, FieldDefinition, VariantItem } from './types'

export const VARIANTS_KEY = '_variants'

/** Read the `_variants` block off an entity, tolerating missing / malformed values. */
export function getVariants(entity: Record<string, any> | null | undefined): EntityVariants | null {
  if (!entity) return null
  const raw = entity[VARIANTS_KEY]
  if (!raw || typeof raw !== 'object') return null
  if (!raw.items || typeof raw.items !== 'object') return null
  const order: string[] = Array.isArray(raw.order)
    ? raw.order.filter((id: unknown): id is string => typeof id === 'string' && id in raw.items)
    : Object.keys(raw.items)
  return {
    axis_id: typeof raw.axis_id === 'string' ? raw.axis_id : null,
    active: typeof raw.active === 'string' && raw.active in raw.items ? raw.active : null,
    order,
    items: raw.items as Record<string, VariantItem>,
  }
}

/** List variant ids in their display order. */
export function listVariantIds(entity: Record<string, any> | null | undefined): string[] {
  const v = getVariants(entity)
  return v ? v.order : []
}

/** Set of field names that are versionable on an entity type. */
export function versionableFieldNames(typeConfig: Pick<EntityTypeDefinition, 'customFields'> | null | undefined): Set<string> {
  const names = new Set<string>()
  if (!typeConfig) return names
  for (const field of (typeConfig.customFields || []) as FieldDefinition[]) {
    if (field.versionable) names.add(field.name)
  }
  return names
}

/**
 * Resolve an entity to its view at a specific variant id.
 *
 * Strips the `_variants` block and overlays that variant's `overrides` on
 * the base entity data. Non-versionable fields are always the base value
 * even if a variant attempts to override them (defensive — shouldn't happen
 * on well-formed data but we don't want bad clients to silently override
 * a shared field).
 *
 * If `variantId` is null/undefined or not found, returns the base entity
 * with `_variants` stripped.
 */
export function resolveEntityForVariant(
  entity: Record<string, any> | null | undefined,
  typeConfig: Pick<EntityTypeDefinition, 'customFields'> | null | undefined,
  variantId: string | null | undefined
): Record<string, any> {
  if (!entity) return {}
  const { [VARIANTS_KEY]: _variants, ...base } = entity
  if (!variantId) return base
  const variants = getVariants(entity)
  if (!variants) return base
  const item = variants.items[variantId]
  if (!item) return base

  const versionable = versionableFieldNames(typeConfig)
  const result: Record<string, any> = { ...base }
  for (const [key, value] of Object.entries(item.overrides || {})) {
    // Defensive: only apply overrides for fields declared versionable.
    if (versionable.has(key)) result[key] = value
  }
  return result
}

/**
 * Write a field value into the right place on an entity given the current
 * variant selection. Returns a new entity (does not mutate).
 *
 * - If `variantId` is null → writes to the base (top-level field).
 * - If `variantId` is set and the field is versionable → writes to that
 *   variant's `overrides`.
 * - If `variantId` is set but the field is NOT versionable → writes to the
 *   base (since the field is shared across all variants).
 */
export function setFieldOnEntity(
  entity: Record<string, any>,
  typeConfig: Pick<EntityTypeDefinition, 'customFields'> | null | undefined,
  variantId: string | null | undefined,
  fieldName: string,
  value: any
): Record<string, any> {
  const versionable = versionableFieldNames(typeConfig)
  if (!variantId || !versionable.has(fieldName)) {
    return { ...entity, [fieldName]: value }
  }
  const variants = getVariants(entity)
  if (!variants || !variants.items[variantId]) {
    return { ...entity, [fieldName]: value }
  }
  const item = variants.items[variantId]
  const nextItem: VariantItem = {
    ...item,
    overrides: { ...(item.overrides || {}), [fieldName]: value },
  }
  return {
    ...entity,
    [VARIANTS_KEY]: {
      ...variants,
      items: { ...variants.items, [variantId]: nextItem },
    },
  }
}

/** Convenience: remove a per-variant override so the field falls back to the base value. */
export function clearVariantOverride(
  entity: Record<string, any>,
  variantId: string,
  fieldName: string
): Record<string, any> {
  const variants = getVariants(entity)
  if (!variants || !variants.items[variantId]) return entity
  const item = variants.items[variantId]
  const { [fieldName]: _dropped, ...rest } = item.overrides || {}
  const nextItem: VariantItem = { ...item, overrides: rest }
  return {
    ...entity,
    [VARIANTS_KEY]: {
      ...variants,
      items: { ...variants.items, [variantId]: nextItem },
    },
  }
}

/** Sort variant ids for display, respecting the axis kind. */
export function sortedVariantIds(
  entity: Record<string, any>,
  axisKind: 'ordered' | 'unordered' | null | undefined
): string[] {
  const variants = getVariants(entity)
  if (!variants) return []
  if (axisKind !== 'ordered') return variants.order
  // Sort by axis_value when present (numeric-first, then string), falling back to the current order.
  const indexed = variants.order.map((id, idx) => ({ id, idx, item: variants.items[id]! }))
  indexed.sort((a, b) => {
    const av = a.item.axis_value
    const bv = b.item.axis_value
    if (av == null && bv == null) return a.idx - b.idx
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number') return av - bv
    return String(av).localeCompare(String(bv))
  })
  return indexed.map(e => e.id)
}
