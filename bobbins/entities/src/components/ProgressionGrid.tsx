/**
 * ProgressionGrid
 *
 * The `progression` section display: every slot of a list field laid out
 * across every era, so an author reads across a band to see an ability grow
 * from rank to rank. Wide containers get one column per era; narrow ones
 * (docked sidebar, phones) get a vertical rail per slot.
 *
 * Era order is the one thing this view encodes with color: a single hue whose
 * strength rises along the axis. Ranks are ordinal, so distinct hues per rank
 * would suggest they're unrelated.
 *
 * Needs the raw entity from `ProgressionProvider`; without one (previews) it
 * shows the current view's rows instead.
 */

import { useMemo } from 'react'
import type { FieldDefinition } from '../types'
import {
  buildProgressionRows,
  listSchemaOf,
  progressionColumns,
  type ProgressionCell,
  type ProgressionColumn,
  type ProgressionRow,
} from '../progression'
import { useProgressionContext } from './UploadContext'
import { SlotTable, formatSlotChip, slotLabel, splitSlotFields } from './json-renderers/SlotTable'

interface ProgressionGridProps {
  fields: FieldDefinition[]
  /** The entity as currently resolved — used only for the no-provider fallback. */
  entity: Record<string, any>
}

/** Violet-500 at a strength that rises with the era's position; the base column stays neutral. */
function rampColor(column: ProgressionColumn, eraIndex: number, eraCount: number): string {
  if (column.id === null) return 'rgb(156 163 175 / 0.5)'
  const alpha = eraCount <= 1 ? 1 : 0.35 + 0.65 * (eraIndex / (eraCount - 1))
  return `rgb(139 92 246 / ${alpha.toFixed(2)})`
}

/** For a `same` cell, the era it repeats — the last one where the slot actually changed. */
function sourceLabel(row: ProgressionRow, index: number, columns: ProgressionColumn[]): string | null {
  for (let j = index - 1; j >= 0; j--) {
    const state = row.cells[j]!.state
    if (state === 'unlocked' || state === 'changed') return columns[j]!.label
  }
  return null
}

function scrollToSlot(field: string, slot: number) {
  if (typeof window === 'undefined') return
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  // Two frames: one for the era switch to commit, one for the table to lay out.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.getElementById(`slot-${field}-${slot}`)?.scrollIntoView({
      block: 'center',
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }))
}

