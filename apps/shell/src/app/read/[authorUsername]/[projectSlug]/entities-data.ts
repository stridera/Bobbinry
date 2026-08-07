/**
 * Types + helpers for the reader's Entities tab.
 *
 * Keeps the server response shape (mirrored from /api/public/projects/:id/entities).
 * Variant resolution itself comes from `@bobbinry/types` — the same
 * implementation the API and the entities bobbin use, so the reader can't
 * disagree with them about what an era renders.
 */

import {
  getEntityImages,
  getEntityThumbnail,
  imageAltText,
  type EntityThumbnail,
} from '@bobbinry/entities'
import {
  resolveEntityForVariant,
  sortedVariantIds,
  type VariantInherit,
  type VariantResolutionConfig,
} from '@bobbinry/types'

export { resolveEntityForVariant }

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
  /** Per-field `base` | `forward` inheritance for ordered axes; absent = defaults. */
  variantInheritance?: Record<string, VariantInherit>
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

/** The resolution config for a published type, as the shared resolver wants it. */
export function variantConfigForType(type: PublishedType): VariantResolutionConfig {
  return {
    customFields: type.customFields as ReadonlyArray<{ name: string; versionable?: boolean }>,
    versionableBaseFields: type.versionableBaseFields ?? [],
    variantAxis: type.variantAxis,
    variantInheritance: type.variantInheritance,
  }
}

/**
 * The entity data a card should preview.
 *
 * When the base view isn't published the server strips base fields that every
 * visible variant overrides, so `entity.description` / `imageUrl` can be null
 * even though the visible eras carry them. Resolve at the first visible era
 * instead — which is what the drawer opens to.
 *
 * That era must be picked in **axis** order, not from `publishedVariantIds`:
 * that array is stored in the order the author toggled the checkboxes, so
 * indexing it directly gives an arbitrary era on an ordered axis.
 */
export function resolveCardView(
  entity: PublishedEntity,
  type: PublishedType | null | undefined
): Record<string, any> {
  if (entity.publishBase) return entity.entityData
  const eraIds = entity.publishedVariantIds
  const firstEra = sortedVariantIds(entity.entityData, type?.variantAxis?.kind ?? null, { eraIds })[0]
  if (!firstEra) return entity.entityData
  return resolveEntityForVariant(
    entity.entityData,
    type ? variantConfigForType(type) : null,
    firstEra,
    { eraIds }
  )
}

/** Description for card previews and search. */
export function resolveCardDescription(
  entity: PublishedEntity,
  type?: PublishedType | null
): string | null {
  if (entity.publishBase) return entity.description
  const value = resolveCardView(entity, type).description
  return typeof value === 'string' ? value : entity.description
}

/** Thumbnail (url + optional crop) for card previews. */
export function resolveCardThumbnail(
  entity: PublishedEntity,
  type?: PublishedType | null
): (EntityThumbnail & { alt: string }) | null {
  const data = resolveCardView(entity, type)
  const thumbnail = getEntityThumbnail(data)
  if (!thumbnail) return null
  // Author-provided alt/caption for the thumbnail's gallery image; empty
  // stays correct for decorative images next to the visible card title.
  const image = getEntityImages(data).find(img => img.url === thumbnail.url)
  return { ...thumbnail, alt: imageAltText(image) }
}
