/**
 * KeyedListFormRenderer
 *
 * Renders items grouped under user-defined keys (accordion style).
 * Used for schema mode: 'keyed-list' (e.g., class features by level).
 *
 * Data shape: { "1": [{ name: "Fighting Style", ... }], "3": [{ ... }] }
 */

import { useState } from 'react'
import type { JsonSchema } from '../../types'
import { JsonSchemaFieldInput } from './JsonSchemaFieldInput'

interface KeyedListFormRendererProps {
  schema: JsonSchema
  value: Record<string, any[]>
  onChange: (value: Record<string, any[]>) => void
}

function createEmptyItem(schema: JsonSchema): Record<string, any> {
  const item: Record<string, any> = {}
  for (const [key, field] of Object.entries(schema.fields)) {
    item[key] = field.default ?? (field.type === 'number' ? 0 : field.type === 'boolean' ? false : '')
  }
  return item
}

export function KeyedListFormRenderer({ schema, value, onChange }: KeyedListFormRendererProps) {
  const data = (typeof value === 'object' && value !== null && !Array.isArray(value)) ? value : {}
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const keyLabel = schema.keyLabel || 'Key'
  const keyType = schema.keyType || 'text'
  const itemLabel = schema.itemLabel || 'Item'
  const fieldEntries = Object.entries(schema.fields)

  // Sort keys: numeric keys sorted numerically, text keys alphabetically
  const sortedKeys = Object.keys(data).sort((a, b) => {
    if (keyType === 'number') return Number(a) - Number(b)
    return a.localeCompare(b)
  })

  function handleAddGroup() {
    // Find next key
    let nextKey: string
    if (keyType === 'number') {
      const maxKey = sortedKeys.reduce((max, k) => Math.max(max, Number(k) || 0), 0)
      nextKey = String(maxKey + 1)
    } else {
      nextKey = `${keyLabel} ${sortedKeys.length + 1}`
    }
    onChange({ ...data, [nextKey]: [createEmptyItem(schema)] })
    setExpandedKey(nextKey)
  }

  function handleRemoveGroup(key: string) {
    const updated = { ...data }
    delete updated[key]
    onChange(updated)
    if (expandedKey === key) setExpandedKey(null)
  }

  function handleRenameGroup(oldKey: string, newKey: string) {
    if (newKey === oldKey || !newKey.trim()) return
    const updated: Record<string, any[]> = {}
    for (const k of Object.keys(data)) {
      updated[k === oldKey ? newKey : k] = data[k] || []
    }
    onChange(updated)
    if (expandedKey === oldKey) setExpandedKey(newKey)
  }

  function handleAddItem(groupKey: string) {
    const group = data[groupKey] || []
    onChange({ ...data, [groupKey]: [...group, createEmptyItem(schema)] })
  }

  function handleRemoveItem(groupKey: string, itemIndex: number) {
    const group = (data[groupKey] || []).filter((_, i) => i !== itemIndex)
    onChange({ ...data, [groupKey]: group })
  }

  function handleItemFieldChange(groupKey: string, itemIndex: number, fieldKey: string, fieldValue: any) {
    const group = (data[groupKey] || []).map((item, i) =>
      i === itemIndex ? { ...item, [fieldKey]: fieldValue } : item
    )
    onChange({ ...data, [groupKey]: group })
  }

  return (
    <div className="space-y-2">
      {sortedKeys.map(groupKey => {
        const items = data[groupKey] || []
        const isExpanded = expandedKey === groupKey

        return (
          <div
            key={groupKey}
            className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
          >
            {/* Group Header */}
            <div
              className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 cursor-pointer"
              onClick={() => setExpandedKey(isExpanded ? null : groupKey)}
            >
              <span className="text-xs text-gray-400">{isExpanded ? '▼' : '▶'}</span>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                {keyLabel}
              </span>
              <input
                type={keyType === 'number' ? 'number' : 'text'}
                value={groupKey}
                onChange={(e) => handleRenameGroup(groupKey, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="w-20 px-2 py-0.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100"
              />
              <span className="flex-1 text-xs text-gray-400">
                {items.length} {items.length === 1 ? itemLabel.toLowerCase() : `${itemLabel.toLowerCase()}s`}
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleRemoveGroup(groupKey) }}
                className="p-1 text-red-400 hover:text-red-600 cursor-pointer"
                title="Remove group"
              >&times;</button>
            </div>

            {/* Expanded Items */}
            {isExpanded && (
              <div className="px-3 py-2 space-y-3 border-t border-gray-200 dark:border-gray-700">
                {items.map((item, itemIndex) => {
                  const firstTextKey = Object.entries(schema.fields).find(([, f]) => f.type === 'text')?.[0]
                  const itemTitle = firstTextKey && item[firstTextKey] ? item[firstTextKey] : `${itemLabel} ${itemIndex + 1}`

                  return (
                    <div key={itemIndex} className="border border-gray-200 dark:border-gray-700 rounded p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{itemTitle}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(groupKey, itemIndex)}
                          className="text-xs text-red-400 hover:text-red-600 cursor-pointer"
                        >Remove</button>
                      </div>
                      {fieldEntries.map(([key, field]) => (
                        <JsonSchemaFieldInput
                          key={key}
                          fieldKey={key}
                          field={field}
                          value={item[key]}
                          onChange={(v) => handleItemFieldChange(groupKey, itemIndex, key, v)}
                        />
                      ))}
                    </div>
                  )
                })}

                <button
                  type="button"
                  onClick={() => handleAddItem(groupKey)}
                  className="w-full px-3 py-1.5 border border-dashed border-gray-300 dark:border-gray-600 rounded text-xs text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 cursor-pointer"
                >
                  + Add {itemLabel}
                </button>
              </div>
            )}
          </div>
        )
      })}

      <button
        type="button"
        onClick={handleAddGroup}
        className="w-full px-3 py-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 dark:hover:border-blue-500 dark:hover:text-blue-400 cursor-pointer"
      >
        + Add {keyLabel}
      </button>
    </div>
  )
}
