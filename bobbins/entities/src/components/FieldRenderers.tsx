/**
 * Field Renderer Components
 *
 * Type-specific renderers for each field type
 *
 * TODO: Implement renderers for:
 * - text: Simple text input
 * - number: Number input with min/max
 * - select: Dropdown with options
 * - multi-select: Multi-select dropdown
 * - boolean: Checkbox
 * - date: Date picker
 * - json: JSON editor (Monaco or simple textarea)
 * - rich-text: TipTap rich text editor
 * - image: Image upload with preview
 */

import type { FieldDefinition, FieldType } from '../types'

interface FieldRendererProps {
  field: FieldDefinition
  value: any
  onChange: (value: any) => void
  display?: 'inline' | 'stacked' | 'json-editor' | 'rich-text'
}

export function FieldRenderer({ field, value, onChange, display }: FieldRendererProps) {
  // Route to appropriate renderer based on field type
  switch (field.type) {
    case 'text':
      return <TextFieldRenderer field={field} value={value} onChange={onChange} />
    case 'number':
      return <NumberFieldRenderer field={field} value={value} onChange={onChange} />
    case 'select':
      return <SelectFieldRenderer field={field} value={value} onChange={onChange} />
    case 'multi-select':
      return <MultiSelectFieldRenderer field={field} value={value} onChange={onChange} />
    case 'boolean':
      return <BooleanFieldRenderer field={field} value={value} onChange={onChange} />
    case 'date':
      return <DateFieldRenderer field={field} value={value} onChange={onChange} />
    case 'json':
      return <JsonFieldRenderer field={field} value={value} onChange={onChange} />
    case 'rich-text':
      return <RichTextFieldRenderer field={field} value={value} onChange={onChange} />
    case 'image':
      return <ImageFieldRenderer field={field} value={value} onChange={onChange} />
    default:
      return <div>Unknown field type: {field.type}</div>
  }
}

// TODO: Implement each field renderer

export function TextFieldRenderer({ field, value, onChange }: Omit<FieldRendererProps, 'display'>) {
  const isMultiline = field.multiline || false

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {isMultiline ? (
        <textarea
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          required={field.required}
        />
      ) : (
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          required={field.required}
        />
      )}
    </div>
  )
}

export function NumberFieldRenderer({ field, value, onChange }: Omit<FieldRendererProps, 'display'>) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        type="number"
        value={value || ''}
        onChange={(e) => onChange(Number(e.target.value))}
        min={field.min}
        max={field.max}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        required={field.required}
      />
    </div>
  )
}

export function SelectFieldRenderer({ field, value, onChange }: Omit<FieldRendererProps, 'display'>) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        required={field.required}
      >
        <option value="">Select...</option>
        {field.options?.map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </div>
  )
}

export function MultiSelectFieldRenderer({ field, value, onChange }: Omit<FieldRendererProps, 'display'>) {
  const selectedValues = Array.isArray(value) ? value : []

  const toggleOption = (option: string) => {
    if (selectedValues.includes(option)) {
      onChange(selectedValues.filter(v => v !== option))
    } else {
      onChange([...selectedValues, option])
    }
  }

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-3 bg-white dark:bg-gray-800 max-h-48 overflow-y-auto">
        {field.options && field.options.length > 0 ? (
          <div className="space-y-2">
            {field.options.map(option => (
              <label key={option} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-1 rounded">
                <input
                  type="checkbox"
                  checked={selectedValues.includes(option)}
                  onChange={() => toggleOption(option)}
                  className="w-4 h-4"
                />
                <span className="text-sm text-gray-900 dark:text-gray-100">{option}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500 dark:text-gray-400">No options available</div>
        )}
      </div>
    </div>
  )
}

export function BooleanFieldRenderer({ field, value, onChange }: Omit<FieldRendererProps, 'display'>) {
  return (
    <div className="mb-4">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={value || false}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4"
        />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {field.label}
        </span>
      </label>
    </div>
  )
}

export function DateFieldRenderer({ field, value, onChange }: Omit<FieldRendererProps, 'display'>) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
      </label>
      <input
        type="date"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
      />
    </div>
  )
}

export function JsonFieldRenderer({ field, value, onChange }: Omit<FieldRendererProps, 'display'>) {
  // TODO: Implement proper JSON editor (Monaco or structured form)
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
      </label>
      <textarea
        value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value))
          } catch {
            onChange(e.target.value)
          }
        }}
        rows={6}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm"
      />
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        TODO: Implement Monaco JSON editor
      </p>
    </div>
  )
}

export function RichTextFieldRenderer({ field, value, onChange }: Omit<FieldRendererProps, 'display'>) {
  // TODO: Integrate TipTap editor (lightweight version)
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
      </label>
      <textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
      />
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        TODO: Integrate TipTap rich text editor
      </p>
    </div>
  )
}

export function ImageFieldRenderer({ field, value, onChange }: Omit<FieldRendererProps, 'display'>) {
  // TODO: Implement image upload with preview
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
      </label>

      {value && (
        <div className="mb-2">
          <img
            src={value}
            alt="Preview"
            className="w-32 h-32 object-cover rounded border border-gray-300 dark:border-gray-600"
          />
        </div>
      )}

      <input
        type="text"
        placeholder="Image URL"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
      />

      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        TODO: Implement file upload
      </p>
    </div>
  )
}

/**
 * Convenience function for rendering fields in layouts
 * Used by layout components to render fields with proper styling
 */
export function renderField(
  field: FieldDefinition,
  value: any,
  onChange: (value: any) => void,
  readonly?: boolean
) {
  if (readonly) {
    // Readonly display mode
    return <ReadonlyFieldDisplay field={field} value={value} />
  }

  // Editable mode - render appropriate field renderer
  return <FieldRenderer field={field} value={value} onChange={onChange} />
}

/**
 * Display-only field renderer for readonly mode
 */
function ReadonlyFieldDisplay({ field, value }: { field: FieldDefinition, value: any }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-gray-400 dark:text-gray-500 italic">Not set</span>
  }

  // Handle different field types for display
  switch (field.type) {
    case 'boolean':
      return <span className="text-gray-900 dark:text-gray-100">{value ? 'Yes' : 'No'}</span>

    case 'multi-select':
      if (Array.isArray(value)) {
        return (
          <div className="flex flex-wrap gap-1">
            {value.map((v, i) => (
              <span
                key={i}
                className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded text-xs"
              >
                {v}
              </span>
            ))}
          </div>
        )
      }
      return <span className="text-gray-900 dark:text-gray-100">{value.toString()}</span>

    case 'json':
      return (
        <pre className="text-xs font-mono bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-x-auto">
          {JSON.stringify(value, null, 2)}
        </pre>
      )

    case 'image':
      return (
        <img
          src={value}
          alt={field.label}
          className="w-24 h-24 object-cover rounded border border-gray-300 dark:border-gray-600"
        />
      )

    case 'rich-text':
      return (
        <div
          className="prose dark:prose-invert prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: value }}
        />
      )

    default:
      return <span className="text-gray-900 dark:text-gray-100">{value.toString()}</span>
  }
}
