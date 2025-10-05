/**
 * Entity Editor View
 *
 * Dynamic entity editor that renders based on entity type configuration
 *
 * TODO: Implement features:
 * - Load entity type definition from entity_type_definitions
 * - Render using LayoutRenderer component
 * - Auto-save functionality
 * - Image upload support
 * - Handle all field types (text, number, select, json, rich-text, etc.)
 */

import { useState, useEffect } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import type { EntityTypeDefinition } from '../types'
import { LayoutRenderer } from '../components/LayoutRenderer'

interface EntityEditorViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityType?: string  // From ViewRouter
  entityId?: string  // From ViewRouter
  metadata?: Record<string, any>
}

export default function EntityEditorView({
  sdk,
  projectId,
  entityType,
  entityId,
}: EntityEditorViewProps) {
  const [typeConfig, setTypeConfig] = useState<EntityTypeDefinition | null>(null)
  const [entity, setEntity] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved')
  const [error, setError] = useState<string | null>(null)

  const isNewEntity = entityId === 'new'

  useEffect(() => {
    if (entityType) {
      loadTypeConfig()
    }
  }, [entityType])

  useEffect(() => {
    if (entityId && typeConfig && !isNewEntity) {
      loadEntity()
    } else if (isNewEntity && typeConfig) {
      // Initialize new entity with default values
      initializeNewEntity()
    }
  }, [entityId, typeConfig])

  async function loadTypeConfig() {
    try {
      setLoading(true)
      setError(null)

      console.log('[EntityEditor] Loading type config for:', entityType)

      const response = await fetch(`/api/collections/entity_type_definitions/entities?projectId=${projectId}`)
      
      if (!response.ok) {
        throw new Error(`Failed to load type config: ${response.statusText}`)
      }
      
      const data = await response.json()
      const config = data.entities?.find((t: any) =>
        (t.type_id || t.typeId) === entityType
      )

      if (!config) {
        console.warn(`[EntityEditor] Entity type "${entityType}" not found in entity_type_definitions`)
        setError(`Entity type "${entityType}" is not managed by the entities bobbin`)
        setLoading(false)
        return
      }
      
      setTypeConfig(config)
      console.log('[EntityEditor] Loaded type config:', config)

      setLoading(false)
    } catch (err: any) {
      console.error('[EntityEditor] Failed to load type config:', err)
      setError(err.message || 'Failed to load entity type configuration')
      setLoading(false)
    }
  }

  async function loadEntity() {
    try {
      if (!entityType || !entityId || isNewEntity || entityId === 'list') return

      console.log('[EntityEditor] Loading entity:', entityType, entityId)

      const response = await fetch(`/api/entities/${entityId}?projectId=${projectId}&collection=${entityType}`)
      
      if (!response.ok) {
        throw new Error(`Failed to load entity: ${response.statusText}`)
      }
      
      const data = await response.json()
      setEntity(data.entity || {})
      console.log('[EntityEditor] Loaded entity:', data.entity)

      setSaveStatus('saved')
    } catch (err: any) {
      console.error('[EntityEditor] Failed to load entity:', err)
      setError(err.message || 'Failed to load entity')
    }
  }

  function initializeNewEntity() {
    if (!typeConfig) return

    // Initialize with default values for all fields
    const defaultEntity: Record<string, any> = {
      name: '',
      description: '',
      tags: [],
      image_url: ''
    }

    // Add defaults for custom fields
    typeConfig.customFields.forEach(field => {
      switch (field.type) {
        case 'boolean':
          defaultEntity[field.name] = false
          break
        case 'multi-select':
          defaultEntity[field.name] = []
          break
        case 'number':
          defaultEntity[field.name] = field.min || 0
          break
        default:
          defaultEntity[field.name] = ''
      }
    })

    setEntity(defaultEntity)
    setSaveStatus('unsaved')
  }

  async function saveEntity() {
    if (!entityType || !entity || !typeConfig) return

    try {
      setSaving(true)
      setSaveStatus('saving')
      setError(null)

      // Validate required fields
      const missingFields: string[] = []

      // Check base required fields
      if (!entity.name?.trim()) {
        missingFields.push('Name')
      }

      // Check custom required fields
      typeConfig.customFields.forEach(field => {
        if (field.required && !entity[field.name]) {
          missingFields.push(field.label)
        }
      })

      if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`)
      }

      console.log('[EntityEditor] Saving entity:', { isNewEntity, entityType, entity })

      if (isNewEntity) {
        const response = await fetch('/api/entities', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            collection: entityType,
            projectId,
            data: entity
          })
        })

        if (!response.ok) {
          throw new Error(`Failed to create entity: ${response.statusText}`)
        }

        const result = await response.json()
        console.log('[EntityEditor] Created entity:', result)

        // Navigate to the created entity
        if (typeof window !== 'undefined' && result.entity?.id) {
          window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
            detail: {
              entityType,
              entityId: result.entity.id,
              bobbinId: 'entities',
              metadata: {
                view: 'entity-editor',
                isNew: false,
                typeConfig
              }
            }
          }))
        }
      } else {
        const response = await fetch(`/api/entities/${entityId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            collection: entityType,
            projectId,
            data: entity
          })
        })

        if (!response.ok) {
          throw new Error(`Failed to update entity: ${response.statusText}`)
        }

        console.log('[EntityEditor] Updated entity')
      }

      setSaveStatus('saved')
    } catch (err: any) {
      console.error('[EntityEditor] Failed to save:', err)
      setError(err.message || 'Failed to save entity')
      setSaveStatus('unsaved')
    } finally {
      setSaving(false)
    }
  }

  async function deleteEntity() {
    if (!entityType || !entityId || isNewEntity) return

    if (!confirm('Are you sure you want to delete this entity? This action cannot be undone.')) {
      return
    }

    try {
      console.log('[EntityEditor] Deleting entity:', entityType, entityId)

      const response = await fetch(`/api/entities/${entityId}?projectId=${projectId}&collection=${entityType}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error(`Failed to delete entity: ${response.statusText}`)
      }

      console.log('[EntityEditor] Deleted entity')

      // Navigate back to list
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
          detail: {
            entityType,
            entityId: 'list',
            bobbinId: 'entities',
            metadata: {
              view: 'entity-list',
              typeId: entityType,
              typeLabel: typeConfig?.label,
              typeIcon: typeConfig?.icon
            }
          }
        }))
      }
    } catch (err: any) {
      console.error('[EntityEditor] Failed to delete:', err)
      setError(err.message || 'Failed to delete entity')
    }
  }

  function handleFieldChange(fieldName: string, value: any) {
    setEntity(prev => ({
      ...prev,
      [fieldName]: value
    }))
    setSaveStatus('unsaved')
  }

  // Auto-save after 2 seconds of inactivity
  useEffect(() => {
    if (saveStatus === 'unsaved') {
      const timer = setTimeout(() => {
        saveEntity()
      }, 2000)

      return () => clearTimeout(timer)
    }
  }, [entity, saveStatus])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600 dark:text-gray-400">Loading editor...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="max-w-md p-6 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-300 mb-2">
            Error Loading Entity
          </h2>
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      </div>
    )
  }

  if (!typeConfig) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600 dark:text-gray-400">
          Entity type not found
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{typeConfig.icon}</span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {entity.name || 'New ' + typeConfig.label}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {typeConfig.label}
              {isNewEntity && ' (unsaved)'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {!isNewEntity && (
            <button
              onClick={deleteEntity}
              className="px-4 py-2 bg-red-600 dark:bg-red-700 text-white rounded hover:bg-red-700 dark:hover:bg-red-600"
            >
              Delete
            </button>
          )}

          <span
            className={
              saveStatus === 'saved' ? 'text-green-600 dark:text-green-400 text-sm' :
              saveStatus === 'saving' ? 'text-orange-600 dark:text-orange-400 text-sm' :
              'text-gray-600 dark:text-gray-400 text-sm'
            }
          >
            {saveStatus === 'saved' && '✓ Saved'}
            {saveStatus === 'saving' && 'Saving...'}
            {saveStatus === 'unsaved' && '• Auto-save in 2s'}
          </span>

          <button
            onClick={saveEntity}
            disabled={saving || saveStatus === 'saved'}
            className={`px-4 py-2 rounded font-medium ${
              saveStatus === 'saved'
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-default'
                : 'bg-blue-600 dark:bg-blue-700 text-white cursor-pointer hover:bg-blue-700 dark:hover:bg-blue-600'
            }`}
          >
            {saving ? 'Saving...' : 'Save Now'}
          </button>
        </div>
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-auto p-6">
        <LayoutRenderer
          layout={typeConfig.editorLayout}
          fields={typeConfig.customFields}
          entity={entity}
          onFieldChange={handleFieldChange}
          readonly={false}
        />
      </div>
    </div>
  )
}
