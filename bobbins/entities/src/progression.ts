/**
 * Progression model — how list fields grow across the eras of a variant axis.
 *
 * A `progression` section lays each list slot out as a band of cells, one per
 * era: read across a band to see an ability at every rank. This file is the
 * pure half of that view; `components/ProgressionGrid.tsx` renders it.
 *
 * Slots are identified by position — "Stream 1" is index 0 at every era —
 * which is how authors number them. Each column is resolved with
 * `resolveEntityForVariant`, so forward inheritance and the reader's
 * tier-visible era set apply exactly as they do for a single era.
 */

import {
  getVariantsBlock,
  resolveEntityForVariant,
  sortedVariantIds,
  type VariantResolutionConfig,
} from '@bobbinry/types'
import type { FieldDefinition, JsonSchema } from './types'
import { normalizeJsonSchema } from './types'

export interface ProgressionColumn {
  /** Variant id, or null for the base view. */
  id: string | null
  label: string
}

/**
 * - `empty` — the slot has nothing at this era (not unlocked yet, or dropped)
 * - `unlocked` — the first era the slot has content
 * - `changed` — differs from the previous era
 * - `same` — identical to the previous era
 */
export type ProgressionCellState = 'empty' | 'unlocked' | 'changed' | 'same'

export interface ProgressionCell {
  columnId: string | null
  state: ProgressionCellState
  item: Record<string, any> | null
  /** The slot's title differs from its previous filled era (e.g. an ability renamed on ascension). */
  renamed: boolean
}

export interface ProgressionRow {
  field: string
  /** 0-based position in the list — the slot number minus one. */
  slot: number
  /** The slot's latest non-empty title across all eras. */
  title: string
  cells: ProgressionCell[]
}

export interface ProgressionOptions {
  /** Offer a Base column when the base itself holds content for these fields. */
  includeBase?: boolean
  /** Eras the caller may see; hidden eras never become columns or feed inherited values. */
  eraIds?: readonly string[] | undefined
}

/** The schema of a list-mode JSON field, or null for anything else. */
export function listSchemaOf(field: FieldDefinition): JsonSchema | null {
  if (field.type !== 'json') return null
  const schema = normalizeJsonSchema(field.schema)
  return schema?.mode === 'list' ? schema : null
}

/** First text sub-field — the item's title, matching the list editor's rule. */
export function listTitleKey(schema: JsonSchema): string | undefined {
  return Object.entries(schema.fields).find(([, f]) => f.type === 'text')?.[0]
}

/** Read a list field's value, tolerating a bare item object the way the readonly display does. */
export function listItemsOf(value: unknown): Record<string, any>[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return [value as Record<string, any>]
  return []
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

/**
 * An item counts as filled once any text or select value is set. Numbers and
 * booleans alone don't: a row holding only "Tier 1" hasn't been written yet.
 */
export function isFilledItem(item: unknown, schema: JsonSchema): boolean {
  if (!item || typeof item !== 'object') return false
  const record = item as Record<string, any>
  return Object.entries(schema.fields).some(
    ([key, f]) => (f.type === 'text' || f.type === 'select') && !isBlank(record[key])
  )
}

/** Order-insensitive fingerprint of an item's set values, for era-to-era comparison. */
function fingerprint(item: Record<string, any>): string {
  const keys = Object.keys(item).filter(k => !isBlank(item[k])).sort()
  return JSON.stringify(keys.map(k => [k, item[k]]))
}

function resolutionOpts(opts: ProgressionOptions) {
  return opts.eraIds ? { eraIds: opts.eraIds } : undefined
}

/** Columns for a progression: the base (when it holds content) and then every visible era in order. */
export function progressionColumns(
  data: Record<string, any> | null | undefined,
  config: VariantResolutionConfig | null | undefined,
  fields: FieldDefinition[],
  opts: ProgressionOptions = {}
): ProgressionColumn[] {
  const columns: ProgressionColumn[] = []
  if (opts.includeBase) {
    const base = resolveEntityForVariant(data, config, null)
    const baseHasContent = fields.some(field => {
      const schema = listSchemaOf(field)
      return schema !== null && listItemsOf(base[field.name]).some(item => isFilledItem(item, schema))
    })
    if (baseHasContent) columns.push({ id: null, label: 'Base' })
  }
  const block = getVariantsBlock(data)
  for (const id of sortedVariantIds(data, config?.variantAxis?.kind ?? null, resolutionOpts(opts))) {
    columns.push({ id, label: block?.items[id]?.label || id })
  }
  return columns
}

/** One band per filled slot of each list field, with a cell per column. */
export function buildProgressionRows(
  data: Record<string, any> | null | undefined,
  config: VariantResolutionConfig | null | undefined,
  fields: FieldDefinition[],
  columns: ProgressionColumn[],
  opts: ProgressionOptions = {}
): ProgressionRow[] {
  const resolved = columns.map(col => resolveEntityForVariant(data, config, col.id, resolutionOpts(opts)))
  const rows: ProgressionRow[] = []

  for (const field of fields) {
    const schema = listSchemaOf(field)
    if (!schema) continue
    const titleKey = listTitleKey(schema)
    const lists = resolved.map(view => listItemsOf(view[field.name]))
    const slotCount = Math.max(0, ...lists.map(list => list.length))

    for (let slot = 0; slot < slotCount; slot++) {
      const cells: ProgressionCell[] = []
      let seenFilled = false
      let previousPrint: string | null = null
      let previousTitle: string | null = null
      let title = ''

      lists.forEach((list, colIndex) => {
        const raw = list[slot]
        const item = isFilledItem(raw, schema) ? raw! : null
        const columnId = columns[colIndex]!.id
        if (!item) {
          cells.push({ columnId, state: 'empty', item: null, renamed: false })
          previousPrint = null
          return
        }
        const print = fingerprint(item)
        const itemTitle = titleKey && !isBlank(item[titleKey]) ? String(item[titleKey]) : ''
        const state: ProgressionCellState = !seenFilled
          ? 'unlocked'
          : print === previousPrint ? 'same' : 'changed'
        const renamed = seenFilled && previousTitle !== null && itemTitle !== '' && itemTitle !== previousTitle
        cells.push({ columnId, state, item, renamed })
        seenFilled = true
        previousPrint = print
        if (itemTitle) {
          previousTitle = itemTitle
          title = itemTitle
        }
      })

      if (seenFilled) rows.push({ field: field.name, slot, title, cells })
    }
  }

  return rows
}

/** Whether a progression over these fields would show anything at all. */
export function progressionHasContent(
  data: Record<string, any> | null | undefined,
  config: VariantResolutionConfig | null | undefined,
  fields: FieldDefinition[],
  opts: ProgressionOptions = {}
): boolean {
  const columns = progressionColumns(data, config, fields, opts)
  if (columns.length === 0) return false
  return buildProgressionRows(data, config, fields, columns, opts).length > 0
}
