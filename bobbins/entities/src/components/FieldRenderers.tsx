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

import { useState, useRef, useCallback, useEffect } from 'react'
import { getSanitizedHtmlProps, useClickOutside } from '@bobbinry/sdk'
import type { FieldDefinition, FieldType } from '../types'
import { useUpload, useEntityContext } from './UploadContext'

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
    case 'relation':
      return <RelationFieldRenderer field={field} value={value} onChange={onChange} />
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
