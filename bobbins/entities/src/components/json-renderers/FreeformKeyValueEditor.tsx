/**
 * FreeformKeyValueEditor
 *
 * Fallback editor for JSON fields without a schema.
 * Renders as a list of editable key-value rows with an "Edit as JSON" toggle.
 */

import { useState, useEffect } from 'react'

interface FreeformKeyValueEditorProps {
  value: any
  onChange: (value: any) => void
}

interface KVRow {
  key: string
  value: string
}

function objectToRows(obj: any): KVRow[] {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return []
  return Object.entries(obj).map(([key, val]) => ({
    key,
    value: typeof val === 'string' ? val : JSON.stringify(val),
  }))
}

function rowsToObject(rows: KVRow[]): Record<string, any> {
  const obj: Record<string, any> = {}
  for (const row of rows) {
    if (!row.key.trim()) continue
    const num = Number(row.value)
    if (row.value !== '' && !isNaN(num)) {
      obj[row.key] = num
    } else if (row.value === 'true') {
      obj[row.key] = true
    } else if (row.value === 'false') {
      obj[row.key] = false
    } else {
      obj[row.key] = row.value
    }
  }
  return obj
}

export function FreeformKeyValueEditor({ value, onChange }: FreeformKeyValueEditorProps) {
  const [showRawJson, setShowRawJson] = useState(false)
  const [rawJson, setRawJson] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  // Track rows in local state so empty-key rows persist until filled in
  const [rows, setRows] = useState<KVRow[]>(() => objectToRows(value))

  // Sync from parent when value changes externally (e.g., after save)
  useEffect(() => {
    const externalRows = objectToRows(value)
    // Only sync if the keyed data actually changed (ignore empty-key rows we're tracking locally)
    const currentKeyed = rowsToObject(rows)
    const externalKeyed = rowsToObject(externalRows)
    if (JSON.stringify(currentKeyed) !== JSON.stringify(externalKeyed)) {
      setRows(externalRows)
    }
  }, [value])

  function handleRowChange(index: number, field: 'key' | 'value', newVal: string) {
    const updated = rows.map((r, i) =>
      i === index ? { ...r, [field]: newVal } : r
    )
    setRows(updated)
    onChange(rowsToObject(updated))
  }

  function handleAddRow() {
    setRows(prev => [...prev, { key: '', value: '' }])
  }

  function handleRemoveRow(index: number) {
    const updated = rows.filter((_, i) => i !== index)
    setRows(updated)
    onChange(rowsToObject(updated))
  }

  function handleToggleRawJson() {
    if (!showRawJson) {
      setRawJson(JSON.stringify(value || {}, null, 2))
      setJsonError(null)
    } else {
      try {
        const parsed = JSON.parse(rawJson)
        onChange(parsed)
        setRows(objectToRows(parsed))
        setJsonError(null)
      } catch {
        setJsonError('Invalid JSON — fix before switching back')
        return
      }
    }
    setShowRawJson(!showRawJson)
  }

  if (showRawJson) {
    return (
      <div className="space-y-2">
        <textarea
          value={rawJson}
          onChange={(e) => {
            setRawJson(e.target.value)
            try {
              onChange(JSON.parse(e.target.value))
              setJsonError(null)
            } catch {
              setJsonError('Invalid JSON')
            }
          }}
          rows={8}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm"
          spellCheck={false}
        />
        {jsonError && (
          <p className="text-xs text-red-500">{jsonError}</p>
        )}
        <button
          type="button"
          onClick={handleToggleRawJson}
          className="text-xs text-blue-500 hover:text-blue-600 cursor-pointer"
        >
          Switch to key-value editor
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={row.key}
                onChange={(e) => handleRowChange(index, 'key', e.target.value)}
                placeholder="Key"
                autoFocus={!row.key}
                className="w-1/3 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
              />
              <input
                type="text"
                value={row.value}
                onChange={(e) => handleRowChange(index, 'value', e.target.value)}
                placeholder="Value"
                className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
              />
              <button
                type="button"
                onClick={() => handleRemoveRow(index)}
                className="p-1 text-red-400 hover:text-red-600 cursor-pointer"
              >&times;</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleAddRow}
          className="px-3 py-1.5 border border-dashed border-gray-300 dark:border-gray-600 rounded text-xs text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 cursor-pointer"
        >
          + Add entry
        </button>
        <button
          type="button"
          onClick={handleToggleRawJson}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
        >
          Edit as JSON
        </button>
      </div>
    </div>
  )
}
