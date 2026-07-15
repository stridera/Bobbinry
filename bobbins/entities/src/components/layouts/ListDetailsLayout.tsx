/**
 * List & Details Layout
 *
 * Two-column layout with compact list on left and details on right.
 * Best for classes, factions, and entities with many structured fields.
 */

import type { EditorLayout, FieldDefinition } from '../../types'
import { renderField } from '../FieldRenderers'
import { EntityImageGallery } from '../EntityImageGallery'
import { getEntityImages } from '../../images'

interface ListDetailsLayoutProps {
  entity: Record<string, any>
  layout: EditorLayout
  fields: FieldDefinition[]
  onFieldChange: (fieldName: string, value: any) => void
  readonly?: boolean
}

export function ListDetailsLayout({
  entity,
  layout,
  fields,
  onFieldChange,
  readonly = false
}: ListDetailsLayoutProps) {
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
    <div className="max-w-7xl mx-auto bg-white dark:bg-gray-900 rounded-lg shadow-lg overflow-hidden">
      <div className="grid grid-cols-1 @3xl:grid-cols-3 gap-0">
        {/* Left Sidebar - Image and Header */}
        <div className="@3xl:col-span-1 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
          {/* Image gallery */}
          {layout.imagePosition !== 'none' && (getEntityImages(entity).length > 0 || !readonly) && (
            <div className="p-3">
              {/* Stacked mode renders the sidebar full width — cap the square image */}
              <div className="mx-auto max-w-72 @3xl:mx-0 @3xl:max-w-none">
                <EntityImageGallery
                  entity={entity}
                  readonly={readonly}
                  onFieldChange={onFieldChange}
                  variant="square"
                />
              </div>
            </div>
          )}

          {/* Header Info */}
          <div className="p-4 @md:p-6 space-y-4">
            {layout.headerFields.map(fieldName => {
              const fieldDef = getFieldDef(fieldName)
              if (!fieldDef) return null

              return (
                <div key={fieldName}>
                  {fieldName === 'name' ? (
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {renderField(
                        fieldDef,
                        entity[fieldName],
                        (value) => onFieldChange(fieldName, value),
                        readonly
                      )}
                    </h1>
                  ) : (
                    <div>
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

        {/* Right Content - Sections */}
        <div className="@3xl:col-span-2 p-4 @md:p-6 @2xl:p-8">
          <div className="space-y-8">
            {layout.sections.map((section, index) => (
              <div key={index}>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
                  {section.title}
                </h2>

                {/* Inline layout - compact grid */}
                {section.display === 'inline' && (
                  <div className="grid grid-cols-1 @md:grid-cols-2 gap-x-6 gap-y-4">
                    {section.fields.map(fieldName => {
                      const fieldDef = getFieldDef(fieldName)
                      if (!fieldDef) return null

                      return (
                        <div key={fieldName}>
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

                {/* Stacked layout - full width items */}
                {section.display === 'stacked' && (
                  <div className="space-y-4">
                    {section.fields.map(fieldName => {
                      const fieldDef = getFieldDef(fieldName)
                      if (!fieldDef) return null

                      return (
                        <div key={fieldName}>
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

                {/* JSON Editor - structured data display */}
                {section.display === 'json-editor' && (
                  <div className="space-y-4">
                    {section.fields.map(fieldName => {
                      const fieldDef = getFieldDef(fieldName)
                      if (!fieldDef) return null

                      return (
                        <div key={fieldName}>
                          <div className="bg-gray-50 dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600 p-3 font-mono text-xs">
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

                {/* Rich Text - long-form content */}
                {section.display === 'rich-text' && (
                  <div className="prose dark:prose-invert max-w-none">
                    {section.fields.map(fieldName => {
                      const fieldDef = getFieldDef(fieldName)
                      if (!fieldDef) return null

                      return (
                        <div key={fieldName}>
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
    </div>
  )
}
