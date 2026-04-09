/**
 * Field Renderer Components
 *
 * Type-specific renderers for each field type
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { getSanitizedHtmlProps, useClickOutside } from '@bobbinry/sdk'
import type { FieldDefinition, FieldType } from '../types'
import { normalizeJsonSchema } from '../types'
import { useUpload, useEntityContext } from './UploadContext'
import { ObjectFormRenderer, ListFormRenderer, KeyedListFormRenderer, FreeformKeyValueEditor } from './json-renderers'
import { TipTapEditor } from './TipTapEditor'

const NOOP = () => {}

interface FieldRendererProps {
  field: FieldDefinition
  value: any
  onChange: (value: any) => void
  display?: 'inline' | 'stacked' | 'json-editor' | 'rich-text'
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Check if a stored value is compatible with the expected field type */
export function checkTypeCompatibility(
  fieldType: FieldType,
  value: any,
  field: FieldDefinition
): { compatible: boolean; reason?: string } {
  if (value === null || value === undefined || value === '') {
    return { compatible: true }
  }

  switch (fieldType) {
    case 'text':
    case 'rich-text':
      return { compatible: true }

    case 'number':
      if (typeof value === 'number') return { compatible: true }
      if (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '') {
        return { compatible: true }
      }
      return { compatible: false, reason: `expected number, got ${typeof value}` }

    case 'boolean':
      if (typeof value === 'boolean') return { compatible: true }
      return { compatible: false, reason: `expected boolean, got ${typeof value}` }

    case 'date':
      if (typeof value === 'string' && !isNaN(Date.parse(value))) return { compatible: true }
      return { compatible: false, reason: `expected date string, got ${typeof value}` }

    case 'select':
      if (typeof value !== 'string') {
        return { compatible: false, reason: `expected string, got ${typeof value}` }
      }
      if (field.options && !field.options.includes(value)) {
        return { compatible: false, reason: `"${value}" not in options` }
      }
      return { compatible: true }

    case 'multi-select':
      if (!Array.isArray(value)) {
        return { compatible: false, reason: `expected array, got ${typeof value}` }
      }
      return { compatible: true }

    case 'relation': {
      if (field.allowMultiple) {
        if (!Array.isArray(value)) {
          return { compatible: false, reason: `expected array of IDs, got ${typeof value}` }
        }
        const hasNonUuid = value.some((v: any) => typeof v !== 'string' || !UUID_PATTERN.test(v))
        if (hasNonUuid) {
          return { compatible: false, reason: 'array contains non-UUID values' }
        }
      } else {
        if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
          return { compatible: false, reason: `expected UUID, got "${String(value).slice(0, 30)}"` }
        }
      }
      return { compatible: true }
    }

    case 'json':
      if (typeof value === 'object') return { compatible: true }
      return { compatible: false, reason: `expected object, got ${typeof value}` }

    case 'image':
      if (typeof value === 'string') return { compatible: true }
      return { compatible: false, reason: `expected URL string, got ${typeof value}` }

    default:
      return { compatible: true }
  }
}

