/**
 * Entity variant resolution — the single shared implementation.
 *
 * A variant (an "era" on an ordered axis) is a named overlay of per-field
 * values on top of an entity's base data. Only fields marked versionable on
 * the entity type can be overridden; every other field is always the base
 * value.
 *
 * This module used to exist as four hand-mirrored copies — the entities
 * bobbin, the shell reader, the API reader, and the API author route — which
 * had already drifted apart (the author route applied overrides with no
 * versionable gate and no empty-gallery rule). It lives here because
 * `@bobbinry/types` is the one package `apps/api`, `apps/shell`,
 * `bobbins/entities` and `packages/sdk` all already depend on.
 *
 * Consumers hold their entity-type config in three different shapes
 * (camelCase bobbin config, camelCase reader projection, snake_case API row),
 * so everything here is typed against the minimal structural
 * `VariantResolutionConfig`. Use `variantConfigFromTypeData` to adapt a raw
 * API row.
 */

/** Key of the variants block inside entity data. */
export const VARIANTS_KEY = '_variants'

/**
 * The image-gallery fields, which move as a unit: a gallery override is
 * always written and read as all three together, so a variant can never end
 * up with `images` from one source and `thumbnail` from another.
 */
export const GALLERY_OVERRIDE_FIELDS: readonly string[] = ['images', 'thumbnail', 'image_url']

/** Canonical key the gallery triple shares for inheritance settings. */
export const GALLERY_INHERIT_KEY = 'images'

const GALLERY_FIELD_SET = new Set(GALLERY_OVERRIDE_FIELDS)

/**
 * Where a field's value comes from when an era doesn't override it.
 *
 * - `base` — fall back to the entity's base value (the historical behaviour,
 *   and still the default for every field but the gallery).
 * - `forward` — inherit from the nearest earlier era on an ordered axis,
 *   falling back to base only when no earlier era supplies one.
 */
export type VariantInherit = 'base' | 'forward'

/** A single named variant stored inside an entity's data. */
export interface VariantItemLike {
  label?: string
  axis_value?: number | string | null | undefined
  overrides?: Record<string, unknown> | undefined
}

/** The normalized `_variants` block. */
export interface VariantsBlockLike {
  axis_id: string | null
  active: string | null
  order: string[]
  items: Record<string, VariantItemLike>
}

/**
 * Minimal entity-type shape needed to resolve variants. `EntityTypeDefinition`
 * (bobbin), `PublishedType` (shell) and `variantConfigFromTypeData(row)` (API)
 * all satisfy it structurally.
 */
export interface VariantResolutionConfig {
  customFields?: ReadonlyArray<{ name: string; versionable?: boolean | undefined }> | undefined
  versionableBaseFields?: readonly string[] | undefined
  variantAxis?: { kind?: 'ordered' | 'unordered' | undefined } | null | undefined
  variantInheritance?: Readonly<Record<string, VariantInherit>> | undefined
}

/** Restricts resolution to a subset of eras — the reader passes the tier-visible ids. */
export interface VariantResolutionOptions {
  /**
   * Era ids the caller is allowed to see. When set, forward inheritance walks
   * only these, so a reader never inherits a value from an era gated above
   * their tier. Unset means every era in the block.
   */
  eraIds?: readonly string[] | undefined
}

/**
 * True when a gallery-field override carries no image.
 *
 * An empty gallery override means "inherit the images from elsewhere", not
 * "this variant has no images" — authors reach for a shared portrait far more
 * often than for a deliberately image-less variant, and the old behaviour
 * silently blanked a variant the moment its last image was removed. Read paths
 * skip such overrides; write paths delete them rather than storing them.
 */
export function isEmptyGalleryOverride(fieldName: string, value: unknown): boolean {
  if (!GALLERY_FIELD_SET.has(fieldName)) return false
  if (value === null || value === undefined || value === '') return true
  return Array.isArray(value) && value.length === 0
}

/**
 * Read the `_variants` block off an entity, tolerating missing / malformed
 * values. Unknown top-level keys on the block are preserved by callers that
 * write it back — this only normalizes what it reads.
 */
export function getVariantsBlock(
  data: Record<string, any> | null | undefined
): VariantsBlockLike | null {
  if (!data) return null
  const raw = data[VARIANTS_KEY]
  if (!raw || typeof raw !== 'object') return null
  if (!raw.items || typeof raw.items !== 'object') return null
  const order: string[] = Array.isArray(raw.order)
    ? raw.order.filter((id: unknown): id is string => typeof id === 'string' && id in raw.items)
    : Object.keys(raw.items)
  return {
    axis_id: typeof raw.axis_id === 'string' ? raw.axis_id : null,
    active: typeof raw.active === 'string' && raw.active in raw.items ? raw.active : null,
    order,
    items: raw.items as Record<string, VariantItemLike>,
  }
}

