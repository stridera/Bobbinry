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

import { useState, useEffect, useMemo } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import type { EntityTypeDefinition, EntityVariants, FieldDefinition, VariantItem } from '../types'
import { normalizeTypeConfig, normalizeJsonSchema, createDefaultJsonValue } from '../types'
import {
  VARIANTS_KEY,
  getVariants,
  resolveEntityForVariant,
  setFieldOnEntity,
  sortedVariantIds,
  versionableFieldNames,
} from '../variants'
import { LayoutRenderer } from '../components/LayoutRenderer'
import { SdkProvider } from '../components/UploadContext'
import { checkTypeCompatibility } from '../components/FieldRenderers'

function slugifyVariantId(label: string): string {
  const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return base || `variant-${Date.now().toString(36)}`
}

function ensureUniqueVariantId(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base
  let i = 2
  while (existing.includes(`${base}-${i}`)) i++
  return `${base}-${i}`
}

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
  const [viewMode, setViewMode] = useState<'view' | 'edit'>('view')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // null = Base (no variant selected). Otherwise, a variant id from entity._variants.
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null)
  const [managingVariants, setManagingVariants] = useState(false)

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
      setViewMode('edit')
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

      const normalized = normalizeTypeConfig(config)
      setTypeConfig(normalized)
      console.log('[EntityEditor] Loaded type config:', normalized)

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
        case 'json':
          defaultEntity[field.name] = createDefaultJsonValue(normalizeJsonSchema(field.schema))
          break
        default:
          defaultEntity[field.name] = ''
      }
    })

    setEntity(defaultEntity)
    // Don't mark as unsaved — wait for user to actually edit a field
    setSaveStatus('saved')
  }

  async function saveEntity(manual = false, override?: Record<string, any>) {
    if (!entityType || !typeConfig) return
    // Use the override when the caller already has the next entity in hand
    // (e.g. schema-sync needs to persist synchronously without waiting for
    // a React state flush). Falls back to the current entity state otherwise.
    const source = override ?? entity
    if (!source) return

    try {
      setSaving(true)
      setSaveStatus('saving')
      setError(null)

      // Validate required fields
      const missingFields: string[] = []

      // Check base required fields
      if (!source.name?.trim()) {
        missingFields.push('Name')
      }

      // Check custom required fields
      typeConfig.customFields.forEach(field => {
        if (field.required && !source[field.name]) {
          missingFields.push(field.label)
        }
      })

      if (missingFields.length > 0) {
        setSaving(false)
        setSaveStatus('unsaved')
        if (manual) {
          setSaveError(true)
          setTimeout(() => setSaveError(false), 3000)
        }
        return
      }

      // Stamp current schema version on save
      const entityToSave = {
        ...source,
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

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('bobbinry:entities-changed', {
            detail: { collection: entityType, action: 'updated' }
          }))
        }
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
    setEntity(prev => setFieldOnEntity(prev, typeConfig, activeVariantId, fieldName, value))
    setSaveStatus('unsaved')
    setSaveError(false) // Reset error flag when user makes a new edit
  }

  // Variant management -----------------------------------------------------

  function addVariant(label: string) {
    const trimmed = label.trim()
    if (!trimmed) return
    let newId = ''
    setEntity(prev => {
      const current = getVariants(prev)
      const existingIds = current ? current.order : []
      const id = ensureUniqueVariantId(slugifyVariantId(trimmed), existingIds)
      newId = id
      const newItem: VariantItem = { label: trimmed, overrides: {} }
      if (typeConfig?.variantAxis?.kind === 'ordered') {
        const num = Number(trimmed.match(/\d+(?:\.\d+)?/)?.[0])
        if (!Number.isNaN(num)) newItem.axis_value = num
      }
      const next: EntityVariants = {
        axis_id: typeConfig?.variantAxis?.id ?? null,
        active: current?.active ?? id,
        order: [...existingIds, id],
        items: { ...(current?.items ?? {}), [id]: newItem },
      }
      return { ...prev, [VARIANTS_KEY]: next }
    })
    setActiveVariantId(newId)
    setSaveStatus('unsaved')
    setSaveError(false)
  }

  function renameVariant(id: string, label: string) {
    const trimmed = label.trim()
    if (!trimmed) return
    setEntity(prev => {
      const v = getVariants(prev)
      if (!v || !v.items[id]) return prev
      return {
        ...prev,
        [VARIANTS_KEY]: {
          ...v,
          items: { ...v.items, [id]: { ...v.items[id]!, label: trimmed } },
        },
      }
    })
    setSaveStatus('unsaved')
    setSaveError(false)
  }

  function deleteVariant(id: string) {
    setEntity(prev => {
      const v = getVariants(prev)
      if (!v || !v.items[id]) return prev
      const { [id]: _dropped, ...rest } = v.items
      const nextOrder = v.order.filter(x => x !== id)
      const nextActive: string | null = v.active === id ? (nextOrder[0] ?? null) : (v.active ?? null)
      const next: EntityVariants = {
        ...v,
        active: nextActive,
        order: nextOrder,
        items: rest,
      }
      return { ...prev, [VARIANTS_KEY]: next }
    })
    if (activeVariantId === id) setActiveVariantId(null)
    setSaveStatus('unsaved')
    setSaveError(false)
  }

  function setDefaultVariant(id: string | null) {
    setEntity(prev => {
      const v = getVariants(prev)
      if (!v) return prev
      return { ...prev, [VARIANTS_KEY]: { ...v, active: id } }
    })
    setSaveStatus('unsaved')
    setSaveError(false)
  }

  function setVariantAxisValue(id: string, axisValue: number | null) {
    setEntity(prev => {
      const v = getVariants(prev)
      if (!v || !v.items[id]) return prev
      const item = v.items[id]!
      return {
        ...prev,
        [VARIANTS_KEY]: {
          ...v,
          items: { ...v.items, [id]: { ...item, axis_value: axisValue } },
        },
      }
    })
    setSaveStatus('unsaved')
    setSaveError(false)
  }

  async function handleUpdateSchema() {
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
    setSaveError(false)
    // Persist immediately — auto-save is gated on edit mode, so without an
    // explicit save the stamped schema_version would be lost on refresh.
    await saveEntity(false, updated)
  }

  // Auto-save after 2 seconds of inactivity (skip if last save errored or in view mode)
  useEffect(() => {
    if (saveStatus === 'unsaved' && !saveError && viewMode === 'edit') {
      const timer = setTimeout(() => {
        saveEntity()
      }, 2000)

      return () => clearTimeout(timer)
    }
    return undefined
  }, [entity, saveStatus, saveError, viewMode])

  // Once the entity is loaded, default the variant selector to the entity's
  // declared default if one is set.
  useEffect(() => {
    if (activeVariantId !== null) return
    const v = getVariants(entity)
    if (v?.active && v.items[v.active]) setActiveVariantId(v.active)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity])

  // Variant list (sorted by axis kind if the type has one)
  const variantIdsInOrder = useMemo(
    () => sortedVariantIds(entity, typeConfig?.variantAxis?.kind ?? null),
    [entity, typeConfig?.variantAxis?.kind]
  )
  const variantsBlock = getVariants(entity)
  const hasVersionableFields = useMemo(() => versionableFieldNames(typeConfig).size > 0, [typeConfig])

  // The entity view to render: base when no variant selected, merged when one is.
  const displayEntity = useMemo(
    () => (activeVariantId ? resolveEntityForVariant(entity, typeConfig, activeVariantId) : entity),
    [entity, activeVariantId, typeConfig]
  )

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

        <div className="flex items-center gap-3">
          {/* Edit mode controls (left side, takes available space) */}
          <div className="flex items-center gap-3 flex-1">
            {viewMode === 'edit' && (
              <>
                {!isNewEntity && (
                  confirmingDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-red-600 dark:text-red-400">Delete this entity?</span>
                      <button
                        onClick={() => { setConfirmingDelete(false); deleteEntity() }}
                        className="px-2.5 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 cursor-pointer"
                      >
                        Yes, delete
                      </button>
                      <button
                        onClick={() => setConfirmingDelete(false)}
                        className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingDelete(true)}
                      className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded cursor-pointer"
                    >
                      Delete
                    </button>
                  )
                )}

                <span
                  className={
                    saveStatus === 'saved' ? 'text-green-600 dark:text-green-400 text-sm' :
                    saveStatus === 'saving' ? 'text-orange-600 dark:text-orange-400 text-sm' :
                    'text-gray-600 dark:text-gray-400 text-sm'
                  }
                >
                  {saveError && <span className="text-red-500">Name is required</span>}
                  {!saveError && saveStatus === 'saved' && '✓ Saved'}
                  {!saveError && saveStatus === 'saving' && 'Saving...'}
                  {!saveError && saveStatus === 'unsaved' && '• Auto-save in 2s'}
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
              </>
            )}
          </div>

          {/* View/Edit toggle (pinned right) */}
          {!isNewEntity && (
            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('view')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer ${
                  viewMode === 'view'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('edit')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer ${
                  viewMode === 'edit'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                Edit
              </button>
            </div>
          )}
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

      {/* Variant switcher bar (shown when the type declares versionable fields) */}
      {hasVersionableFields && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {typeConfig.variantAxis?.label ?? 'Variant'}:
          </span>
          <button
            type="button"
            onClick={() => setActiveVariantId(null)}
            className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer ${
              activeVariantId === null
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Base
          </button>
          {variantIdsInOrder.map(id => {
            const item = variantsBlock?.items[id]
            if (!item) return null
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveVariantId(id)}
                className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer ${
                  activeVariantId === id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                title={variantsBlock?.active === id ? 'Default variant' : undefined}
              >
                {item.label}
                {variantsBlock?.active === id && <span className="ml-1 text-[10px]">★</span>}
              </button>
            )
          })}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setManagingVariants(v => !v)}
            className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-1 cursor-pointer"
          >
            {managingVariants ? 'Close' : 'Manage'}
          </button>
        </div>
      )}

      {/* Variant management panel (inline, no browser dialogs) */}
      {hasVersionableFields && managingVariants && (
        <VariantManager
          entity={entity}
          axisKind={typeConfig.variantAxis?.kind ?? 'unordered'}
          axisLabel={typeConfig.variantAxis?.label ?? 'Variant'}
          onAdd={addVariant}
          onRename={renameVariant}
          onDelete={deleteVariant}
          onSetDefault={setDefaultVariant}
          onSetAxisValue={setVariantAxisValue}
        />
      )}

      {/* Editor Content */}
      <div className="flex-1 overflow-auto p-6">
        <SdkProvider sdk={sdk} projectId={projectId}>
          <LayoutRenderer
            layout={typeConfig.editorLayout}
            fields={typeConfig.customFields}
            entity={displayEntity}
            onFieldChange={handleFieldChange}
            readonly={viewMode === 'view'}
          />
        </SdkProvider>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// VariantManager — inline panel for adding / renaming / deleting variants.
