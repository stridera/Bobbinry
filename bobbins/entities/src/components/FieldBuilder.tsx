/**
 * Field Builder Component
 *
 * Allows users to customize entity type fields with drag-and-drop reordering
 */

import { useState } from 'react'
import type { FieldDefinition, FieldType } from '../types'

interface FieldBuilderProps {
  fields: FieldDefinition[]
  onChange: (fields: FieldDefinition[]) => void
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select (dropdown)' },
  { value: 'multi-select', label: 'Multi-Select' },
  { value: 'boolean', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'json', label: 'JSON' },
  { value: 'rich-text', label: 'Rich Text' },
  { value: 'image', label: 'Image Upload' }
]

export function FieldBuilder({ fields, onChange }: FieldBuilderProps) {
  const [editingField, setEditingField] = useState<number | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  function handleAddField() {
    const newField: FieldDefinition = {
      name: `field_${fields.length + 1}`,
      type: 'text',
      label: `New Field ${fields.length + 1}`,
      required: false
    }
    onChange([...fields, newField])
    setEditingField(fields.length)
  }

  function handleRemoveField(index: number) {
    onChange(fields.filter((_, i) => i !== index))
    if (editingField === index) {
      setEditingField(null)
    }
  }

  function handleUpdateField(index: number, updates: Partial<FieldDefinition>) {
    const updated = fields.map((field, i) =>
      i === index ? { ...field, ...updates } : field
    )
    onChange(updated)
  }

  function handleDragStart(index: number) {
    setDraggedIndex(index)
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return

    const newFields = [...fields]
    const draggedField = newFields[draggedIndex]
    newFields.splice(draggedIndex, 1)
    newFields.splice(index, 0, draggedField)

    onChange(newFields)
    setDraggedIndex(index)
  }

  function handleDragEnd() {
    setDraggedIndex(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Custom Fields ({fields.length})
        </h3>
        <button
          onClick={handleAddField}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
        >
          + Add Field
        </button>
      </div>

      <div className="space-y-2">
        {fields.map((field, index) => (
          <div
            key={index}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className={`border rounded-lg transition-all ${
              draggedIndex === index
                ? 'opacity-50 border-blue-400'
                : 'border-gray-300 dark:border-gray-600'
            } ${
              editingField === index
                ? 'bg-blue-50 dark:bg-blue-900/20'
                : 'bg-white dark:bg-gray-800'
            }`}
          >
            {/* Field Header */}
            <div className="p-3 flex items-center gap-3">
              <div className="cursor-move text-gray-400 hover:text-gray-600">
                ⋮⋮
              </div>

              <div className="flex-1">
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {field.label}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {field.name} • {field.type}
                  {field.required && ' • Required'}
                </div>
              </div>

              <button
                onClick={() => setEditingField(editingField === index ? null : index)}
                className="px-3 py-1 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900 rounded"
              >
                {editingField === index ? 'Done' : 'Edit'}
              </button>

              <button
                onClick={() => handleRemoveField(index)}
                className="px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900 rounded"
              >
                Remove
              </button>
            </div>

            {/* Field Editor */}
            {editingField === index && (
              <div className="px-3 pb-3 space-y-3 border-t border-gray-200 dark:border-gray-700 pt-3">
                <div className="grid grid-cols-2 gap-3">
                  {/* Label */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Label
                    </label>
                    <input
                      type="text"
                      value={field.label}
                      onChange={(e) => handleUpdateField(index, { label: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  {/* Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Field Name (internal)
                    </label>
                    <input
                      type="text"
                      value={field.name}
                      onChange={(e) => handleUpdateField(index, {
                        name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_')
                      })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Type */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Field Type
                    </label>
                    <select
                      value={field.type}
                      onChange={(e) => handleUpdateField(index, { type: e.target.value as FieldType })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    >
                      {FIELD_TYPES.map(type => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Required */}
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={field.required || false}
                        onChange={(e) => handleUpdateField(index, { required: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        Required field
                      </span>
                    </label>
                  </div>
                </div>

                {/* Type-specific options */}
                {(field.type === 'select' || field.type === 'multi-select') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Options (one per line)
                    </label>
                    <textarea
                      value={field.options?.join('\n') || ''}
                      onChange={(e) => handleUpdateField(index, {
                        options: e.target.value.split('\n').filter(Boolean)
                      })}
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm"
                      placeholder="Option 1&#10;Option 2&#10;Option 3"
                    />
                  </div>
                )}

                {field.type === 'number' && (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Min
                      </label>
                      <input
                        type="number"
                        value={field.min ?? ''}
                        onChange={(e) => handleUpdateField(index, {
                          min: e.target.value ? Number(e.target.value) : undefined
                        })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Max
                      </label>
                      <input
                        type="number"
                        value={field.max ?? ''}
                        onChange={(e) => handleUpdateField(index, {
                          max: e.target.value ? Number(e.target.value) : undefined
                        })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Default
                      </label>
                      <input
                        type="number"
                        value={field.default ?? ''}
                        onChange={(e) => handleUpdateField(index, {
                          default: e.target.value ? Number(e.target.value) : undefined
                        })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                  </div>
                )}

                {field.type === 'text' && (
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={field.multiline || false}
                        onChange={(e) => handleUpdateField(index, { multiline: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        Multiline (textarea)
                      </span>
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {fields.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
            No custom fields yet. Click "Add Field" to get started.
          </div>
        )}
      </div>
    </div>
  )
}
