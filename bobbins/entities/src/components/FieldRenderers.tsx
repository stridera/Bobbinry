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

import { useState, useRef, useCallback } from 'react'
import type { FieldDefinition, FieldType } from '../types'
import { useUpload } from './UploadContext'

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
  const uploadCtx = useUpload()
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!uploadCtx) {
      // Fallback: no upload context, prompt for URL
      setError('Upload not available in this context')
      return
    }

    setError(null)
    setUploading(true)
    setProgress(0)

    try {
      const result = await uploadCtx.sdk.uploads.upload({
        file,
        projectId: uploadCtx.projectId,
        context: 'entity',
        onProgress: setProgress,
      })
      onChange(result.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }, [uploadCtx, onChange])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      handleFile(file)
    }
  }, [handleFile])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFile(file)
    }
    // Reset input so selecting the same file again triggers onChange
    e.target.value = ''
  }, [handleFile])

  const handleRemove = useCallback(() => {
    onChange(null)
  }, [onChange])

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
      </label>

      {value ? (
        <div className="relative inline-block mb-2">
          <img
            src={value}
            alt="Preview"
            className="w-32 h-32 object-cover rounded border border-gray-300 dark:border-gray-600"
          />
          <button
            type="button"
            onClick={handleRemove}
            className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 cursor-pointer"
            title="Remove image"
          >
            x
          </button>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`w-full h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 bg-white dark:bg-gray-800'
          }`}
        >
          {uploading ? (
            <>
              <div className="w-24 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 mt-2">{progress}%</span>
            </>
          ) : (
            <>
              <svg className="w-8 h-8 text-gray-400 dark:text-gray-500 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Drop image here or click to browse
              </span>
            </>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
        onChange={handleFileInput}
        className="hidden"
      />

      {error && (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      )}
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