// Kept inside this file since it's tightly coupled to the editor's state.

interface VariantManagerProps {
  entity: Record<string, any>
  axisKind: 'ordered' | 'unordered'
  axisLabel: string
  onAdd: (label: string) => void
  onRename: (id: string, label: string) => void
  onDelete: (id: string) => void
  onSetDefault: (id: string | null) => void
  onSetAxisValue: (id: string, axisValue: number | null) => void
}

function VariantManager({
  entity,
  axisKind,
  axisLabel,
  onAdd,
  onRename,
  onDelete,
  onSetDefault,
  onSetAxisValue,
}: VariantManagerProps) {
  const [newLabel, setNewLabel] = useState('')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const variants = getVariants(entity)
  const ids = sortedVariantIds(entity, axisKind)

  function commitAdd() {
    if (!newLabel.trim()) return
    onAdd(newLabel.trim())
    setNewLabel('')
  }

  function commitRename(id: string) {
    if (!renameDraft.trim()) return
    onRename(id, renameDraft.trim())
    setRenamingId(null)
    setRenameDraft('')
  }

  return (
    <div className="mx-4 mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder={`New ${axisLabel.toLowerCase()}…`}
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitAdd() }}
          className="flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-gray-900 dark:text-gray-100"
        />
        <button
          type="button"
          onClick={commitAdd}
          disabled={!newLabel.trim()}
          className="px-3 py-1 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        >
          Add variant
        </button>
      </div>

      {ids.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">No variants yet. Add one above.</p>
      )}

      {ids.map(id => {
        const item = variants?.items[id]
        if (!item) return null
        const isDefault = variants?.active === id
        return (
          <div key={id} className="flex flex-wrap items-center gap-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5">
            {renamingId === id ? (
              <>
                <input
                  type="text"
                  value={renameDraft}
                  onChange={e => setRenameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(id) }}
                  autoFocus
                  className="flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-0.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => commitRename(id)}
                  className="px-2 py-0.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => { setRenamingId(null); setRenameDraft('') }}
                  className="px-2 py-0.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className="text-sm text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate">{item.label}</span>
                {axisKind === 'ordered' && (
                  <input
                    type="number"
                    value={item.axis_value == null ? '' : item.axis_value}
                    onChange={e => {
                      const raw = e.target.value
                      onSetAxisValue(id, raw === '' ? null : Number(raw))
                    }}
                    title={`${axisLabel} value (sort key)`}
                    className="w-16 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-0.5 text-xs"
                  />
                )}
                <button
                  type="button"
                  onClick={() => onSetDefault(isDefault ? null : id)}
                  className={`text-xs px-2 py-0.5 rounded cursor-pointer ${
                    isDefault
                      ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  title={isDefault ? 'Unset as default' : 'Set as default variant'}
                >
                  {isDefault ? '★ Default' : 'Set default'}
                </button>
                <button
                  type="button"
                  onClick={() => { setRenamingId(id); setRenameDraft(item.label) }}
                  className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 px-2 py-0.5 cursor-pointer"
                >
                  Rename
                </button>
                {confirmingDeleteId === id ? (
                  <>
                    <span className="text-xs text-red-600 dark:text-red-400">Delete variant?</span>
                    <button
                      type="button"
                      onClick={() => { setConfirmingDeleteId(null); onDelete(id) }}
                      className="px-2 py-0.5 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700 cursor-pointer"
                    >
                      Yes, delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(null)}
                      className="px-2 py-0.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteId(id)}
                    className="px-2 py-0.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded cursor-pointer"
                  >
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
