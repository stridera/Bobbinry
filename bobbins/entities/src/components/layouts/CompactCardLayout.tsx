/**
 * Compact Card Layout
 *
 * A minimal layout with small image in top-right corner.
 * Best for characters, items, and other entities where
 * space efficiency is important.
 */

import { useState } from 'react'
import type { EditorLayout, FieldDefinition } from '../../types'
import { renderField } from '../FieldRenderers'

function ImagePortrait({ src, alt, readonly, onRemove }: {
  src: string
  alt: string
  readonly: boolean
  onRemove: () => void
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false)

  return (
    <>
      <div className="flex-shrink-0 w-44 h-56 rounded-lg overflow-hidden shadow-md border border-gray-200 dark:border-gray-700 relative group cursor-pointer">
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover"
          onClick={() => setLightboxOpen(true)}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end justify-center pb-2 pointer-events-none">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1.5 pointer-events-auto">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightboxOpen(true) }}
              className="px-2.5 py-1 bg-white/90 text-gray-800 rounded text-xs font-medium hover:bg-white cursor-pointer"
            >
              View
            </button>
            {!readonly && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemove() }}
                className="px-2.5 py-1 bg-red-500/90 text-white rounded text-xs font-medium hover:bg-red-500 cursor-pointer"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 cursor-pointer"
          onClick={() => setLightboxOpen(false)}
        >
          <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={src}
              alt={alt}
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setLightboxOpen(false)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full shadow-lg flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-lg"
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </>
  )
}

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
      {/* Full-width image (when configured as full-width) */}
      {layout.imagePosition === 'top-full-width' && entity.image_url && (
        <div className="w-full h-48 overflow-hidden">
          <img
            src={entity.image_url}
            alt={entity.name || 'Entity'}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Header: image portrait + fields side by side */}
      <div className={`p-6 ${layout.imagePosition === 'top-right' ? 'flex gap-6' : ''}`}>
        {/* Portrait image or upload placeholder (top-right mode) */}
        {layout.imagePosition === 'top-right' && (
          entity.image_url ? (
            <ImagePortrait
              src={entity.image_url}
              alt={entity.name || 'Entity'}
              readonly={readonly}
              onRemove={() => onFieldChange('image_url', null)}
            />
          ) : !readonly ? (
            <div className="flex-shrink-0 w-44">
              {renderField(
                { name: 'image_url', type: 'image', label: '' },
                entity.image_url,
                (value) => onFieldChange('image_url', value),
                false
              )}
            </div>
          ) : null
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