export function ProgressionGrid({ fields, entity }: ProgressionGridProps) {
  const ctx = useProgressionContext()
  const listFields = useMemo(() => fields.filter(f => listSchemaOf(f) !== null), [fields])

  const { columns, rows } = useMemo(() => {
    if (!ctx) return { columns: [] as ProgressionColumn[], rows: [] as ProgressionRow[] }
    const opts = { includeBase: ctx.includeBase, eraIds: ctx.eraIds }
    const cols = progressionColumns(ctx.data, ctx.config, listFields, opts)
    return { columns: cols, rows: buildProgressionRows(ctx.data, ctx.config, listFields, cols, opts) }
  }, [ctx, listFields])

  if (!ctx) {
    return (
      <div className="space-y-4">
        {listFields.map(field => (
          <SlotTable key={field.name} field={field} value={entity[field.name]} onChange={() => {}} readonly anchor={false} />
        ))}
      </div>
    )
  }

  // Axis labels are free text ("Aethread Status"), so copy never pluralizes them.
  const axis = ctx.axisLabel.toLowerCase()
  if (rows.length === 0) {
    const hasEras = columns.some(c => c.id !== null)
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {hasEras
          ? `Fill in ${listFields.map(f => f.label.toLowerCase()).join(' or ')} at any ${axis} to see them grow here.`
          : `Nothing to compare yet. Add entries from the ${ctx.axisLabel} bar above.`}
      </p>
    )
  }

  const eraCount = columns.filter(c => c.id !== null).length
  const colors = columns.map((col, i) => rampColor(col, columns[0]?.id === null ? i - 1 : i, eraCount))
  const select = ctx.onSelectVariant

  function choose(columnId: string | null, row?: ProgressionRow) {
    if (!select) return
    select(columnId)
    if (row) scrollToSlot(row.field, row.slot)
  }

  const groups = listFields
    .map(field => ({ field, schema: listSchemaOf(field)!, rows: rows.filter(r => r.field === field.name) }))
    .filter(g => g.rows.length > 0)

  return (
    <div>
      {/* Wide: one column per era */}
      <div className="hidden overflow-x-auto @2xl:block">
        <div
          className="grid min-w-full"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(10rem, 1fr))` }}
        >
          {columns.map((col, i) => {
            const active = col.id === ctx.activeVariantId
            return (
              <button
                key={col.id ?? '__base__'}
                type="button"
                onClick={() => choose(col.id)}
                disabled={!select}
                aria-pressed={active}
                className={`border-t-[3px] px-3 pb-2 pt-1.5 text-left text-sm disabled:cursor-default ${
                  select ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60' : ''
                } ${active
                  ? 'bg-gray-50 font-semibold text-gray-900 dark:bg-gray-800/60 dark:text-gray-100'
                  : 'text-gray-600 dark:text-gray-400'}`}
                style={{ borderTopColor: colors[i] }}
              >
                {col.label}
              </button>
            )
          })}

          {groups.map(({ field, schema, rows: groupRows }) => (
            <GroupBands
              key={field.name}
              label={groups.length > 1 ? field.label : null}
              schema={schema}
              rows={groupRows}
              columns={columns}
              activeId={ctx.activeVariantId}
              axis={axis}
              onChoose={select ? choose : null}
            />
          ))}
        </div>
      </div>

      {/* Narrow: a rail per slot */}
      <div className="space-y-5 @2xl:hidden">
        {groups.map(({ field, schema, rows: groupRows }) => (
          <div key={field.name} className="space-y-4">
            {groups.length > 1 && (
              <div className="text-sm font-medium text-gray-500 dark:text-gray-400">{field.label}</div>
            )}
            {groupRows.map(row => {
              const firstFilled = row.cells.findIndex(c => c.state !== 'empty')
              return (
                <div key={row.slot}>
                  <BandHeader schema={schema} row={row} unlocksAt={firstFilled > 0 ? columns[firstFilled]!.label : null} />
                  <ol className="mt-2 space-y-2">
                    {row.cells.map((cell, i) => {
                      if (cell.state === 'empty') return null
                      const active = cell.columnId === ctx.activeVariantId
                      return (
                        <li key={cell.columnId ?? '__base__'} className="border-l-[3px] pl-3" style={{ borderLeftColor: colors[i] }}>
                          <button
                            type="button"
                            onClick={() => choose(cell.columnId, row)}
                            disabled={!select}
                            className={`block w-full rounded text-left disabled:cursor-default ${select ? 'cursor-pointer' : ''}`}
                          >
                            <span className={`block text-xs ${active ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>
                              {columns[i]!.label}
                            </span>
                            <CellBody cell={cell} schema={schema} row={row} sameAs={sourceLabel(row, i, columns)} />
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function GroupBands({
  label,
  schema,
  rows,
  columns,
  activeId,
  axis,
  onChoose,
}: {
  label: string | null
  schema: NonNullable<ReturnType<typeof listSchemaOf>>
  rows: ProgressionRow[]
  columns: ProgressionColumn[]
  activeId: string | null
  axis: string
  onChoose: ((columnId: string | null, row?: ProgressionRow) => void) | null
}) {
  return (
    <>
      {label && (
        <div className="col-span-full px-3 pb-1 pt-5 text-sm font-medium text-gray-500 dark:text-gray-400">
          {label}
        </div>
      )}
      {rows.map(row => (
        <div key={row.slot} className="contents">
          <div className="col-span-full border-t border-gray-200 px-3 pb-1 pt-3 dark:border-gray-700">
            <BandHeader schema={schema} row={row} unlocksAt={null} />
          </div>
          {row.cells.map((cell, i) => {
            const active = cell.columnId === activeId
            const tint = active ? 'bg-gray-50 dark:bg-gray-800/60' : ''
            if (cell.state === 'empty') {
              // Left blank on purpose: the "Unlocked" marker already shows where
              // a slot begins, and a placeholder box reads as an empty input.
              const seenBefore = row.cells.slice(0, i).some(c => c.state !== 'empty')
              return (
                <div key={cell.columnId ?? '__base__'} className={`px-3 py-2 ${tint}`}>
                  <span className="sr-only">
                    {seenBefore ? `Nothing at this ${axis}` : 'Not unlocked yet'}
                  </span>
                </div>
              )
            }
            return (
              <button
                key={cell.columnId ?? '__base__'}
                type="button"
                onClick={() => onChoose?.(cell.columnId, row)}
                disabled={!onChoose}
                aria-label={onChoose ? `Show ${columns[i]!.label}` : undefined}
                className={`flex flex-col justify-start px-3 py-2 text-left disabled:cursor-default ${tint} ${
                  onChoose ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60' : ''
                }`}
              >
                <CellBody cell={cell} schema={schema} row={row} sameAs={sourceLabel(row, i, columns)} />
              </button>
            )
          })}
        </div>
      ))}
    </>
  )
}

/** "Stream 2 · Abyssal Mantal" plus the slot's latest select values (its school, say). */
function BandHeader({
  schema,
  row,
  unlocksAt,
}: {
  schema: NonNullable<ReturnType<typeof listSchemaOf>>
  row: ProgressionRow
  unlocksAt: string | null
}) {
  const latest = [...row.cells].reverse().find(c => c.item)?.item ?? {}
  const selects = splitSlotFields(schema).chipEntries.filter(([, f]) => f.type === 'select')
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        {slotLabel(schema, row.slot)}
        {row.title && <span className="font-normal text-gray-500 dark:text-gray-400"> · </span>}
        {row.title}
      </span>
      {selects.map(([key]) =>
        latest[key] ? (
          <span key={key} className="text-xs text-gray-600 dark:text-gray-400">{latest[key]}</span>
        ) : null
      )}
      {unlocksAt && (
        <span className="text-xs text-gray-500 dark:text-gray-400">unlocks at {unlocksAt}</span>
      )}
    </div>
  )
}

