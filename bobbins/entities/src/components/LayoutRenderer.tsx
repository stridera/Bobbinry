/**
 * LayoutRenderer Component
 *
 * Dynamically renders entity editor based on layout configuration
 * Routes to the appropriate layout template component
 */

import type { EditorLayout, FieldDefinition, LayoutSection } from '../types'
import { progressionHasContent } from '../progression'
import { useProgressionContext, type ProgressionContextValue } from './UploadContext'
import { CompactCardLayout } from './layouts/CompactCardLayout'
import { HeroImageLayout } from './layouts/HeroImageLayout'
import { ListDetailsLayout } from './layouts/ListDetailsLayout'

interface LayoutRendererProps {
  layout?: EditorLayout | null
  fields: FieldDefinition[]
  entity: Record<string, any>
  onFieldChange: (fieldName: string, value: any) => void
  readonly?: boolean
  /** Label of the earlier era the gallery is carried forward from, if any. */
  inheritedGalleryFrom?: string | null
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

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

/** In readonly (reader) mode, fields with nothing to show are dropped and
 * sections left empty disappear with them — a labeled blank row is noise for
 * readers. Only fields we have a definition for are pruned; names the layout
 * references but that aren't in `fields` keep their existing handling. The
 * editor renders every field so authors can fill them in.
 *
 * A progression section reads every era, not just the one on screen, so it's
 * kept or dropped by whether any visible era has content — and its fields stay
 * defined even when the current view's value is empty. */
function pruneEmptyFields(
  layout: EditorLayout,
  fields: FieldDefinition[],
  entity: Record<string, any>,
  progression: ProgressionContextValue | null
): { layout: EditorLayout; fields: FieldDefinition[] } {
  const prunable = (name: string): boolean => {
    const def = fields.find(f => f.name === name)
    return def ? isEmptyValue(entity[def.name]) : false
  }
  const progressionShows = (section: LayoutSection, ctx: ProgressionContextValue): boolean => {
    const defs = section.fields
      .map(name => fields.find(f => f.name === name))
      .filter((f): f is FieldDefinition => f !== undefined)
    return progressionHasContent(ctx.data, ctx.config, defs, { includeBase: ctx.includeBase, eraIds: ctx.eraIds })
  }
  const sections = layout.sections
    .map(section => {
      if (section.display === 'progression' && progression) {
        return progressionShows(section, progression) ? section : { ...section, fields: [] }
      }
      return { ...section, fields: section.fields.filter(name => !prunable(name)) }
    })
    .filter(section => section.fields.length > 0)
  const progressionFields = new Set(
    sections.filter(s => s.display === 'progression').flatMap(s => s.fields)
  )
  return {
    fields: fields.filter(f => progressionFields.has(f.name) || !isEmptyValue(entity[f.name])),
    layout: {
      ...layout,
      headerFields: layout.headerFields.filter(name => !prunable(name)),
      sections,
    },
  }
}

export function LayoutRenderer({
  layout: configuredLayout,
  fields: allFields,
  entity,
  onFieldChange,
  readonly = false,
  inheritedGalleryFrom = null
}: LayoutRendererProps) {
  const progression = useProgressionContext()
  const configured = configuredLayout ?? defaultLayout(allFields)
  const { layout, fields } = readonly
    ? pruneEmptyFields(configured, allFields, entity, progression)
    : { layout: configured, fields: allFields }

  // Route to appropriate layout template
  function renderTemplate() {
    switch (layout.template) {
      case 'compact-card':
        return (
          <CompactCardLayout
            entity={entity}
            layout={layout}
            fields={fields}
            onFieldChange={onFieldChange}
            readonly={readonly}
            inheritedGalleryFrom={inheritedGalleryFrom}
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
            inheritedGalleryFrom={inheritedGalleryFrom}
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
            inheritedGalleryFrom={inheritedGalleryFrom}
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

  // Container-query root: layouts render everywhere from a 24rem docked
  // sidebar to a full-width editor canvas, so section grids and type scale
  // must respond to THIS box, not the viewport. All @sm/@md/@2xl/... variants
  // inside the layout templates resolve against this element.
  return <div className="@container">{renderTemplate()}</div>
}
