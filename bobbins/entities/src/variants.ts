/**
 * Entity variant write helpers.
 *
 * A variant is a named overlay of per-field values on top of an entity's
 * base data. Only fields marked versionable on the entity type can be
 * overridden per-variant; every other field is always the base value.
 * Versionable fields are either custom fields with `versionable: true`
 * or base fields listed in the type's `versionableBaseFields` array.
 *
 * The *read* side (resolution, ordering, versionable-field collection,
 * the empty-gallery rule) lives in `@bobbinry/types/variant-resolution` and is
 * re-exported here — the API and the shell reader need the identical logic,
 * and four hand-mirrored copies had already drifted apart. Only the write
 * helpers, which are editor-only, remain in this file.
 */

import type { EntityVariants, VariantItem } from './types'
import {
  VARIANTS_KEY,
  getVariantsBlock,
  isEmptyGalleryOverride,
  versionableFieldNames,
  type VariantResolutionConfig,
} from '@bobbinry/types'

export {
  VARIANTS_KEY,
  GALLERY_OVERRIDE_FIELDS,
  GALLERY_INHERIT_KEY,
  isEmptyGalleryOverride,
  versionableFieldNames,
  sortedVariantIds,
  inheritModeFor,
  effectiveOverrides,
  resolveEntityForVariant,
  variantFieldSource,
  type VariantInherit,
  type VariantFieldSource,
  type VariantResolutionConfig,
  type VariantResolutionOptions,
} from '@bobbinry/types'

/** Turn a human label into a kebab-case variant id. Falls back to a timestamped id for non-ascii labels. */
export function slugifyVariantId(label: string): string {
  const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return base || `variant-${Date.now().toString(36)}`
}

/** If `base` collides with an existing id, append `-2`, `-3`, … until unique. */
export function ensureUniqueVariantId(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base
  let i = 2
  while (existing.includes(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/** Read the `_variants` block off an entity, tolerating missing / malformed values. */
export function getVariants(entity: Record<string, any> | null | undefined): EntityVariants | null {
  return getVariantsBlock(entity) as EntityVariants | null
}

/** List variant ids in their display order. */
export function listVariantIds(entity: Record<string, any> | null | undefined): string[] {
  const v = getVariants(entity)
  return v ? v.order : []
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
 * - If `variantId` is set and the value empties a gallery field → drops the
 *   override entirely so the variant inherits again.
 */
export function setFieldOnEntity(
  entity: Record<string, any>,
  typeConfig: VariantResolutionConfig | null | undefined,
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
  if (isEmptyGalleryOverride(fieldName, value)) {
    return clearVariantOverride(entity, variantId, fieldName)
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

/** Convenience: remove a per-variant override so the field falls back to its inherited value. */
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