function CellBody({
  cell,
  schema,
  row,
  sameAs,
}: {
  cell: ProgressionCell
  schema: NonNullable<ReturnType<typeof listSchemaOf>>
  row: ProgressionRow
  /** The era a `same` cell repeats. */
  sameAs: string | null
}) {
  const item = cell.item!
  if (cell.state === 'same') {
    return (
      <span className="block text-xs italic text-gray-400 dark:text-gray-500">
        Same as {sameAs}
      </span>
    )
  }
  const { titleKey, chipEntries, bodyEntries } = splitSlotFields(schema)
  // Selects already sit in the band header; repeat one only where this era differs.
  const latest = [...row.cells].reverse().find(c => c.item)?.item ?? {}
  const chips = chipEntries
    .filter(([key, f]) => f.type !== 'select' || item[key] !== latest[key])
    .map(([key, f]) => formatSlotChip(f.label || key, f.type, item[key]))
    .filter((c): c is string => c !== null)

  return (
    <span className="block">
      <span className="flex flex-wrap items-center gap-1.5">
        {cell.state === 'unlocked' && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-300">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-violet-500" />
            Unlocked
          </span>
        )}
        {chips.map(chip => (
          <span key={chip} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {chip}
          </span>
        ))}
      </span>
      {cell.renamed && titleKey && item[titleKey] && (
        <span className="mt-1 block text-sm font-semibold text-gray-900 dark:text-gray-100">{item[titleKey]}</span>
      )}
      {bodyEntries.map(([key]) =>
        item[key] ? (
          <span key={key} className="mt-1 block whitespace-pre-line text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            {item[key]}
          </span>
        ) : null
      )}
    </span>
  )
}
