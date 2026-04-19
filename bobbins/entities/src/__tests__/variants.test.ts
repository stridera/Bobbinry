import {
  clearVariantOverride,
  getVariants,
  listVariantIds,
  resolveEntityForVariant,
  setFieldOnEntity,
  sortedVariantIds,
  versionableFieldNames,
  VARIANTS_KEY,
} from '../variants'
import type { EntityTypeDefinition, FieldDefinition } from '../types'

function makeType(customFields: FieldDefinition[]): Pick<EntityTypeDefinition, 'customFields'> {
  return { customFields }
}

const typeConfig = makeType([
  { name: 'strength', type: 'number', label: 'Strength', versionable: true },
  { name: 'description', type: 'text', label: 'Description', versionable: true },
  { name: 'species', type: 'text', label: 'Species' }, // not versionable
])

const entity = {
  id: 'e1',
  name: 'Aragorn',
  species: 'Human',
  strength: 12,
  description: 'A ranger',
  [VARIANTS_KEY]: {
    axis_id: 'book',
    active: 'book-1',
    order: ['book-5', 'book-1'], // intentionally out of numeric order
    items: {
      'book-1': { label: 'Book 1', axis_value: 1, overrides: { strength: 12, description: 'A ranger' } },
      'book-5': { label: 'Book 5', axis_value: 5, overrides: { strength: 18, description: 'The King' } },
    },
  },
}

describe('versionableFieldNames', () => {
  it('returns only fields flagged versionable', () => {
    const names = versionableFieldNames(typeConfig)
    expect(names.has('strength')).toBe(true)
    expect(names.has('description')).toBe(true)
    expect(names.has('species')).toBe(false)
  })

  it('handles missing typeConfig', () => {
    expect(versionableFieldNames(null).size).toBe(0)
    expect(versionableFieldNames(undefined).size).toBe(0)
  })
})

describe('getVariants', () => {
  it('returns parsed variant block', () => {
    const v = getVariants(entity)
    expect(v).not.toBeNull()
    expect(v!.axis_id).toBe('book')
    expect(v!.active).toBe('book-1')
    expect(Object.keys(v!.items).sort()).toEqual(['book-1', 'book-5'])
  })

  it('filters order to existing items', () => {
    const v = getVariants({ [VARIANTS_KEY]: { items: { a: { label: 'A', overrides: {} } }, order: ['a', 'ghost'] } })
    expect(v!.order).toEqual(['a'])
  })

  it('returns null for entities without variants', () => {
    expect(getVariants({ name: 'x' })).toBeNull()
    expect(getVariants(null)).toBeNull()
    expect(getVariants(undefined)).toBeNull()
  })

  it('drops active pointer that references a missing item', () => {
    const v = getVariants({ [VARIANTS_KEY]: { items: { a: { label: 'A', overrides: {} } }, active: 'ghost' } })
    expect(v!.active).toBeNull()
  })
})

describe('listVariantIds', () => {
  it('returns ids in display order', () => {
    expect(listVariantIds(entity)).toEqual(['book-5', 'book-1'])
  })

  it('returns [] for entities without variants', () => {
    expect(listVariantIds({ name: 'x' })).toEqual([])
  })
})

