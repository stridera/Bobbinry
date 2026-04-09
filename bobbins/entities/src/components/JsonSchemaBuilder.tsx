/**
 * JsonSchemaBuilder
 *
 * UI for defining JSON field schemas inside the FieldBuilder.
 * Lets users configure mode, sub-fields, and mode-specific options.
 */

import { useState } from 'react'
import type { JsonSchema, JsonSchemaField, JsonSchemaFieldType, JsonSchemaMode } from '../types'

interface JsonSchemaBuilderProps {
  schema: JsonSchema | Record<string, string> | undefined
  onChange: (schema: JsonSchema | undefined) => void
}

const MODE_OPTIONS: { value: JsonSchemaMode | 'freeform'; label: string; description: string }[] = [
  { value: 'object', label: 'Single Object', description: 'A fixed set of named properties' },
  { value: 'list', label: 'List of Items', description: 'A repeatable list of structured items' },
  { value: 'keyed-list', label: 'Grouped List', description: 'Items grouped by a key (e.g., level)' },
  { value: 'freeform', label: 'Freeform', description: 'Flexible key-value pairs' },
]

const FIELD_TYPES: { value: JsonSchemaFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes/No' },
  { value: 'select', label: 'Dropdown' },
]

function normalizeToJsonSchema(raw: any): JsonSchema | undefined {
  if (!raw) return undefined
  if (raw && 'mode' in raw) return raw as JsonSchema
  // Old Record<string,string> format
  if (typeof raw === 'object') {
    const fields: Record<string, JsonSchemaField> = {}
    for (const [key, typeStr] of Object.entries(raw)) {
      fields[key] = {
        type: (['number', 'boolean', 'select'].includes(typeStr as string) ? typeStr : 'text') as JsonSchemaFieldType,
        label: key.charAt(0).toUpperCase() + key.slice(1),
      }
    }
    return { mode: 'object', fields }
  }
  return undefined
}

