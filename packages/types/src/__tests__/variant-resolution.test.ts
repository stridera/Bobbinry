/**
 * Forward-era inheritance.
 *
 * The base-fallback behaviour these build on is covered by the entities
 * bobbin's `variants.test.ts`, which exercises this module through its
 * re-exports; these tests cover only what forward inheritance adds.
 */

import {
  effectiveOverrides,
  inheritModeFor,
  resolveEntityForVariant,
  sortedVariantIds,
  variantConfigFromTypeData,
  variantFieldSource,
  type VariantResolutionConfig,
} from '../variant-resolution'

const ordered = (
  inheritance: Record<string, 'base' | 'forward'> = {}
): VariantResolutionConfig => ({
  customFields: [
    { name: 'appearance', versionable: true },
    { name: 'level', versionable: true },
    { name: 'species', versionable: false },
  ],
  versionableBaseFields: ['description', 'image_url'],
  variantAxis: { kind: 'ordered' },
  variantInheritance: inheritance,
})

/** Three eras, deliberately stored out of axis order. */
const entity = () => ({
  name: 'Vanessa',
  level: 6,
  description: 'base description',
  appearance: 'base appearance',
  species: 'human',
  images: [{ url: 'base.jpg' }],
  thumbnail: { url: 'base.jpg' },
  image_url: 'base.jpg',
  _variants: {
    axis_id: 'era',
    active: 'era-3',
    order: ['era-5', 'era-1', 'era-3'],
    items: {
      'era-1': { label: 'Book 1', axis_value: 1, overrides: { appearance: 'young', level: 1 } },
      'era-3': { label: 'Book 3', axis_value: 3, overrides: { appearance: 'scarred' } },
      'era-5': { label: 'Book 5', axis_value: 5, overrides: {} },
    },
  },
})

describe('inheritModeFor', () => {
  it('is always base on an unordered axis', () => {
    const cfg: VariantResolutionConfig = {
      variantAxis: { kind: 'unordered' },
      variantInheritance: { images: 'forward', appearance: 'forward' },
    }
    expect(inheritModeFor(cfg, 'images')).toBe('base')
    expect(inheritModeFor(cfg, 'appearance')).toBe('base')
  })

  it('defaults the gallery triple to forward and everything else to base', () => {
    const cfg = ordered()
    expect(inheritModeFor(cfg, 'images')).toBe('forward')
    expect(inheritModeFor(cfg, 'thumbnail')).toBe('forward')
    expect(inheritModeFor(cfg, 'image_url')).toBe('forward')
    expect(inheritModeFor(cfg, 'appearance')).toBe('base')
  })

  it('routes all three gallery names through the one canonical key', () => {
    const cfg = ordered({ images: 'base' })
    expect(inheritModeFor(cfg, 'images')).toBe('base')
    expect(inheritModeFor(cfg, 'thumbnail')).toBe('base')
    expect(inheritModeFor(cfg, 'image_url')).toBe('base')
  })

  it('honours an explicit forward setting on a normal field', () => {
    expect(inheritModeFor(ordered({ appearance: 'forward' }), 'appearance')).toBe('forward')
  })
})

describe('forward inheritance', () => {
  it('takes the nearest earlier era, not the base', () => {
    const cfg = ordered({ appearance: 'forward' })
    expect(effectiveOverrides(entity(), cfg, 'era-5').appearance).toBe('scarred')
    expect(effectiveOverrides(entity(), cfg, 'era-3').appearance).toBe('scarred')
    expect(effectiveOverrides(entity(), cfg, 'era-1').appearance).toBe('young')
  })

  it('falls back to base for the earliest era', () => {
    const cfg = ordered({ level: 'forward' })
    expect(resolveEntityForVariant(entity(), cfg, 'era-1').level).toBe(1)
    // era-3 and era-5 have no level of their own, so they carry era-1's forward
    expect(resolveEntityForVariant(entity(), cfg, 'era-3').level).toBe(1)
  })

  it('leaves base-mode fields falling back to base', () => {
    const cfg = ordered()
    expect(resolveEntityForVariant(entity(), cfg, 'era-5').appearance).toBe('base appearance')
    expect(resolveEntityForVariant(entity(), cfg, 'era-5').level).toBe(6)
  })

  it('never applies overrides for non-versionable fields', () => {
    const data = entity()
    data._variants.items['era-1']!.overrides.species = 'elf'
    expect(resolveEntityForVariant(data, ordered({ species: 'forward' }), 'era-5').species).toBe('human')
  })

  it('is a no-op on unordered axes', () => {
    const cfg: VariantResolutionConfig = { ...ordered({ appearance: 'forward' }), variantAxis: { kind: 'unordered' } }
    expect(resolveEntityForVariant(entity(), cfg, 'era-5').appearance).toBe('base appearance')
  })

  it('sorts by axis_value, not by the stored order array', () => {
    // order is ['era-5','era-1','era-3']; a naive walk would give era-1 for era-3.
    expect(sortedVariantIds(entity(), 'ordered')).toEqual(['era-1', 'era-3', 'era-5'])
    expect(effectiveOverrides(entity(), ordered({ appearance: 'forward' }), 'era-5').appearance).toBe('scarred')
  })

  it('puts a null axis_value last, inheriting from everything before it', () => {
    const data = entity()
    ;(data._variants.items as any)['era-x'] = { label: 'Unplaced', axis_value: null, overrides: {} }
    data._variants.order.push('era-x')
    expect(sortedVariantIds(data, 'ordered')).toEqual(['era-1', 'era-3', 'era-5', 'era-x'])
    expect(effectiveOverrides(data, ordered({ appearance: 'forward' }), 'era-x').appearance).toBe('scarred')
  })

  it('skips past an era whose gallery override was emptied', () => {
    const data = entity()
    data._variants.items['era-1']!.overrides.images = [{ url: 'book1.jpg' }]
    data._variants.items['era-1']!.overrides.thumbnail = { url: 'book1.jpg' }
    data._variants.items['era-3']!.overrides.images = []
    expect(effectiveOverrides(data, ordered(), 'era-5').images).toEqual([{ url: 'book1.jpg' }])
  })
})

