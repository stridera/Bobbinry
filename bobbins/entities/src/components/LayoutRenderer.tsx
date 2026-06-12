/**
 * LayoutRenderer Component
 *
 * Dynamically renders entity editor based on layout configuration
 * Routes to the appropriate layout template component
 */

import type { EditorLayout, FieldDefinition } from '../types'
import { CompactCardLayout } from './layouts/CompactCardLayout'
import { HeroImageLayout } from './layouts/HeroImageLayout'
import { ListDetailsLayout } from './layouts/ListDetailsLayout'

interface LayoutRendererProps {
  layout?: EditorLayout | null
  fields: FieldDefinition[]
  entity: Record<string, any>
  onFieldChange: (fieldName: string, value: any) => void
  readonly?: boolean
}

/** Type definitions created without an editor layout still need to render. */
function defaultLayout(fields: FieldDefinition[]): EditorLayout {
  return {
    template: 'compact-card',
    imagePosition: 'top-right',
    imageSize: 'small',
    headerFields: [],
    sections: fields.length > 0
      ? [{ title: 'Details', fields: fields.map(f => f.name), display: 'stacked' }]
      : [],
  }
}

export function LayoutRenderer({
  layout: configuredLayout,
  fields,
  entity,
  onFieldChange,
  readonly = false
}: LayoutRendererProps) {
  const layout = configuredLayout ?? defaultLayout(fields)

  // Route to appropriate layout template
  switch (layout.template) {
    case 'compact-card':
      return (
        <CompactCardLayout
          entity={entity}
          layout={layout}
          fields={fields}
          onFieldChange={onFieldChange}
          readonly={readonly}
        />
      )

    case 'hero-image':
      return (
        <HeroImageLayout
          entity={entity}
          layout={layout}
          fields={fields}
          onFieldChange={onFieldChange}
          readonly={readonly}
        />
      )

    case 'list-details':
      return (
        <ListDetailsLayout
          entity={entity}
          layout={layout}
          fields={fields}
          onFieldChange={onFieldChange}
          readonly={readonly}
        />
      )

    default:
      return (
        <div className="p-6 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
          <p className="text-red-700 dark:text-red-300 font-medium">
            Unknown layout template: {layout.template}
          </p>
          <p className="text-sm text-red-600 dark:text-red-400 mt-2">
            Supported templates: compact-card, hero-image, list-details
          </p>
        </div>
      )
  }
}
