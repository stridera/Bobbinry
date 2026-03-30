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
import type { EntityTypeDefinition, FieldDefinition } from '../types'
import { LayoutRenderer } from '../components/LayoutRenderer'
import { SdkProvider } from '../components/UploadContext'
import { checkTypeCompatibility } from '../components/FieldRenderers'

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
  const [saveError, setSaveError] = useState(false) // Prevents auto-save retry loop
  const [versionMismatch, setVersionMismatch] = useState(false)

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

      const result = await sdk.entities.query({ collection: 'entity_type_definitions' })
      const config = result.data.find((t: any) =>
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

      const data = await sdk.entities.get(entityType, entityId)
      const entityData = data?.entity || data || {}
      setEntity(entityData)
      console.log('[EntityEditor] Loaded entity:', data)

      // Check schema version mismatch
      if (typeConfig) {
        const typeVersion = (typeConfig as any).schema_version || 0
        const entityVersion = entityData._schema_version || 0
        setVersionMismatch(typeVersion > 0 && entityVersion < typeVersion)
      }

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
      image_url: '',
      _schema_version: (typeConfig as any).schema_version || 1,
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
        case 'relation':
          defaultEntity[field.name] = field.allowMultiple ? [] : null
          break
        default:
          defaultEntity[field.name] = ''
      }
    })

    setEntity(defaultEntity)
    // Don't mark as unsaved — wait for user to actually edit a field
    setSaveStatus('saved')
  }

  async function saveEntity(manual = false) {
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
        if (!manual) {
          // Auto-save: silently skip if required fields aren't filled
          setSaving(false)
          setSaveStatus('unsaved')
          return
        }
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`)
      }

      // Stamp current schema version on save
      const entityToSave = {
        ...entity,
        _schema_version: (typeConfig as any).schema_version || 1,
      }

      console.log('[EntityEditor] Saving entity:', { isNewEntity, entityType, entity: entityToSave })

      if (isNewEntity) {
        const result: any = await sdk.entities.create(entityType!, entityToSave)
        console.log('[EntityEditor] Created entity:', result)

        // Notify sidebar that entities changed
        const createdId = result?.entity?.id || result?.id
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('bobbinry:entities-changed', {
            detail: { collection: entityType, action: 'created' }
          }))

          // Navigate to the created entity
          if (createdId) {
            window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
              detail: {
                entityType,
                entityId: createdId,
                bobbinId: 'entities',
                metadata: {
                  view: 'entity-editor',
                  isNew: false,
                  typeConfig
                }
              }
            }))
          }
        }
      } else {
        await sdk.entities.update(entityType!, entityId!, entityToSave)
        console.log('[EntityEditor] Updated entity')
      }

      setSaveStatus('saved')
    } catch (err: any) {
      console.error('[EntityEditor] Failed to save:', err)
      setError(err.message || 'Failed to save entity')
      setSaveStatus('unsaved')
      setSaveError(true) // Stop auto-save from retrying
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

      await sdk.entities.delete(entityType!, entityId!)

      console.log('[EntityEditor] Deleted entity')

      // Notify sidebar that entities changed
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('bobbinry:entities-changed', {
          detail: { collection: entityType, action: 'deleted' }
        }))
      }

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
    setSaveError(false) // Reset error flag when user makes a new edit
  }

  function handleUpdateSchema() {
    if (!typeConfig) return

    const customFields: FieldDefinition[] = typeConfig.customFields || (typeConfig as any).custom_fields || []
    const updated = { ...entity }

    // Clear incompatible values and add defaults for new fields
    for (const field of customFields) {
      const currentValue = updated[field.name]
      if (currentValue !== null && currentValue !== undefined && currentValue !== '') {
        const { compatible } = checkTypeCompatibility(field.type, currentValue, field)
        if (!compatible) {
          updated[field.name] = null
        }
      } else if (!(field.name in updated)) {
        // New field — set default
        switch (field.type) {
          case 'boolean': updated[field.name] = false; break
          case 'multi-select': updated[field.name] = []; break
          case 'number': updated[field.name] = field.min || 0; break
          case 'relation': updated[field.name] = field.allowMultiple ? [] : null; break
          default: updated[field.name] = ''
        }
      }
    }

    // Stamp new version
    updated._schema_version = (typeConfig as any).schema_version || 1

    setEntity(updated)
    setVersionMismatch(false)
    setSaveStatus('unsaved')
    setSaveError(false)
  }

  // Auto-save after 2 seconds of inactivity (skip if last save errored)
  useEffect(() => {
    if (saveStatus === 'unsaved' && !saveError) {
      const timer = setTimeout(() => {
        saveEntity()
      }, 2000)

      return () => clearTimeout(timer)
    }
    return undefined
  }, [entity, saveStatus, saveError])

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
            onClick={() => saveEntity(true)}
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

      {/* Schema version mismatch banner */}
      {versionMismatch && (
        <div className="mx-4 mt-4 p-3 border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 rounded-lg flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-amber-600 dark:text-amber-400 flex-shrink-0">&#9888;</span>
            <span className="text-sm text-amber-800 dark:text-amber-200">
              This entity was created with an older field schema. Some fields may have changed type or been added.
            </span>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleUpdateSchema}
              className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded hover:bg-amber-700 cursor-pointer"
            >
              Update to latest
            </button>
            <button
              onClick={() => setVersionMismatch(false)}
              className="px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-600 rounded hover:bg-amber-100 dark:hover:bg-amber-800 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Editor Content */}
      <div className="flex-1 overflow-auto p-6">
        <SdkProvider sdk={sdk} projectId={projectId}>
          <LayoutRenderer
            layout={typeConfig.editorLayout}
            fields={typeConfig.customFields}
            entity={entity}
            onFieldChange={handleFieldChange}
            readonly={false}
          />
        </SdkProvider>
      </div>
    </div>
  )
}