function TypeMismatchBadge({
  field,
  value,
  reason,
  onChange,
}: {
  field: FieldDefinition
  value: any
  reason: string
  onChange?: (value: any) => void
}) {
  const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
  const truncated = displayValue.length > 50 ? displayValue.slice(0, 50) + '...' : displayValue

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
      </label>
      <div className="p-3 border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
        <div className="flex items-start gap-2">
          <span className="text-amber-600 dark:text-amber-400 text-sm flex-shrink-0">&#9888;</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-amber-800 dark:text-amber-200">
              Type mismatch: stored as <code className="px-1 bg-amber-100 dark:bg-amber-800 rounded text-xs">{truncated}</code>,
              field expects <strong>{field.type}</strong>
            </div>
            <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{reason}</div>
          </div>
          {onChange && (
            <button
              onClick={() => onChange(null)}
              className="text-xs px-2 py-1 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-600 rounded hover:bg-amber-100 dark:hover:bg-amber-800 flex-shrink-0 cursor-pointer"
            >
              Clear value
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ReadonlyTypeMismatchBadge({
  value,
  reason,
}: {
  value: any
  reason: string
}) {
  const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
  const truncated = displayValue.length > 80 ? displayValue.slice(0, 80) + '...' : displayValue

  return (
    <div className="inline-flex items-center gap-1.5 text-sm">
      <span className="text-amber-500" title={`Type mismatch: ${reason}`}>&#9888;</span>
      <span className="text-gray-500 dark:text-gray-400 italic">{truncated}</span>
    </div>
  )
}

export function FieldRenderer({ field, value, onChange, display }: FieldRendererProps) {
  // Check for type mismatch before dispatching to type-specific renderer
  if (value !== null && value !== undefined && value !== '') {
    const { compatible, reason } = checkTypeCompatibility(field.type, value, field)
    if (!compatible) {
      return <TypeMismatchBadge field={field} value={value} reason={reason!} onChange={onChange} />
    }
  }

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
    case 'relation':
      return <RelationFieldRenderer field={field} value={value} onChange={onChange} />
    default:
      return <div>Unknown field type: {field.type}</div>
  }
}

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

export function JsonFieldRenderer({ field, value, onChange, readonly }: Omit<FieldRendererProps, 'display'> & { readonly?: boolean }) {
  const schema = normalizeJsonSchema(field.schema)

  if (readonly) {
    return (
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {field.label}
        </label>
        <ReadonlyJsonDisplay schema={schema} value={value} />
      </div>
    )
  }

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
      </label>
      {schema ? (
        schema.mode === 'object' ? (
          <ObjectFormRenderer schema={schema} value={value || {}} onChange={onChange} />
        ) : schema.mode === 'list' ? (
          <ListFormRenderer schema={schema} value={Array.isArray(value) ? value : []} onChange={onChange} />
        ) : schema.mode === 'keyed-list' ? (
          <KeyedListFormRenderer schema={schema} value={value || {}} onChange={onChange} />
        ) : (
          <FreeformKeyValueEditor value={value} onChange={onChange} />
        )
      ) : (
        <FreeformKeyValueEditor value={value} onChange={onChange} />
      )}
    </div>
  )
}

/** Renders a single structured item (shared by list and keyed-list readonly display) */
function ReadonlyItemCard({ item, fieldEntries, firstTextKey, className }: {
  item: Record<string, any>
  fieldEntries: [string, { type: string; label?: string }][]
  firstTextKey: string | undefined
  className?: string
}) {
  return (
    <div className={`p-2 bg-gray-50 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-700 ${className || ''}`}>
      {firstTextKey && item[firstTextKey] && (
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item[firstTextKey]}</div>
      )}
      {fieldEntries.filter(([k]) => k !== firstTextKey).map(([key, f]) => (
        item[key] ? (
          <div key={key} className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {f.label || key}: {item[key]}
          </div>
        ) : null
      ))}
    </div>
  )
}

