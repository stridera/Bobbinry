/**
 * ListFormRenderer
 *
 * Renders an array of structured items with add/remove/reorder.
 * Used for schema mode: 'list' (e.g., abilities, subclasses).
 */

import { useState } from 'react'
import type { JsonSchema } from '../../types'
import { JsonSchemaFieldInput } from './JsonSchemaFieldInput'

interface ListFormRendererProps {
  schema: JsonSchema
  value: any[]
  onChange: (value: any[]) => void
}

function createEmptyItem(schema: JsonSchema): Record<string, any> {
  const item: Record<string, any> = {}
  for (const [key, field] of Object.entries(schema.fields)) {
    item[key] = field.default ?? (field.type === 'number' ? 0 : field.type === 'boolean' ? false : '')
  }
  return item
}

function getItemTitle(item: Record<string, any>, schema: JsonSchema): string {
  // Use the first text field as the display title
  const firstTextKey = Object.entries(schema.fields).find(([, f]) => f.type === 'text')?.[0]
  if (firstTextKey && item[firstTextKey]) return item[firstTextKey]
  return 'Untitled'
}

export function ListFormRenderer({ schema, value, onChange }: ListFormRendererProps) {
  const items = Array.isArray(value) ? value : []
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const itemLabel = schema.itemLabel || 'Item'
  const fieldEntries = Object.entries(schema.fields)

  function handleItemChange(index: number, key: string, fieldValue: any) {
    const updated = items.map((item, i) =>
      i === index ? { ...item, [key]: fieldValue } : item
    )
    onChange(updated)
  }

  function handleAdd() {
    const newItems = [...items, createEmptyItem(schema)]
    onChange(newItems)
    setExpandedIndex(newItems.length - 1)
  }

  function handleRemove(index: number) {
    onChange(items.filter((_, i) => i !== index))
    if (expandedIndex === index) setExpandedIndex(null)
    else if (expandedIndex !== null && expandedIndex > index) setExpandedIndex(expandedIndex - 1)
  }

  function handleMoveUp(index: number) {
    if (index === 0) return
    const updated = [...items]
    ;[updated[index - 1], updated[index]] = [updated[index], updated[index - 1]]
    onChange(updated)
    if (expandedIndex === index) setExpandedIndex(index - 1)
    else if (expandedIndex === index - 1) setExpandedIndex(index)
  }

  function handleMoveDown(index: number) {
    if (index >= items.length - 1) return
    const updated = [...items]
    ;[updated[index], updated[index + 1]] = [updated[index + 1], updated[index]]
    onChange(updated)
    if (expandedIndex === index) setExpandedIndex(index + 1)
    else if (expandedIndex === index + 1) setExpandedIndex(index)
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const isExpanded = expandedIndex === index
        const title = getItemTitle(item, schema)

        return (
          <div
            key={index}
            className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
          >
            {/* Header */}
            <div
              className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 cursor-pointer"
              onClick={() => setExpandedIndex(isExpanded ? null : index)}
            >
              <span className="text-xs text-gray-400">{isExpanded ? '▼' : '▶'}</span>
              <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                {title}
              </span>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => handleMoveUp(index)}
                  disabled={index === 0}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                  title="Move up"
                >↑</button>
                <button
                  type="button"
                  onClick={() => handleMoveDown(index)}
                  disabled={index >= items.length - 1}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                  title="Move down"
                >↓</button>
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className="p-1 text-red-400 hover:text-red-600 cursor-pointer"
                  title={`Remove ${itemLabel.toLowerCase()}`}
                >&times;</button>
              </div>
            </div>

            {/* Expanded fields */}
            {isExpanded && (
              <div className="px-3 py-3 space-y-3 border-t border-gray-200 dark:border-gray-700">
                {fieldEntries.map(([key, field]) => (
                  <JsonSchemaFieldInput
                    key={key}
                    fieldKey={key}
                    field={field}
                    value={item[key]}
                    onChange={(v) => handleItemChange(index, key, v)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}

      <button
        type="button"
        onClick={handleAdd}
        className="w-full px-3 py-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 dark:hover:border-blue-500 dark:hover:text-blue-400 cursor-pointer"
      >
        + Add {itemLabel}
      </button>
    </div>
  )
}
