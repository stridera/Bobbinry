import { describe, it, expect } from '@jest/globals'
import { buildProgressionRows, progressionColumns, progressionHasContent } from '../progression'
import type { FieldDefinition } from '../types'

const passives: FieldDefinition = {
  name: 'passives',
  type: 'json',
  label: 'Passives',
  versionable: true,
  schema: {
    mode: 'list',
    itemLabel: 'Stream',
    fields: {
      name: { type: 'text', label: 'Ability' },
      school: { type: 'select', label: 'School', options: ['🧠 Cerebral', '☄️ Spatial'] },
      tier: { type: 'number', label: 'Tier' },
      description: { type: 'text', label: 'What it does', multiline: true },
    },
  },
}

const config = {
  customFields: [passives],
  variantAxis: { kind: 'ordered' as const },
  variantInheritance: { passives: 'forward' as const },
}

const silken = (description: string, tier: number) => ({
  name: 'Silken Sense', school: '🧠 Cerebral', tier, description,
})
const mantle = { name: 'Abyssal Mantal', school: '☄️ Spatial', tier: 1, description: 'Light refracts' }

function calvin(base: Record<string, any> = {}) {
  return {
    name: 'Calvin Hobbs',
    ...base,
    _variants: {
      axis_id: 'rank',
      active: null,
      order: ['marked', 'threaded', 'woven', 'loomed', 'finalized'],
      items: {
        marked: { label: 'Marked', axis_value: 1, overrides: { passives: [silken('Pattern reading', 1)] } },
        threaded: { label: 'Threaded', axis_value: 2, overrides: { passives: [silken('Senses movement', 2)] } },
        woven: { label: 'Woven', axis_value: 3, overrides: { passives: [silken('Senses currents', 3), mantle] } },
        loomed: { label: 'Loomed', axis_value: 4, overrides: {} },
        finalized: {
          label: 'Finalized',
          axis_value: 5,
          overrides: { passives: [{ ...silken('Senses currents', 3), name: 'Silken Sight' }, mantle] },
        },
      },
    },
  }
}

describe('progressionColumns', () => {
  it('lists eras in axis order and leaves out an empty base', () => {
    const cols = progressionColumns(calvin(), config, [passives], { includeBase: true })
    expect(cols.map(c => c.label)).toEqual(['Marked', 'Threaded', 'Woven', 'Loomed', 'Finalized'])
  })

  it('leads with a Base column when the base holds content', () => {
    const cols = progressionColumns(calvin({ passives: [silken('Untrained', 0)] }), config, [passives], { includeBase: true })
    expect(cols[0]).toEqual({ id: null, label: 'Base' })
  })

  it('keeps a hidden base out even when it holds content', () => {
    const cols = progressionColumns(calvin({ passives: [silken('Untrained', 0)] }), config, [passives], { includeBase: false })
    expect(cols[0]!.id).toBe('marked')
  })
})

describe('buildProgressionRows', () => {
  const cols = progressionColumns(calvin(), config, [passives])
  const rows = buildProgressionRows(calvin(), config, [passives], cols)

  it('marks the unlock, changes, carried-forward repeats, and renames', () => {
    const stream1 = rows.find(r => r.slot === 0)!
    expect(stream1.cells.map(c => c.state)).toEqual(['unlocked', 'changed', 'changed', 'same', 'changed'])
    expect(stream1.cells.map(c => c.renamed)).toEqual([false, false, false, false, true])
    expect(stream1.title).toBe('Silken Sight')
  })

  it('leaves a slot empty until the era it unlocks at', () => {
    const stream2 = rows.find(r => r.slot === 1)!
    expect(stream2.cells.map(c => c.state)).toEqual(['empty', 'empty', 'unlocked', 'same', 'same'])
    expect(stream2.title).toBe('Abyssal Mantal')
  })

  it('never lets a hidden era feed a visible one', () => {
    const opts = { eraIds: ['marked', 'loomed'] }
    const visibleCols = progressionColumns(calvin(), config, [passives], opts)
    expect(visibleCols.map(c => c.id)).toEqual(['marked', 'loomed'])
    const visibleRows = buildProgressionRows(calvin(), config, [passives], visibleCols, opts)
    // Loomed inherits from Marked (Woven is hidden), so Stream 2 never appears.
    expect(visibleRows).toHaveLength(1)
    expect(visibleRows[0]!.cells.map(c => c.state)).toEqual(['unlocked', 'same'])
    expect(visibleRows[0]!.cells[1]!.item!.description).toBe('Pattern reading')
  })

  it('keeps later slots aligned past a cleared one, and ignores number-only rows', () => {
    const data = calvin()
    data._variants.items.marked.overrides.passives = [{} as any, mantle, { tier: 2 } as any]
    const onlyMarked = { eraIds: ['marked'] }
    const markedRows = buildProgressionRows(data, config, [passives], progressionColumns(data, config, [passives], onlyMarked), onlyMarked)
    expect(markedRows.map(r => r.slot)).toEqual([1])
  })
})

describe('progressionHasContent', () => {
  it('is false with no eras and an empty base', () => {
    expect(progressionHasContent({ name: 'Blank' }, config, [passives], { includeBase: true })).toBe(false)
  })

  it('is true for base-only content when the base may show', () => {
    const data = { name: 'Blank', passives: [mantle] }
    expect(progressionHasContent(data, config, [passives], { includeBase: true })).toBe(true)
    expect(progressionHasContent(data, config, [passives], { includeBase: false })).toBe(false)
  })
})
