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
  /** Row layout (SlotTable): the label is read by screen readers and shown as the placeholder. */
  compact?: boolean
}

function humanize(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function JsonSchemaFieldInput({ fieldKey, field, value, onChange, compact = false }: JsonSchemaFieldInputProps) {
  const label = field.label || humanize(fieldKey)
  const labelClass = compact
    ? 'sr-only'
    : 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1'

  // Defaults are shown as placeholders, never as real input values — otherwise
  // a hint-value is indistinguishable from a value the author actually chose.
  const defaultHint = field.default !== undefined && field.default !== null && field.default !== ''
    ? String(field.default)
    : undefined

  switch (field.type) {
    case 'number':
      return (
        <div>
          <label className={labelClass}>
            {label}
          </label>
          <input
            type="number"
            value={value ?? ''}
            placeholder={defaultHint ?? (compact ? label : undefined)}
            aria-label={compact ? label : undefined}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            min={field.min}
            max={field.max}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm placeholder:italic placeholder:text-gray-400 dark:placeholder:text-gray-500"
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
          <label className={labelClass}>
            {label}
          </label>
          <select
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
            aria-label={compact ? label : undefined}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
          >
            <option value="">{defaultHint ? `${defaultHint} (default)` : compact ? label : 'Select…'}</option>
            {(field.options || []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      )

    case 'text':
    default:
      if (field.multiline) {
        return (
          <div>
            <label className={labelClass}>
              {label}
            </label>
            <textarea
              value={value ?? ''}
              placeholder={defaultHint ?? (compact ? label : undefined)}
              aria-label={compact ? label : undefined}
              onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
              rows={2}
              className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm leading-relaxed [field-sizing:content] min-h-[3.5rem] placeholder:italic placeholder:text-gray-400 dark:placeholder:text-gray-500"
            />
          </div>
        )
      }
      return (
        <div>
          <label className={labelClass}>
            {label}
          </label>
          <input
            type="text"
            value={value ?? ''}
            placeholder={defaultHint ?? (compact ? label : undefined)}
            aria-label={compact ? label : undefined}
            onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
            className="w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm placeholder:italic placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
        </div>
      )
  }
}