/** Structured readonly display for JSON fields */
function ReadonlyJsonDisplay({ schema, value }: { schema: ReturnType<typeof normalizeJsonSchema>; value: any }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-gray-400 dark:text-gray-500 italic">Not set</span>
  }

  if (schema?.mode === 'object' && typeof value === 'object' && !Array.isArray(value)) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
        {Object.entries(schema.fields).map(([key, f]) => (
          <div key={key} className="flex justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">{f.label || key}</span>
            <span className="text-sm text-gray-900 dark:text-gray-100 font-medium">{value[key] ?? '—'}</span>
          </div>
        ))}
      </div>
    )
  }

  if (schema && (schema.mode === 'list' || schema.mode === 'keyed-list')) {
    const fieldEntries = Object.entries(schema.fields) as [string, { type: string; label?: string }][]
    const firstTextKey = fieldEntries.find(([, f]) => f.type === 'text')?.[0]

    if (schema.mode === 'list' && Array.isArray(value) && value.length > 0) {
      return (
        <div className="space-y-2">
          {value.map((item, i) => (
            <ReadonlyItemCard key={i} item={item} fieldEntries={fieldEntries} firstTextKey={firstTextKey} />
          ))}
        </div>
      )
    }

    if (schema.mode === 'keyed-list' && typeof value === 'object' && !Array.isArray(value)) {
      const keyLabel = schema.keyLabel || 'Key'
      const sortedKeys = Object.keys(value).sort((a, b) =>
        schema.keyType === 'number' ? Number(a) - Number(b) : a.localeCompare(b)
      )
      return (
        <div className="space-y-2">
          {sortedKeys.map(groupKey => {
            const items = value[groupKey] || []
            return (
              <div key={groupKey}>
                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">{keyLabel} {groupKey}</div>
                {Array.isArray(items) && items.map((item: any, i: number) => (
                  <ReadonlyItemCard key={i} item={item} fieldEntries={fieldEntries} firstTextKey={firstTextKey} className="ml-3" />
                ))}
              </div>
            )
          })}
        </div>
      )
    }
  }

  // Fallback: key-value pairs for plain objects
  if (typeof value === 'object' && !Array.isArray(value)) {
    return (
      <div className="space-y-0.5">
        {Object.entries(value).map(([key, val]) => (
          <div key={key} className="flex gap-2 text-sm">
            <span className="text-gray-500 dark:text-gray-400">{key}:</span>
            <span className="text-gray-900 dark:text-gray-100">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <pre className="text-xs font-mono bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-x-auto">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function RichTextFieldRenderer({ field, value, onChange, readonly }: Omit<FieldRendererProps, 'display'> & { readonly?: boolean }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
      </label>
      <TipTapEditor
        content={value || ''}
        onChange={onChange}
        readonly={readonly || false}
        placeholder={`Write ${field.label.toLowerCase()}...`}
      />
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
        <div className="relative group">
          <img
            src={value}
            alt="Preview"
            className="w-full max-h-64 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors rounded-lg flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 bg-white/90 text-gray-800 rounded text-sm font-medium hover:bg-white cursor-pointer"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={handleRemove}
                className="px-3 py-1.5 bg-red-500/90 text-white rounded text-sm font-medium hover:bg-red-500 cursor-pointer"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`w-full aspect-[3/1] min-h-[120px] border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all ${
            dragOver
              ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-900/20 scale-[1.01]'
              : 'border-gray-300/60 dark:border-gray-600/60 hover:border-gray-400 dark:hover:border-gray-500 bg-gray-50/50 dark:bg-gray-800/30'
          }`}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-32 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 dark:text-gray-500">Uploading {progress}%</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-gray-400 dark:text-gray-500 px-6 py-4">
              <svg className="w-10 h-10 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm">Drop an image or click to browse</span>
            </div>
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

/** Shared hook: resolve entity IDs to display names in parallel */
function useResolvedEntityNames(
  targetEntityType: string | undefined,
  ids: string[]
): Map<string, string> {
  const entityCtx = useEntityContext()
  const [names, setNames] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (!entityCtx || !targetEntityType || ids.length === 0) return
    let cancelled = false

    // Only resolve IDs we haven't seen yet
    const unresolvedIds = ids.filter(id => !names.has(id))
    if (unresolvedIds.length === 0) return

    Promise.allSettled(
      unresolvedIds.map(id =>
        entityCtx.sdk.entities.get(targetEntityType, id)
          .then(entity => {
            const name = (entity as any)?.name || (entity as any)?.entity?.name
            return [id, name || id] as const
          })
          .catch(() => [id, id] as const)
      )
    ).then(results => {
      if (cancelled) return
      setNames(prev => {
        const next = new Map(prev)
        for (const r of results) {
          if (r.status === 'fulfilled') next.set(r.value[0], r.value[1])
        }
        return next
      })
    })

    return () => { cancelled = true }
  }, [ids.join(','), targetEntityType, entityCtx])

  return names
}

export function RelationFieldRenderer({ field, value, onChange }: Omit<FieldRendererProps, 'display'>) {
  const entityCtx = useEntityContext()
  const [searchTerm, setSearchTerm] = useState('')
  const [options, setOptions] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const isInitialOpen = useRef(true)

  const isMultiple = field.allowMultiple || false
  const selectedIds: string[] = isMultiple
    ? (Array.isArray(value) ? value : [])
    : (value ? [value] : [])

  const selectedNames = useResolvedEntityNames(field.targetEntityType, selectedIds)

  // Search target entity type as user types (instant on open, debounced on typing)
  useEffect(() => {
    if (!entityCtx || !field.targetEntityType || !dropdownOpen) return
    if (isInitialOpen.current) {
      isInitialOpen.current = false
      searchEntities()
      return
    }
    const timer = setTimeout(() => searchEntities(), 300)
    return () => clearTimeout(timer)
  }, [searchTerm, dropdownOpen])

  // Reset initial-open flag when dropdown closes
  useEffect(() => {
    if (!dropdownOpen) isInitialOpen.current = true
  }, [dropdownOpen])

  async function searchEntities() {
    if (!entityCtx || !field.targetEntityType) return
    setLoading(true)
    try {
      const query: { collection: string; limit: number; search?: string } = {
        collection: field.targetEntityType,
        limit: 20,
      }
      if (searchTerm) query.search = searchTerm
      const result = await entityCtx.sdk.entities.query(query)
      setOptions(result.data.map((e: any) => ({
        id: e.id,
        name: e.name || 'Untitled',
      })))
    } catch (err) {
      console.error('[RelationField] Search failed:', err)
      setOptions([])
    } finally {
      setLoading(false)
    }
  }

  function handleSelect(id: string, name: string) {
    if (isMultiple) {
      const current = Array.isArray(value) ? value : []
      if (!current.includes(id)) {
        onChange([...current, id])
      }
    } else {
      onChange(id)
      setDropdownOpen(false)
    }
    setSearchTerm('')
  }

  function handleRemove(id: string) {
    if (isMultiple) {
      onChange((Array.isArray(value) ? value : []).filter((v: string) => v !== id))
    } else {
      onChange(null)
    }
  }

  useClickOutside(containerRef, () => setDropdownOpen(false))

  if (!entityCtx) {
    return (
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {field.label}
        </label>
        <div className="text-sm text-gray-400 italic">Relation fields unavailable in this context</div>
      </div>
    )
  }

  return (
    <div className="mb-4" ref={containerRef}>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>

      {/* Selected entities */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedIds.map(id => (
            <span
              key={id}
              className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 rounded text-sm"
            >
              {selectedNames.get(id) || 'Loading...'}
              <button
                type="button"
                onClick={() => handleRemove(id)}
                className="ml-0.5 text-purple-500 hover:text-purple-700 dark:hover:text-purple-300 cursor-pointer"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      {(isMultiple || selectedIds.length === 0) && (
        <div className="relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setDropdownOpen(true)}
            placeholder={`Search ${field.targetEntityType || 'entities'}...`}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />

          {/* Dropdown */}
          {dropdownOpen && (
            <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {loading ? (
                <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Searching...</div>
              ) : options.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  {searchTerm ? 'No matches found' : 'No entities yet'}
                </div>
              ) : (
                options
                  .filter(opt => !selectedIds.includes(opt.id))
                  .map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelect(opt.id, opt.name)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 dark:hover:bg-purple-900/20 text-gray-900 dark:text-gray-100 cursor-pointer"
                    >
                      {opt.name}
                    </button>
                  ))
              )}
            </div>
          )}
        </div>
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
    // JSON and rich-text fields have their own readonly rendering
    if (field.type === 'json') {
      return <JsonFieldRenderer field={field} value={value} onChange={NOOP} readonly />
    }
    if (field.type === 'rich-text') {
      return <RichTextFieldRenderer field={field} value={value} onChange={NOOP} readonly />
    }
    return (
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {field.label}
        </label>
        <ReadonlyFieldDisplay field={field} value={value} />
      </div>
    )
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

  // Check for type mismatch
  const { compatible, reason } = checkTypeCompatibility(field.type, value, field)
  if (!compatible) {
    return <ReadonlyTypeMismatchBadge value={value} reason={reason!} />
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
      return <ReadonlyJsonDisplay schema={normalizeJsonSchema(field.schema)} value={value} />

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
          dangerouslySetInnerHTML={getSanitizedHtmlProps(value)}
        />
      )

    case 'relation':
      return <RelationReadonlyDisplay field={field} value={value} />

    default:
      return <span className="text-gray-900 dark:text-gray-100">{value.toString()}</span>
  }
}

function RelationReadonlyDisplay({ field, value }: { field: FieldDefinition; value: any }) {
  const ids: string[] = field.allowMultiple
    ? (Array.isArray(value) ? value : [])
    : (value ? [value] : [])

  const names = useResolvedEntityNames(field.targetEntityType, ids)

  if (ids.length === 0) {
    return <span className="text-gray-400 dark:text-gray-500 italic">Not set</span>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {ids.map(id => (
        <span
          key={id}
          className="px-2 py-1 bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 rounded text-xs"
        >
          {names.get(id) || 'Loading...'}
        </span>
      ))}
    </div>
  )
}
