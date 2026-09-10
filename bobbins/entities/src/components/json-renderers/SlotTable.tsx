/**
 * SlotTable
 *
 * A list-mode JSON field as numbered rows — "Stream 1", "Stream 2" — edited
 * inline rather than behind collapsible items. Used by the `table` section
 * display and as the progression grid's fallback.
 *
 * Slots are positional: the progression grid lines "Stream 2" up across every
 * era by index. So clearing a middle row keeps its slot (it reads as not yet
 * unlocked) and only the last row is actually removed; deleting from the
 * middle would silently shift every later slot at this era only.
 */

import { useEffect, useRef, useState } from 'react'
import type { FieldDefinition, JsonSchema } from '../../types'
import { JsonSchemaFieldInput } from './JsonSchemaFieldInput'
import { isFilledItem, listItemsOf, listSchemaOf, listTitleKey } from '../../progression'

interface SlotTableProps {
  field: FieldDefinition
  value: unknown
  onChange: (value: Record<string, any>[]) => void
  readonly?: boolean
  /** Show the field label above the rows (off when a section title already names it). */
  showLabel?: boolean
  /** Give rows `slot-{field}-{index}` ids so the progression grid can scroll to them. */
  anchor?: boolean
}

/** Title first, then short values (select/number/boolean), then the remaining text. */
export function splitSlotFields(schema: JsonSchema) {
  const entries = Object.entries(schema.fields)
  const titleKey = listTitleKey(schema)
  return {
    titleKey,
    chipEntries: entries.filter(([, f]) => f.type === 'select' || f.type === 'number' || f.type === 'boolean'),
    bodyEntries: entries.filter(([k, f]) => f.type === 'text' && k !== titleKey),
  }
}

/** A short value rendered as a chip: "Tier 2" for numbers, the option itself for selects. */
export function formatSlotChip(label: string, type: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (type === 'number') return `${label} ${value}`
  if (type === 'boolean') return value ? label : null
  return String(value)
}

export function slotLabel(schema: JsonSchema, index: number): string {
  return `${schema.itemLabel || 'Item'} ${index + 1}`
}

export function SlotTable({ field, value, onChange, readonly = false, showLabel = true, anchor = true }: SlotTableProps) {
  const schema = listSchemaOf(field)
  const items = listItemsOf(value)
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    if (focusIndex === null) return
    rowRefs.current[focusIndex]?.querySelector<HTMLElement>('input, textarea, select')?.focus()
    setFocusIndex(null)
  }, [focusIndex])

  if (!schema) return null
  const { titleKey, chipEntries, bodyEntries } = splitSlotFields(schema)
  const itemLabel = schema.itemLabel || 'Item'

  function update(index: number, key: string, next: unknown) {
    onChange(items.map((item, i) => (i === index ? { ...item, [key]: next } : item)))
  }

  function add() {
    onChange([...items, {}])
    setFocusIndex(items.length)
  }

  function clearOrRemove(index: number) {
    if (index < items.length - 1) {
      onChange(items.map((item, i) => (i === index ? {} : item)))
      return
    }
    // Removing the last row also drops any cleared rows it leaves trailing.
    const next = items.slice(0, index)
    while (next.length > 0 && !isFilledItem(next[next.length - 1], schema!)) next.pop()
    onChange(next)
  }

  const heading = showLabel && (
    <div className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{field.label}</div>
  )

  if (readonly) {
    const filled = items.map((item, index) => ({ item, index })).filter(({ item }) => isFilledItem(item, schema))
    if (filled.length === 0) return null
    return (
      <div>
        {heading}
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {filled.map(({ item, index }) => {
            const chips = chipEntries
              .map(([key, f]) => formatSlotChip(f.label || key, f.type, item[key]))
              .filter((c): c is string => c !== null)
            return (
              <div
                key={index}
                id={anchor ? `slot-${field.name}-${index}` : undefined}
                className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 @md:flex-row @md:gap-4"
              >
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 @md:w-24 @md:shrink-0 @md:pt-0.5">
                  {slotLabel(schema, index)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    {titleKey && item[titleKey] && (
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item[titleKey]}</span>
                    )}
                    {chips.map(chip => (
                      <span key={chip} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                        {chip}
                      </span>
                    ))}
                  </div>
                  {bodyEntries.map(([key]) =>
                    item[key] ? (
                      <p key={key} className="mt-1 whitespace-pre-line text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                        {item[key]}
                      </p>
                    ) : null
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      {heading}
      <div className="space-y-2">
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          const label = slotLabel(schema, index)
          return (
            <div
              key={index}
              ref={el => { rowRefs.current[index] = el }}
              id={anchor ? `slot-${field.name}-${index}` : undefined}
              className="flex flex-col gap-2 rounded-md border border-gray-200 p-2 dark:border-gray-700 @md:flex-row @md:gap-3"
            >
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 @md:w-24 @md:shrink-0 @md:pt-2">
                {label}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-start gap-2">
                  {titleKey && (
                    <div className="min-w-[10rem] flex-1">
                      <JsonSchemaFieldInput
                        compact
                        fieldKey={titleKey}
                        field={schema.fields[titleKey]!}
                        value={item[titleKey]}
                        onChange={v => update(index, titleKey, v)}
                      />
                    </div>
                  )}
                  {chipEntries.map(([key, f]) => (
                    <div key={key} className={f.type === 'number' ? 'w-20' : f.type === 'boolean' ? '' : 'w-40'}>
                      <JsonSchemaFieldInput
                        compact
                        fieldKey={key}
                        field={f}
                        value={item[key]}
                        onChange={v => update(index, key, v)}
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => clearOrRemove(index)}
                    aria-label={isLast ? `Remove ${label}` : `Clear ${label}`}
                    title={isLast ? `Remove ${label}` : `Clear ${label} (later slots keep their numbers)`}
                    className="ml-auto cursor-pointer rounded px-2 py-1 text-sm text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                  >
                    &times;
                  </button>
                </div>
                {bodyEntries.map(([key, f]) => (
                  <JsonSchemaFieldInput
                    key={key}
                    compact
                    fieldKey={key}
                    field={f}
                    value={item[key]}
                    onChange={v => update(index, key, v)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-2 w-full cursor-pointer rounded-lg border-2 border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 dark:border-gray-600 dark:text-gray-400 dark:hover:border-blue-500 dark:hover:text-blue-400"
      >
        + Add {itemLabel}
      </button>
    </div>
  )
}