describe('gallery triple moves as a unit', () => {
  it('sources all three keys from the same era', () => {
    const data = entity()
    data._variants.items['era-1']!.overrides.images = [{ url: 'book1.jpg' }]
    data._variants.items['era-1']!.overrides.thumbnail = { url: 'book1.jpg', crop: { x: 0, y: 0, w: 1, h: 1 } }
    data._variants.items['era-1']!.overrides.image_url = 'book1.jpg'

    const resolved = resolveEntityForVariant(data, ordered(), 'era-5')
    expect(resolved.images).toEqual([{ url: 'book1.jpg' }])
    expect(resolved.thumbnail.url).toBe('book1.jpg')
    expect(resolved.image_url).toBe('book1.jpg')
    // The invariant that matters: the thumbnail url is present in the gallery,
    // so getEntityThumbnail can't silently degrade to images[0].
    expect(resolved.images.some((i: any) => i.url === resolved.thumbnail.url)).toBe(true)
  })

  it('does not mix an inherited thumbnail with a nearer era images override', () => {
    const data = entity()
    data._variants.items['era-1']!.overrides.thumbnail = { url: 'book1.jpg' }
    data._variants.items['era-1']!.overrides.images = [{ url: 'book1.jpg' }]
    data._variants.items['era-3']!.overrides.images = [{ url: 'book3.jpg' }]
    data._variants.items['era-3']!.overrides.thumbnail = { url: 'book3.jpg' }

    const resolved = resolveEntityForVariant(data, ordered(), 'era-5')
    expect(resolved.images).toEqual([{ url: 'book3.jpg' }])
    expect(resolved.thumbnail.url).toBe('book3.jpg')
  })

  it('is disabled when the gallery is pinned to base', () => {
    const data = entity()
    data._variants.items['era-1']!.overrides.images = [{ url: 'book1.jpg' }]
    expect(resolveEntityForVariant(data, ordered({ images: 'base' }), 'era-5').images)
      .toEqual([{ url: 'base.jpg' }])
  })
})

describe('eraIds restriction (tier gating)', () => {
  it('inherits only from eras the caller can see', () => {
    const cfg = ordered({ appearance: 'forward' })
    // All three visible: era-5 picks up era-3's value.
    expect(effectiveOverrides(entity(), cfg, 'era-5', { eraIds: ['era-1', 'era-3', 'era-5'] }).appearance)
      .toBe('scarred')
    // era-3 gated above the caller's tier: era-5 must fall back to era-1,
    // never to the gated era's text.
    expect(effectiveOverrides(entity(), cfg, 'era-5', { eraIds: ['era-1', 'era-5'] }).appearance)
      .toBe('young')
    // Only era-5 visible: nothing to inherit, base wins.
    expect(effectiveOverrides(entity(), cfg, 'era-5', { eraIds: ['era-5'] }).appearance)
      .toBeUndefined()
  })

  it('filters sortedVariantIds too', () => {
    expect(sortedVariantIds(entity(), 'ordered', { eraIds: ['era-5', 'era-1'] })).toEqual(['era-1', 'era-5'])
  })
})

describe('variantFieldSource', () => {
  const cfg = ordered({ appearance: 'forward' })

  it('reports own / inherited / base and agrees with the resolved value', () => {
    const data = entity()
    expect(variantFieldSource(data, cfg, 'era-3', 'appearance')).toEqual({ kind: 'own' })
    expect(variantFieldSource(data, cfg, 'era-5', 'appearance'))
      .toEqual({ kind: 'inherited', fromVariantId: 'era-3', fromLabel: 'Book 3' })
    // level is base-mode, so era-5 renders the base value
    expect(variantFieldSource(data, cfg, 'era-5', 'level')).toEqual({ kind: 'base' })

    const resolved = resolveEntityForVariant(data, cfg, 'era-5')
    expect(resolved.appearance).toBe('scarred')
    expect(resolved.level).toBe(6)
  })

  it('reports base for a non-versionable field', () => {
    expect(variantFieldSource(entity(), cfg, 'era-3', 'species')).toEqual({ kind: 'base' })
  })

  it('respects the visible era set', () => {
    expect(variantFieldSource(entity(), cfg, 'era-5', 'appearance', { eraIds: ['era-1', 'era-5'] }))
      .toEqual({ kind: 'inherited', fromVariantId: 'era-1', fromLabel: 'Book 1' })
  })
})

describe('variantConfigFromTypeData', () => {
  it('adapts a snake_case type row', () => {
    const cfg = variantConfigFromTypeData({
      custom_fields: [
        { name: 'appearance', versionable: true },
        { name: 'species' },
      ],
      versionable_base_fields: ['description', 'image_url'],
      variant_axis: { id: 'era', label: 'Era', kind: 'ordered' },
      variant_inheritance: { appearance: 'forward', bogus: 'nonsense' },
    })
    expect(cfg.variantAxis).toEqual({ kind: 'ordered' })
    expect(cfg.variantInheritance).toEqual({ appearance: 'forward' })
    expect(inheritModeFor(cfg, 'appearance')).toBe('forward')
    expect(inheritModeFor(cfg, 'description')).toBe('base')
  })

  it('tolerates a missing or axis-less row', () => {
    expect(variantConfigFromTypeData(null).variantAxis).toBeUndefined()
    expect(variantConfigFromTypeData({}).variantAxis).toBeNull()
  })
})
