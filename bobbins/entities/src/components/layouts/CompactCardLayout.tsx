/**
 * Compact Card Layout
 *
 * A minimal layout with small image in top-right corner.
 * Best for characters, items, and other entities where
 * space efficiency is important.
 */

import type { EditorLayout, FieldDefinition } from '../../types'
import { renderField } from '../FieldRenderers'

interface CompactCardLayoutProps {
  entity: Record<string, any>
  layout: EditorLayout
  fields: FieldDefinition[]
  onFieldChange: (fieldName: string, value: any) => void
  readonly?: boolean
}

export function CompactCardLayout({
  entity,
  layout,
  fields,
  onFieldChange,
  readonly = false
}: CompactCardLayoutProps) {
  const allFields = [
    { name: 'name', type: 'text' as const, label: 'Name', required: true },
    { name: 'description', type: 'text' as const, label: 'Description', multiline: true },
    { name: 'tags', type: 'multi-select' as const, label: 'Tags', options: [] },
    { name: 'image_url', type: 'image' as const, label: 'Image' },
    ...fields
  ]

  const getFieldDef = (fieldName: string) =>
    allFields.find(f => f.name === fieldName)

  return (
    <div className="max-w-4xl mx-auto bg-white dark:bg-gray-900 rounded-lg shadow-lg overflow-hidden">
      {/* Header with Image */}
      <div className="relative">
        {/* Image (top-right if configured) */}
        {layout.imagePosition === 'top-right' && entity.image_url && (
          <div className="absolute top-4 right-4 w-24 h-24 rounded-lg overflow-hidden shadow-lg border-2 border-white dark:border-gray-700">
            <img
              src={entity.image_url}
              alt={entity.name || 'Entity'}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Full-width image */}
        {layout.imagePosition === 'top-full-width' && entity.image_url && (
          <div className="w-full h-48 overflow-hidden">
            <img
              src={entity.image_url}
              alt={entity.name || 'Entity'}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Header Fields */}
        <div className="p-6">
          <div className="space-y-3">
            {layout.headerFields.map(fieldName => {
              const fieldDef = getFieldDef(fieldName)
              if (!fieldDef) return null

              return (
                <div key={fieldName}>
                  {fieldName === 'name' ? (
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                      {renderField(
                        fieldDef,
                        entity[fieldName],
                        (value) => onFieldChange(fieldName, value),
                        readonly
                      )}
                    </h1>
                  ) : (
                    <div className="text-lg text-gray-600 dark:text-gray-400">
                      {renderField(
                        fieldDef,
                        entity[fieldName],
                        (value) => onFieldChange(fieldName, value),
                        readonly
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Sidebar Image (if configured) */}
      {layout.imagePosition === 'left-sidebar' && (
        <div className="flex">
          {entity.image_url && (
            <div className="w-64 flex-shrink-0">
              <img
                src={entity.image_url}
                alt={entity.name || 'Entity'}
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <div className="flex-1">
            {/* Sections will render here */}
          </div>
        </div>
      )}

      {/* Content Sections */}
      <div className="p-6 space-y-6">
        {layout.sections.map((section, index) => (
          <div
            key={index}
            className="border-t border-gray-200 dark:border-gray-700 pt-6 first:border-t-0 first:pt-0"
          >
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {section.title}
            </h2>

            {/* Inline layout - fields in a row */}
            {section.display === 'inline' && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {section.fields.map(fieldName => {
                  const fieldDef = getFieldDef(fieldName)
                  if (!fieldDef) return null

                  return (
                    <div key={fieldName} className="space-y-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        {fieldDef.label}
                      </label>
                      {renderField(
                        fieldDef,
                        entity[fieldName],
                        (value) => onFieldChange(fieldName, value),
                        readonly
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Stacked layout - fields in a column */}
            {section.display === 'stacked' && (
              <div className="space-y-4">
                {section.fields.map(fieldName => {
                  const fieldDef = getFieldDef(fieldName)
                  if (!fieldDef) return null

                  return (
                    <div key={fieldName} className="space-y-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        {fieldDef.label}
                      </label>
                      {renderField(
                        fieldDef,
                        entity[fieldName],
                        (value) => onFieldChange(fieldName, value),
                        readonly
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* JSON Editor display */}
            {section.display === 'json-editor' && (
              <div className="space-y-4">
                {section.fields.map(fieldName => {
                  const fieldDef = getFieldDef(fieldName)
                  if (!fieldDef) return null

                  return (
                    <div key={fieldName} className="space-y-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        {fieldDef.label}
                      </label>
                      <div className="font-mono text-sm bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-300 dark:border-gray-600">
                        {renderField(
                          { ...fieldDef, type: 'json' },
                          entity[fieldName],
                          (value) => onFieldChange(fieldName, value),
                          readonly
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Rich Text display */}
            {section.display === 'rich-text' && (
              <div className="space-y-4">
                {section.fields.map(fieldName => {
                  const fieldDef = getFieldDef(fieldName)
                  if (!fieldDef) return null

                  return (
                    <div key={fieldName} className="space-y-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                        {fieldDef.label}
                      </label>
                      {renderField(
                        { ...fieldDef, type: 'rich-text' },
                        entity[fieldName],
                        (value) => onFieldChange(fieldName, value),
                        readonly
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
