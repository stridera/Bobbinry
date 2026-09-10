/**
 * Section bodies for the `progression` and `table` displays, shared by every
 * layout template. Renders nothing for the other displays, which each layout
 * still styles itself.
 */

import type { FieldDefinition, LayoutSection } from '../../types'
import { listSchemaOf } from '../../progression'
import { renderField } from '../FieldRenderers'
import { ProgressionGrid } from '../ProgressionGrid'
import { SlotTable } from '../json-renderers/SlotTable'

interface ExtendedSectionBodyProps {
  section: LayoutSection
  fields: FieldDefinition[]
  entity: Record<string, any>
  onFieldChange: (fieldName: string, value: any) => void
  readonly: boolean
}

export function ExtendedSectionBody({ section, fields, entity, onFieldChange, readonly }: ExtendedSectionBodyProps) {
  if (section.display !== 'progression' && section.display !== 'table') return null

  const defs = section.fields
    .map(name => fields.find(f => f.name === name))
    .filter((f): f is FieldDefinition => f !== undefined)

  if (section.display === 'progression') {
    return <ProgressionGrid fields={defs} entity={entity} />
  }

  return (
    <div className="space-y-6">
      {defs.map(def =>
        listSchemaOf(def) ? (
          <SlotTable
            key={def.name}
            field={def}
            value={entity[def.name]}
            onChange={value => onFieldChange(def.name, value)}
            readonly={readonly}
            showLabel={defs.length > 1}
          />
        ) : (
          <div key={def.name}>
            {renderField(def, entity[def.name], value => onFieldChange(def.name, value), readonly)}
          </div>
        )
      )}
    </div>
  )
}
