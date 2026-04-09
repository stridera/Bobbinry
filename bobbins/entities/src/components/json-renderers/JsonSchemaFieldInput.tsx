/**
 * Shared input component for rendering a single field within a JSON schema.
 * Handles text, number, boolean, and select types.
 */

import type { JsonSchemaField } from '../../types'

interface JsonSchemaFieldInputProps {
  fieldKey: string
  field: JsonSchemaField
  value: any
  onChange: (value: any) => void
}

function humanize(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function JsonSchemaFieldInput({ fieldKey, field, value, onChange }: JsonSchemaFieldInputProps) {
  const label = field.label || humanize(fieldKey)

  switch (field.type) {
    case 'number':
      return (
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            {label}
          </label>
          <input
            type="number"
            value={value ?? field.default ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            min={field.min}
            max={field.max}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          />
        </div>
      )

    case 'boolean':
      return (
        <div className="flex items-center gap-2 py-1.5">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600"
          />
          <label className="text-sm text-gray-700 dark:text-gray-300">{label}</label>
        </div>
      )

    case 'select':
      return (
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            {label}
          </label>
          <select
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          >
            <option value="">Select...</option>
            {(field.options || []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      )

    case 'text':
    default:
      return (
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            {label}
          </label>
          <input
            type="text"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          />
        </div>
      )
  }
}
