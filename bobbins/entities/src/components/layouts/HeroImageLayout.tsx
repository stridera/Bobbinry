/**
 * Hero Image Layout
 *
 * Layout with prominent full-width image at the top.
 * Best for locations, spells, and visually-focused entities.
 */

import type { EditorLayout, FieldDefinition } from '../../types'
import { renderField } from '../FieldRenderers'

interface HeroImageLayoutProps {
  entity: Record<string, any>
  layout: EditorLayout
  fields: FieldDefinition[]
  onFieldChange: (fieldName: string, value: any) => void
  readonly?: boolean
}

export function HeroImageLayout({
  entity,
  layout,
  fields,
  onFieldChange,
  readonly = false
}: HeroImageLayoutProps) {
  const allFields = [
    { name: 'name', type: 'text' as const, label: 'Name', required: true },
    { name: 'description', type: 'text' as const, label: 'Description', multiline: true },
    { name: 'tags', type: 'multi-select' as const, label: 'Tags', options: [] },
    { name: 'image_url', type: 'image' as const, label: 'Image' },
    ...fields
  ]

  const getFieldDef = (fieldName: string) =>
    allFields.find(f => f.name === fieldName)

  const imageHeight = {
    small: 'h-48',
    medium: 'h-64',
    large: 'h-96'
  }[layout.imageSize] || 'h-64'

  return (
    <div className="max-w-6xl mx-auto bg-white dark:bg-gray-900 rounded-lg shadow-lg overflow-hidden">
      {/* Hero Image */}
      {entity.image_url && layout.imagePosition !== 'none' && (
        <div className={`w-full ${imageHeight} relative overflow-hidden bg-gradient-to-b from-gray-900/50 to-transparent`}>
          <img
            src={entity.image_url}
            alt={entity.name || 'Entity'}
            className="w-full h-full object-cover"
          />

          {/* Overlay with entity name */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
            <div className="max-w-4xl mx-auto">
              {layout.headerFields.includes('name') && (
                <h1 className="text-4xl md:text-5xl font-bold text-white drop-shadow-lg">
                  {entity.name || 'Untitled'}
                </h1>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header Fields (below image) */}
      <div className="p-6 md:p-8 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto">
          {!entity.image_url && layout.headerFields.includes('name') && (
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              {renderField(
                getFieldDef('name')!,
                entity.name,
                (value) => onFieldChange('name', value),
                readonly
              )}
            </h1>
          )}

          <div className="flex flex-wrap gap-6">
            {layout.headerFields
              .filter(f => f !== 'name')
              .map(fieldName => {
                const fieldDef = getFieldDef(fieldName)
                if (!fieldDef) return null

                return (
                  <div key={fieldName} className="flex-1 min-w-[200px]">
                    <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                      {fieldDef.label}
                    </label>
                    <div className="text-lg text-gray-900 dark:text-gray-100">
                      {renderField(
                        fieldDef,
                        entity[fieldName],
                        (value) => onFieldChange(fieldName, value),
                        readonly
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      </div>

      {/* Content Sections */}
      <div className="p-6 md:p-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {layout.sections.map((section, index) => (
            <div key={index}>
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
                {section.title}
              </h2>

              {/* Inline layout */}
              {section.display === 'inline' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {section.fields.map(fieldName => {
                    const fieldDef = getFieldDef(fieldName)
                    if (!fieldDef) return null

                    return (
                      <div key={fieldName} className="space-y-2">
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
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

              {/* Stacked layout */}
              {section.display === 'stacked' && (
                <div className="space-y-6">
                  {section.fields.map(fieldName => {
                    const fieldDef = getFieldDef(fieldName)
                    if (!fieldDef) return null

                    return (
                      <div key={fieldName} className="space-y-2">
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
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

              {/* JSON Editor */}
              {section.display === 'json-editor' && (
                <div className="space-y-4">
                  {section.fields.map(fieldName => {
                    const fieldDef = getFieldDef(fieldName)
                    if (!fieldDef) return null

                    return (
                      <div key={fieldName} className="space-y-2">
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                          {fieldDef.label}
                        </label>
                        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-600 p-4">
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

              {/* Rich Text */}
              {section.display === 'rich-text' && (
                <div className="prose dark:prose-invert max-w-none">
                  {section.fields.map(fieldName => {
                    const fieldDef = getFieldDef(fieldName)
                    if (!fieldDef) return null

                    return (
                      <div key={fieldName} className="space-y-2">
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 not-prose">
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
    </div>
  )
}