describe('resolveEntityForVariant', () => {
  it('returns base with _variants stripped when no variant selected', () => {
    const resolved = resolveEntityForVariant(entity, typeConfig, null)
    expect(resolved[VARIANTS_KEY]).toBeUndefined()
    expect(resolved.strength).toBe(12)
    expect(resolved.description).toBe('A ranger')
    expect(resolved.species).toBe('Human')
  })

  it('overlays variant overrides for versionable fields', () => {
    const resolved = resolveEntityForVariant(entity, typeConfig, 'book-5')
    expect(resolved.strength).toBe(18)
    expect(resolved.description).toBe('The King')
    expect(resolved.species).toBe('Human') // non-versionable stays base
  })

  it('ignores overrides targeting non-versionable fields', () => {
    const tampered = {
      ...entity,
      [VARIANTS_KEY]: {
        ...entity[VARIANTS_KEY],
        items: {
          ...entity[VARIANTS_KEY].items,
          'book-5': { label: 'Book 5', overrides: { strength: 18, species: 'Elf' } },
        },
      },
    }
    const resolved = resolveEntityForVariant(tampered, typeConfig, 'book-5')
    expect(resolved.strength).toBe(18)
    expect(resolved.species).toBe('Human') // override silently dropped
  })

  it('falls back to base when variant id is unknown', () => {
    const resolved = resolveEntityForVariant(entity, typeConfig, 'book-99')
    expect(resolved.strength).toBe(12)
  })

  it('returns {} for null entity', () => {
    expect(resolveEntityForVariant(null, typeConfig, 'book-1')).toEqual({})
  })

  it('preserves base when a variant has empty overrides', () => {
    const e = {
      name: 'x',
      strength: 5,
      [VARIANTS_KEY]: { order: ['a'], items: { a: { label: 'A', overrides: {} } } },
    }
    const resolved = resolveEntityForVariant(e, typeConfig, 'a')
    expect(resolved.strength).toBe(5)
  })
})

describe('setFieldOnEntity', () => {
  it('writes to base when no variant selected', () => {
    const next = setFieldOnEntity(entity, typeConfig, null, 'strength', 99)
    expect(next.strength).toBe(99)
    expect(next[VARIANTS_KEY].items['book-5'].overrides.strength).toBe(18) // unchanged
  })

  it('writes to variant overrides for versionable field', () => {
    const next = setFieldOnEntity(entity, typeConfig, 'book-5', 'strength', 25)
    expect(next.strength).toBe(12) // base unchanged
    expect(next[VARIANTS_KEY].items['book-5'].overrides.strength).toBe(25)
  })

  it('writes non-versionable field to base even when a variant is selected', () => {
    const next = setFieldOnEntity(entity, typeConfig, 'book-5', 'species', 'Elf')
    expect(next.species).toBe('Elf')
    expect(next[VARIANTS_KEY].items['book-5'].overrides.species).toBeUndefined()
  })

  it('does not mutate input', () => {
    const snapshot = JSON.parse(JSON.stringify(entity))
    setFieldOnEntity(entity, typeConfig, 'book-5', 'strength', 42)
    expect(entity).toEqual(snapshot)
  })

  it('falls back to base write when variant id is unknown', () => {
    const next = setFieldOnEntity(entity, typeConfig, 'ghost', 'strength', 7)
    expect(next.strength).toBe(7)
  })
})

describe('clearVariantOverride', () => {
  it('removes a single override, preserving the variant', () => {
    const next = clearVariantOverride(entity, 'book-5', 'strength')
    expect(next[VARIANTS_KEY].items['book-5'].overrides.strength).toBeUndefined()
    expect(next[VARIANTS_KEY].items['book-5'].overrides.description).toBe('The King')
  })

  it('returns the entity unchanged when variant is missing', () => {
    const next = clearVariantOverride(entity, 'ghost', 'strength')
    expect(next).toBe(entity)
  })
})

describe('sortedVariantIds', () => {
  it('returns insertion order for unordered axis', () => {
    expect(sortedVariantIds(entity, 'unordered')).toEqual(['book-5', 'book-1'])
  })

  it('sorts numerically for ordered axis', () => {
    expect(sortedVariantIds(entity, 'ordered')).toEqual(['book-1', 'book-5'])
  })

  it('puts missing axis_value last for ordered axis', () => {
    const e = {
      [VARIANTS_KEY]: {
        order: ['b', 'a', 'c'],
        items: {
          a: { label: 'A', axis_value: 2, overrides: {} },
          b: { label: 'B', overrides: {} },
          c: { label: 'C', axis_value: 1, overrides: {} },
        },
      },
    }
    expect(sortedVariantIds(e, 'ordered')).toEqual(['c', 'a', 'b'])
  })
})