export function JsonSchemaBuilder({ schema: rawSchema, onChange }: JsonSchemaBuilderProps) {
  const schema = normalizeToJsonSchema(rawSchema)
  const currentMode: JsonSchemaMode | 'freeform' = schema?.mode || 'freeform'

  function handleModeChange(mode: JsonSchemaMode | 'freeform') {
    if (mode === 'freeform') {
      onChange(undefined)
      return
    }
    onChange({
      mode,
      fields: schema?.fields || { name: { type: 'text', label: 'Name' } },
      ...(mode === 'list' ? { itemLabel: schema?.itemLabel || 'Item' } : {}),
      ...(mode === 'keyed-list' ? {
        keyLabel: schema?.keyLabel || 'Key',
        keyType: schema?.keyType || 'text',
        itemLabel: schema?.itemLabel || 'Item',
      } : {}),
    })
  }

  function handleFieldsChange(fields: Record<string, JsonSchemaField>) {
    if (!schema) return
    onChange({ ...schema, fields })
  }

  function handleAddField() {
    if (!schema) return
    const idx = Object.keys(schema.fields).length + 1
    handleFieldsChange({
      ...schema.fields,
      [`field_${idx}`]: { type: 'text', label: `Field ${idx}` },
    })
  }

  function handleRemoveField(key: string) {
    if (!schema) return
    const updated = { ...schema.fields }
    delete updated[key]
    handleFieldsChange(updated)
  }

  function handleUpdateField(oldKey: string, newKey: string, field: JsonSchemaField) {
    if (!schema) return
    if (newKey !== oldKey) {
      // Rename: rebuild preserving order
      const updated: Record<string, JsonSchemaField> = {}
      for (const [k, v] of Object.entries(schema.fields)) {
        updated[k === oldKey ? newKey : k] = k === oldKey ? field : v
      }
      handleFieldsChange(updated)
    } else {
      handleFieldsChange({ ...schema.fields, [oldKey]: field })
    }
  }

  return (
    <div className="space-y-4 mt-3 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
          Data Structure
        </label>
        <div className="grid grid-cols-2 gap-2">
          {MODE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleModeChange(opt.value)}
              className={`p-2 border rounded text-left text-xs transition cursor-pointer ${
                currentMode === opt.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-blue-300'
              }`}
            >
              <div className="font-medium">{opt.label}</div>
              <div className="text-[10px] opacity-70 mt-0.5">{opt.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Schema fields editor (shown for object, list, keyed-list) */}
      {schema && (
        <>
          {/* Mode-specific options */}
          {(schema.mode === 'list' || schema.mode === 'keyed-list') && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Item Label
                </label>
                <input
                  type="text"
                  value={schema.itemLabel || ''}
                  onChange={(e) => onChange({ ...schema, itemLabel: e.target.value })}
                  placeholder="e.g., Ability"
                  className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
                />
              </div>
              {schema.mode === 'keyed-list' && (
                <>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Group Key Label
                    </label>
                    <input
                      type="text"
                      value={schema.keyLabel || ''}
                      onChange={(e) => onChange({ ...schema, keyLabel: e.target.value })}
                      placeholder="e.g., Level"
                      className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div className="w-24">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      Key Type
                    </label>
                    <select
                      value={schema.keyType || 'text'}
                      onChange={(e) => onChange({ ...schema, keyType: e.target.value as 'text' | 'number' })}
                      className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Sub-fields */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
              {schema.mode === 'object' ? 'Properties' : 'Item Fields'}
            </label>
            <div className="space-y-2">
              {Object.entries(schema.fields).map(([key, field]) => (
                <SchemaFieldRow
                  key={key}
                  fieldKey={key}
                  field={field}
                  onUpdate={(newKey, newField) => handleUpdateField(key, newKey, newField)}
                  onRemove={() => handleRemoveField(key)}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={handleAddField}
              className="mt-2 px-3 py-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 border border-dashed border-blue-300 dark:border-blue-600 rounded cursor-pointer"
            >
              + Add Field
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function SchemaFieldRow({
  fieldKey,
  field,
  onUpdate,
  onRemove,
}: {
  fieldKey: string
  field: JsonSchemaField
  onUpdate: (key: string, field: JsonSchemaField) => void
  onRemove: () => void
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(fieldKey)

  function handleNameBlur() {
    const slug = nameInput.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    if (slug && slug !== fieldKey) {
      onUpdate(slug, field)
    }
    setEditingName(false)
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded">
      {/* Key / Label */}
      <div className="flex-1 min-w-0">
        {editingName ? (
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={(e) => e.key === 'Enter' && handleNameBlur()}
            autoFocus
            className="w-full px-1 py-0.5 border border-blue-400 rounded text-xs bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
        ) : (
          <div>
            <input
              type="text"
              value={field.label || ''}
              onChange={(e) => onUpdate(fieldKey, { ...field, label: e.target.value })}
              placeholder="Label"
              className="w-full px-1 py-0.5 border-0 bg-transparent text-sm font-medium text-gray-800 dark:text-gray-200 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => { setNameInput(fieldKey); setEditingName(true) }}
              className="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              {fieldKey}
            </button>
          </div>
        )}
      </div>

      {/* Type */}
      <select
        value={field.type}
        onChange={(e) => onUpdate(fieldKey, { ...field, type: e.target.value as JsonSchemaFieldType })}
        className="px-1 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-xs text-gray-700 dark:text-gray-300"
      >
        {FIELD_TYPES.map(t => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      {/* Options for select type */}
      {field.type === 'select' && (
        <input
          type="text"
          value={(field.options || []).join(', ')}
          onChange={(e) => onUpdate(fieldKey, {
            ...field,
            options: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
          })}
          placeholder="option1, option2"
          className="w-32 px-1 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300"
        />
      )}

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        className="p-1 text-red-400 hover:text-red-600 cursor-pointer flex-shrink-0"
      >&times;</button>
    </div>
  )
}