/**
 * Field names that are versionable on an entity type: custom fields flagged
 * `versionable`, plus the base-field opt-ins in `versionableBaseFields`.
 */
export function versionableFieldNames(config: VariantResolutionConfig | null | undefined): Set<string> {
  const names = new Set<string>()
  if (!config) return names
  for (const field of config.customFields || []) {
    if (field.versionable) names.add(field.name)
  }
  for (const baseName of config.versionableBaseFields || []) {
    names.add(baseName)
  }
  // Companion rule: installed type definitions predate the gallery fields and
  // have `versionableBaseFields` frozen at install time, so the gallery
  // inherits image_url's versionability rather than requiring a backfill.
  if (names.has('image_url')) {
    names.add('images')
    names.add('thumbnail')
  }
  return names
}

/** Sort variant ids for display, respecting the axis kind and an optional era filter. */
export function sortedVariantIds(
  data: Record<string, any> | null | undefined,
  axisKind: 'ordered' | 'unordered' | null | undefined,
  opts?: VariantResolutionOptions
): string[] {
  const variants = getVariantsBlock(data)
  if (!variants) return []
  const allowed = opts?.eraIds ? new Set(opts.eraIds) : null
  const order = allowed ? variants.order.filter(id => allowed.has(id)) : variants.order
  if (axisKind !== 'ordered') return order
  // Sort by axis_value when present (numeric-first, then string), falling back
  // to the declared order.
  const indexed = order.map((id, idx) => ({ id, idx, item: variants.items[id]! }))
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

/**
 * Whether a field falls back to base or carries forward from the previous era.
 *
 * Only ordered axes can carry forward — "the previous era" is meaningless on
 * an unordered one. The gallery triple shares a single canonical setting so
 * the three can never drift apart, and is the one field group that defaults to
 * `forward`: an illustration set at Book 1 should still be the portrait at
 * Book 2 unless a new one supersedes it.
 */
export function inheritModeFor(
  config: VariantResolutionConfig | null | undefined,
  field: string
): VariantInherit {
  if (config?.variantAxis?.kind !== 'ordered') return 'base'
  const isGallery = GALLERY_FIELD_SET.has(field)
  const key = isGallery ? GALLERY_INHERIT_KEY : field
  const explicit = config?.variantInheritance?.[key]
  if (explicit === 'base' || explicit === 'forward') return explicit
  return isGallery ? 'forward' : 'base'
}

/**
 * The overrides in effect at `variantId` — its own, plus any inherited from
 * earlier eras for fields configured to carry forward.
 *
 * This is the single primitive behind entity resolution, the reader's
 * base-value drop rule, and the editor's provenance indicator, so those three
 * cannot disagree about what an era renders.
 */
export function effectiveOverrides(
  data: Record<string, any> | null | undefined,
  config: VariantResolutionConfig | null | undefined,
  variantId: string | null | undefined,
  opts?: VariantResolutionOptions
): Record<string, unknown> {
  if (!variantId) return {}
  const variants = getVariantsBlock(data)
  if (!variants || !variants.items[variantId]) return {}
  const versionable = versionableFieldNames(config)
  const out: Record<string, unknown> = {}

  // 1. The era's own overrides always win.
  for (const [key, value] of Object.entries(variants.items[variantId]!.overrides || {})) {
    // Defensive: only apply overrides for fields declared versionable.
    if (!versionable.has(key)) continue
    // An emptied gallery falls through to whatever comes next.
    if (isEmptyGalleryOverride(key, value)) continue
    out[key] = value
  }

  if (config?.variantAxis?.kind !== 'ordered') return out

  // 2. Walk back along the era chain, restricted to the caller's visible set.
  const chain = sortedVariantIds(data, 'ordered', opts)
  const idx = chain.indexOf(variantId)
  if (idx <= 0) return out

  const nonEmptyOverride = (o: Record<string, unknown>, f: string): boolean =>
    f in o && !isEmptyGalleryOverride(f, o[f]) && versionable.has(f)

  // 3. The gallery triple is sourced whole from one era. Filling the three
  //    independently could take `images` from era 1 while leaving `thumbnail`
  //    at base, and the base thumbnail url would then be absent from era 1's
  //    gallery — which silently degrades to "first image" on read.
  if (
    inheritModeFor(config, GALLERY_INHERIT_KEY) === 'forward' &&
    versionable.has(GALLERY_INHERIT_KEY) &&
    !GALLERY_OVERRIDE_FIELDS.some(f => f in out)
  ) {
    for (let j = idx - 1; j >= 0; j--) {
      const o = variants.items[chain[j]!]?.overrides || {}
      if (!GALLERY_OVERRIDE_FIELDS.some(f => nonEmptyOverride(o, f))) continue
      for (const f of GALLERY_OVERRIDE_FIELDS) {
        if (nonEmptyOverride(o, f)) out[f] = o[f]
      }
      break
    }
  }

  // 4. Every other forward field fills independently.
  for (const field of versionable) {
    if (GALLERY_FIELD_SET.has(field)) continue
    if (field in out) continue
    if (inheritModeFor(config, field) !== 'forward') continue
    for (let j = idx - 1; j >= 0; j--) {
      const value = variants.items[chain[j]!]?.overrides?.[field]
      if (value === undefined) continue
      out[field] = value
      break
    }
  }

  return out
}

/**
 * Resolve an entity to its view at a specific variant id.
 *
 * Strips the `_variants` block and overlays the era's effective overrides on
 * the base entity data. If `variantId` is null/undefined or not found, returns
 * the base entity with `_variants` stripped.
 */
export function resolveEntityForVariant(
  data: Record<string, any> | null | undefined,
  config: VariantResolutionConfig | null | undefined,
  variantId: string | null | undefined,
  opts?: VariantResolutionOptions
): Record<string, any> {
  if (!data) return {}
  const { [VARIANTS_KEY]: _variants, ...base } = data
  if (!variantId) return base
  return { ...base, ...effectiveOverrides(data, config, variantId, opts) }
}

/** Where the value an era renders for a field actually came from. */
export type VariantFieldSource =
  | { kind: 'own' }
  | { kind: 'inherited'; fromVariantId: string; fromLabel: string }
  | { kind: 'base' }

/**
 * Provenance for a single field at an era — what the editor's "inherited from
 * Book 1" badge reads. Shares the era walk with `effectiveOverrides`, so the
 * badge can never claim a different source than the value actually shown.
 */
export function variantFieldSource(
  data: Record<string, any> | null | undefined,
  config: VariantResolutionConfig | null | undefined,
  variantId: string | null | undefined,
  field: string,
  opts?: VariantResolutionOptions
): VariantFieldSource {
  if (!variantId) return { kind: 'base' }
  const variants = getVariantsBlock(data)
  if (!variants || !variants.items[variantId]) return { kind: 'base' }
  const versionable = versionableFieldNames(config)
  if (!versionable.has(field)) return { kind: 'base' }

  const own = variants.items[variantId]!.overrides || {}
  const isGallery = GALLERY_FIELD_SET.has(field)
  const ownHas = isGallery
    ? GALLERY_OVERRIDE_FIELDS.some(f => f in own && !isEmptyGalleryOverride(f, own[f]))
    : field in own && !isEmptyGalleryOverride(field, own[field])
  if (ownHas) return { kind: 'own' }

  if (inheritModeFor(config, field) !== 'forward') return { kind: 'base' }
  const chain = sortedVariantIds(data, 'ordered', opts)
  const idx = chain.indexOf(variantId)
  for (let j = idx - 1; j >= 0; j--) {
    const id = chain[j]!
    const o = variants.items[id]?.overrides || {}
    const hit = isGallery
      ? GALLERY_OVERRIDE_FIELDS.some(f => f in o && !isEmptyGalleryOverride(f, o[f]))
      : o[field] !== undefined
    if (hit) return { kind: 'inherited', fromVariantId: id, fromLabel: variants.items[id]?.label || id }
  }
  return { kind: 'base' }
}

/**
 * Adapt a raw `entity_type_definitions` row (snake_case jsonb) to the
 * resolution config. Used by the API, which reads type rows straight from the
 * database rather than through `normalizeTypeConfig`.
 */
export function variantConfigFromTypeData(
  typeData: Record<string, any> | null | undefined
): VariantResolutionConfig {
  if (!typeData) return {}
  const customFields = Array.isArray(typeData.custom_fields)
    ? typeData.custom_fields
        .filter((f: any) => f && typeof f.name === 'string')
        .map((f: any) => ({ name: f.name as string, versionable: f.versionable === true }))
    : []
  const versionableBaseFields = Array.isArray(typeData.versionable_base_fields)
    ? typeData.versionable_base_fields.filter((f: unknown): f is string => typeof f === 'string')
    : []
  const axisKind = typeData.variant_axis?.kind
  const inheritance: Record<string, VariantInherit> = {}
  if (typeData.variant_inheritance && typeof typeData.variant_inheritance === 'object') {
    for (const [key, value] of Object.entries(typeData.variant_inheritance)) {
      if (value === 'base' || value === 'forward') inheritance[key] = value
    }
  }
  return {
    customFields,
    versionableBaseFields,
    variantAxis: axisKind === 'ordered' || axisKind === 'unordered' ? { kind: axisKind } : null,
    variantInheritance: inheritance,
  }
}
