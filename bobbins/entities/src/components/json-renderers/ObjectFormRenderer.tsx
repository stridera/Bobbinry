/**
 * ObjectFormRenderer
 *
 * Renders a flat object as a grid of labeled inputs.
 * Used for schema mode: 'object' (e.g., D&D stats block).
 */

import type { JsonSchema } from '../../types'
import { JsonSchemaFieldInput } from './JsonSchemaFieldInput'

interface ObjectFormRendererProps {
  schema: JsonSchema
  value: Record<string, any>
  onChange: (value: Record<string, any>) => void
}

export function ObjectFormRenderer({ schema, value, onChange }: ObjectFormRendererProps) {
  const data = (typeof value === 'object' && value !== null && !Array.isArray(value)) ? value : {}
  const fieldEntries = Object.entries(schema.fields)

  function handleFieldChange(key: string, fieldValue: any) {
    onChange({ ...data, [key]: fieldValue })
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {fieldEntries.map(([key, field]) => (
        <JsonSchemaFieldInput
          key={key}
          fieldKey={key}
          field={field}
          value={data[key]}
          onChange={(v) => handleFieldChange(key, v)}
        />
      ))}
    </div>
  )
}
