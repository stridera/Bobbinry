/**
 * Compact Card Layout
 *
 * A minimal layout with small image in top-right corner.
 * Best for characters, items, and other entities where
 * space efficiency is important.
 */

import type { EditorLayout, FieldDefinition } from '../../types'
import { renderField } from '../FieldRenderers'
import { EntityImageGallery } from '../EntityImageGallery'
import { getEntityImages } from '../../images'

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

  const hasImages = getEntityImages(entity).length > 0

  return (
    <div className="max-w-4xl mx-auto bg-white dark:bg-gray-900 rounded-lg shadow-lg overflow-hidden">
      {/* Full-width image (when configured as full-width) */}
      {layout.imagePosition === 'top-full-width' && (hasImages || !readonly) && (
        <div className={hasImages ? '' : 'p-6 pb-0'}>
          <EntityImageGallery
            entity={entity}
            readonly={readonly}
            onFieldChange={onFieldChange}
            variant="hero"
            heroHeightClass="h-48"
          />
        </div>
      )}

      {/* Header: image portrait + fields — stacked in narrow containers
          (docked sidebar), side by side once the card has room. */}
      <div className={`p-4 @md:p-6 ${layout.imagePosition === 'top-right' ? 'flex flex-col gap-6 @lg:flex-row' : ''}`}>
        {/* Portrait gallery or upload placeholder (top-right mode) */}
        {layout.imagePosition === 'top-right' && (hasImages || !readonly) && (
          <div className="w-56 max-w-full flex-shrink-0 @lg:w-44">
            <EntityImageGallery
              entity={entity}
              readonly={readonly}
              onFieldChange={onFieldChange}
              variant="portrait"
            />
          </div>
        )}

        <div className="flex-1 min-w-0">

          {/* Header Fields */}
          <div className="space-y-3">
            {layout.headerFields.map(fieldName => {
              const fieldDef = getFieldDef(fieldName)
              if (!fieldDef) return null

              return (
                <div key={fieldName}>
                  {fieldName === 'name' ? (
                    <h1 className="text-2xl @xl:text-3xl font-bold text-gray-900 dark:text-gray-100">
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
      {layout.imagePosition === 'left-sidebar' && (hasImages || !readonly) && (
        <div className="flex">
          <div className="w-64 flex-shrink-0 p-4">
            <EntityImageGallery
              entity={entity}
              readonly={readonly}
              onFieldChange={onFieldChange}
              variant="square"
            />
          </div>
          <div className="flex-1">
            {/* Sections will render here */}
          </div>
        </div>
      )}

      {/* Content Sections */}
      <div className="p-4 @md:p-6 space-y-6">
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
              <div className="grid grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3 gap-4">
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

            {/* Stacked layout - fields in a column */}
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

            {/* JSON Editor display */}
            {section.display === 'json-editor' && (
              <div className="space-y-4">
                {section.fields.map(fieldName => {
                  const fieldDef = getFieldDef(fieldName)
                  if (!fieldDef) return null

                  return (
                    <div key={fieldName}>
                      {renderField(
                        { ...fieldDef, type: 'json' },
                        entity[fieldName],
                        (value) => onFieldChange(fieldName, value),
                        readonly
                      )}
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
  )
}
