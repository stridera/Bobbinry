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
  ensureUniqueVariantId,
  getVariants,
  resolveEntityForVariant,
  setFieldOnEntity,
  slugifyVariantId,
  sortedVariantIds,
  versionableFieldNames,
} from '../variants'
import { LayoutRenderer } from '../components/LayoutRenderer'
import { SdkProvider, EntityNavProvider } from '../components/UploadContext'
import { checkTypeCompatibility } from '../components/FieldRenderers'
import { PublishControl } from '../components/PublishControl'
import {
  fetchProjectOwner,
  fetchSubscriptionTiers,
  patchEntityPublish,
  type SubscriptionTier,
} from '../publish-api'

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
  const [tiers, setTiers] = useState<SubscriptionTier[]>([])
  const [tiersLoaded, setTiersLoaded] = useState(false)
  const [typePublished, setTypePublished] = useState<boolean>(true)
  const [typeLabel, setTypeLabel] = useState<string>('')

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

  // Load the author's subscription tiers so the inline publish picker can
  // show them. Single fetch per project; cheap to leave running even on new-
  // entity flow so the control is ready once the entity is saved.
  useEffect(() => {
    let cancelled = false
    if (tiersLoaded) return
    ;(async () => {
      try {
        const { ownerId } = await fetchProjectOwner(sdk, projectId)
        const res = await fetchSubscriptionTiers(sdk, ownerId)
        if (!cancelled) {
          setTiers([...res.tiers].sort((a, b) => a.tierLevel - b.tierLevel))
          setTiersLoaded(true)
        }
      } catch (err) {
        console.warn('[EntityEditor] Could not load tiers:', err)
        if (!cancelled) setTiersLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [projectId, sdk, tiersLoaded])

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
      setTypePublished(Boolean((config as any).isPublished))
      setTypeLabel(String((config as any).label ?? normalized.label ?? entityType ?? ''))
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

  /**
   * Persist the entity. When `source` is supplied, that exact object is used
   * — callers that just mutated state in-hand (schema sync, variant ops) pass
   * the next entity so the write doesn't race with React's state flush.
   * `manual` distinguishes user-clicked saves (which surface validation
   * errors via the save-status pill) from auto-save / programmatic saves.
   */
  async function saveEntity(options: { manual?: boolean; source?: Record<string, any> } = {}) {
    if (!entityType || !typeConfig) return
    const { manual = false, source: overrideSource } = options
    const source = overrideSource ?? entity
    if (!source) return

    try {
      setSaving(true)
      setSaveStatus('saving')
      setError(null)

      const missingFields: string[] = []
      if (!source.name?.trim()) missingFields.push('Name')
      typeConfig.customFields.forEach(field => {
        if (field.required && !source[field.name]) missingFields.push(field.label)
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
  //
  // Variant mutations persist immediately rather than relying on auto-save.
  // Auto-save is gated on edit mode, and structural edits (add/rename/delete
  // variant) should work from view mode too — otherwise "Add variant" appears
  // to succeed but gets dropped on refresh.

  async function updateVariants(mutate: (current: EntityVariants | null) => EntityVariants | null) {
    if (!entity) return
    const next = mutate(getVariants(entity))
    if (next === null) return
    const nextEntity = { ...entity, [VARIANTS_KEY]: next }
    setEntity(nextEntity)
    setSaveError(false)
    await saveEntity({ source: nextEntity })
  }

  async function addVariant(label: string) {
    const trimmed = label.trim()
    if (!trimmed) return
    let newId = ''
    await updateVariants(current => {
      const existingIds = current ? current.order : []
      const id = ensureUniqueVariantId(slugifyVariantId(trimmed), existingIds)
      newId = id
      const newItem: VariantItem = { label: trimmed, overrides: {} }
      if (typeConfig?.variantAxis?.kind === 'ordered') {
        const num = Number(trimmed.match(/\d+(?:\.\d+)?/)?.[0])
        if (!Number.isNaN(num)) newItem.axis_value = num
      }
      return {
        axis_id: typeConfig?.variantAxis?.id ?? null,
        active: current?.active ?? id,
        order: [...existingIds, id],
        items: { ...(current?.items ?? {}), [id]: newItem },
      }
    })
    if (newId) setActiveVariantId(newId)
  }

  async function renameVariant(id: string, label: string) {
    const trimmed = label.trim()
    if (!trimmed) return
    await updateVariants(v => {
      if (!v || !v.items[id]) return null
      return { ...v, items: { ...v.items, [id]: { ...v.items[id]!, label: trimmed } } }
    })
  }

  async function deleteVariant(id: string) {
    await updateVariants(v => {
      if (!v || !v.items[id]) return null
      const { [id]: _dropped, ...rest } = v.items
      const nextOrder = v.order.filter(x => x !== id)
      const nextActive: string | null = v.active === id ? (nextOrder[0] ?? null) : (v.active ?? null)
      return { ...v, active: nextActive, order: nextOrder, items: rest }
    })
    if (activeVariantId === id) setActiveVariantId(null)
  }

  async function setDefaultVariant(id: string | null) {
    await updateVariants(v => (v ? { ...v, active: id } : null))
  }

  async function moveVariant(id: string, delta: -1 | 1) {
    await updateVariants(v => {
      if (!v || !v.items[id]) return null
      const idx = v.order.indexOf(id)
      if (idx === -1) return null
      const target = idx + delta
      if (target < 0 || target >= v.order.length) return null
      const nextOrder = [...v.order]
      ;[nextOrder[idx], nextOrder[target]] = [nextOrder[target]!, nextOrder[idx]!]

      // For ordered axes, keep axis_value aligned with the new position so
      // sortedVariantIds() (which prefers axis_value) matches the visual
      // order. 1-based because authors think of "Book 1, Book 2…" not 0.
      let nextItems = v.items
      if (typeConfig?.variantAxis?.kind === 'ordered') {
        nextItems = { ...v.items }
        nextOrder.forEach((vid, i) => {
          const item = nextItems[vid]
          if (item) nextItems[vid] = { ...item, axis_value: i + 1 }
        })
      }
      return { ...v, order: nextOrder, items: nextItems }
    })
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
    await saveEntity({ source: updated })
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

  const variantsBlock = useMemo(() => getVariants(entity), [entity])
  const variantIdsInOrder = useMemo(
    () => sortedVariantIds(entity, typeConfig?.variantAxis?.kind ?? null),
    [entity, typeConfig?.variantAxis?.kind]
  )
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
      <div className="border-b border-gray-200 dark:border-gray-700 p-8 bg-white dark:bg-gray-800 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{typeConfig.icon}</span>
          <div>
            <h1 className="mb-2 text-3xl font-bold text-gray-900 dark:text-gray-100">
              {entity.name || 'New ' + typeConfig.label}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {typeConfig.label}
              {isNewEntity && ' (unsaved)'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Inline publish control (only for saved entities — can't publish an unsaved draft) */}
          {!isNewEntity && entityType && (
            <PublishControl
              isPublished={Boolean(entity.isPublished)}
              minimumTierLevel={Number(entity.minimumTierLevel ?? 0)}
              publishedAt={entity.publishedAt ?? null}
              tiers={tiers}
              hasTiers={tiers.length > 0}
              onTogglePublish={async next => {
                const result = await patchEntityPublish(
                  sdk,
                  projectId,
                  entityType,
                  entityId!,
                  { isPublished: next }
                )
                setEntity(prev => ({
                  ...prev,
                  isPublished: result.isPublished,
                  publishedAt: result.publishedAt,
                }))
              }}
              onChangeTier={async nextLevel => {
                const result = await patchEntityPublish(
                  sdk,
                  projectId,
                  entityType,
                  entityId!,
                  { minimumTierLevel: nextLevel }
                )
                setEntity(prev => ({
                  ...prev,
                  minimumTierLevel: result.minimumTierLevel,
                }))
              }}
              hideVariantPicker
              disabledReason={
                typePublished
                  ? null
                  : `${typeLabel || 'This section'} is not published to readers yet`
              }
              compact
            />
          )}

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
                  onClick={() => saveEntity({ manual: true })}
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
          publishBase={entity.publishBase ?? true}
          publishedVariantIds={
            Array.isArray(entity.publishedVariantIds) ? entity.publishedVariantIds : []
          }
          variantAccessLevels={
            entity.variantAccessLevels && typeof entity.variantAccessLevels === 'object'
              ? entity.variantAccessLevels
              : {}
          }
          tiers={tiers}
          isEntityPublished={Boolean(entity.isPublished) && !isNewEntity}
          onAdd={addVariant}
          onRename={renameVariant}
          onDelete={deleteVariant}
          onSetDefault={setDefaultVariant}
          onMove={moveVariant}
          onToggleVariantPublish={async (which, next) => {
            if (isNewEntity || !entityType) return
            const currentBase = entity.publishBase ?? true
            const currentIds: string[] = Array.isArray(entity.publishedVariantIds)
              ? entity.publishedVariantIds
              : []
            const nextState =
              which === '__base__'
                ? { publishBase: next, publishedVariantIds: currentIds }
                : {
                    publishBase: currentBase,
                    publishedVariantIds: next
                      ? Array.from(new Set([...currentIds, which]))
                      : currentIds.filter(x => x !== which),
                  }
            const result = await patchEntityPublish(
              sdk,
              projectId,
              entityType,
              entityId!,
              nextState
            )
            setEntity(prev => ({
              ...prev,
              publishBase: result.publishBase,
              publishedVariantIds: result.publishedVariantIds,
            }))
          }}
          onChangeVariantTier={async (which, level) => {
            if (isNewEntity || !entityType) return
            const current: Record<string, number> =
              entity.variantAccessLevels && typeof entity.variantAccessLevels === 'object'
                ? { ...entity.variantAccessLevels }
                : {}
            if (level === 0) delete current[which]
            else current[which] = level
            const result = await patchEntityPublish(
              sdk,
              projectId,
              entityType,
              entityId!,
              { variantAccessLevels: current }
            )
            setEntity(prev => ({
              ...prev,
              variantAccessLevels: result.variantAccessLevels,
            }))
          }}
        />
      )}

      {/* Editor Content */}
      <div className="flex-1 overflow-auto p-8">
        <SdkProvider sdk={sdk} projectId={projectId}>
          <EntityNavProvider
            getLinkProps={(targetType, targetId) => ({
              href: '#',
              onClick: (e) => {
                e.preventDefault()
                if (typeof window === 'undefined') return
                window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
                  detail: {
                    entityType: targetType,
                    entityId: targetId,
                    bobbinId: 'entities',
                    metadata: { view: 'entity-editor' },
                  },
                }))
              },
            })}
          >
            <AliasesField
              entity={entity ?? {}}
              readonly={viewMode === 'view'}
              onChange={nextAliases => {
                setEntity(prev => ({ ...(prev ?? {}), aliases: nextAliases }))
                setSaveStatus('unsaved')
                setSaveError(false)
              }}
            />
            <LayoutRenderer
              layout={typeConfig.editorLayout}
              fields={typeConfig.customFields}
              entity={displayEntity}
              onFieldChange={handleFieldChange}
              readonly={viewMode === 'view'}
            />
          </EntityNavProvider>
        </SdkProvider>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AliasesField — alternate names that highlight to the same entity in chapter
// reading. Stored as `entityData.aliases: string[]`. Entity-level (not per-
// variant) since most aliases transcend a given moment (titles, nicknames).

function AliasesField({
  entity,
  readonly,
  onChange,
}: {
  entity: Record<string, any>
  readonly: boolean
  onChange: (next: string[]) => void
}) {
  const aliases: string[] = Array.isArray(entity.aliases) ? entity.aliases : []
  const [draft, setDraft] = useState('')

  function commitDraft() {
    const trimmed = draft.trim()
    if (!trimmed) return
    // Accept comma-separated batch input: "Strider, Wingfoot, Elessar"
    const parts = trimmed
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const existingLower = new Set(aliases.map(a => a.toLowerCase()))
    const additions = parts.filter(p => !existingLower.has(p.toLowerCase()))
    if (additions.length > 0) onChange([...aliases, ...additions])
    setDraft('')
  }

  function removeAlias(alias: string) {
    onChange(aliases.filter(a => a !== alias))
  }

  if (readonly && aliases.length === 0) return null

  return (
    <div className="mb-4 rounded-md border border-gray-200 bg-gray-50/60 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/40">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Aliases
        </span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          Alternate names that also highlight in chapters
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {aliases.map(alias => (
          <span
            key={alias}
            className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
          >
            {alias}
            {!readonly && (
              <button
                type="button"
                onClick={() => removeAlias(alias)}
                aria-label={`Remove alias ${alias}`}
                className="rounded-full px-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!readonly && (
          <input
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                commitDraft()
              }
            }}
            placeholder={aliases.length === 0 ? 'Add an alias…' : 'Add another…'}
            className="min-w-[10ch] flex-1 border-0 bg-transparent px-1 py-0.5 text-xs text-gray-800 placeholder:text-gray-400 focus:outline-none dark:text-gray-200 dark:placeholder:text-gray-500"
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// VariantManager — inline panel for adding / renaming / deleting / ordering /
// publishing variants. Kept inside this file since it's tightly coupled to the
// editor's state.

interface VariantManagerProps {
  entity: Record<string, any>
  axisKind: 'ordered' | 'unordered'
  axisLabel: string
  publishBase: boolean
  publishedVariantIds: string[]
  /** Per-variant minimum tier level (0 = inherit entity-level gate). */
  variantAccessLevels: Record<string, number>
  /** Author's subscription tiers, sorted by tierLevel asc. */
  tiers: SubscriptionTier[]
  /** Whether the publish checkboxes are meaningful. False for unsaved / unpublished entities. */
  isEntityPublished: boolean
  onAdd: (label: string) => void
  onRename: (id: string, label: string) => void
  onDelete: (id: string) => void
  onSetDefault: (id: string | null) => void
  onMove: (id: string, delta: -1 | 1) => void
  /** Called with '__base__' when toggling the Base row. */
  onToggleVariantPublish: (which: string | '__base__', next: boolean) => Promise<void> | void
  /** Called with '__base__' or a variant id + a new tier level (0 clears the override). */
  onChangeVariantTier: (which: string | '__base__', level: number) => Promise<void> | void
}

function VariantManager({
  entity,
  axisKind,
  axisLabel,
  publishBase,
  publishedVariantIds,
  variantAccessLevels,
  tiers,
  isEntityPublished,
  onAdd,
  onRename,
  onDelete,
  onSetDefault,
  onMove,
  onToggleVariantPublish,
  onChangeVariantTier,
}: VariantManagerProps) {
  const [newLabel, setNewLabel] = useState('')
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [publishError, setPublishError] = useState<string | null>(null)
  const variants = getVariants(entity)
  const ids = sortedVariantIds(entity, axisKind)
  const publishedSet = new Set(publishedVariantIds)

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

  async function togglePublish(which: string | '__base__', next: boolean) {
    setPublishError(null)
    // Compute what the effective selection will be to catch the "nothing
    // visible" case locally, mirroring the server-side validation.
    const nextBase = which === '__base__' ? next : publishBase
    const nextIds =
      which === '__base__'
        ? publishedVariantIds
        : next
          ? Array.from(new Set([...publishedVariantIds, which]))
          : publishedVariantIds.filter(x => x !== which)
    if (isEntityPublished && !nextBase && nextIds.length === 0) {
      setPublishError('Publishing requires the base or at least one variant to stay visible')
      return
    }
    try {
      await onToggleVariantPublish(which, next)
    } catch (err: any) {
      setPublishError(err?.message ?? 'Could not update publish state')
    }
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

      {publishError && (
        <p className="text-xs text-red-600 dark:text-red-400">{publishError}</p>
      )}

      {/* Base row — the un-overridden view of the entity. Publishable alongside
          variants so authors can, e.g., hide "base" and only publish specific
          forms like Human + Werewolf. */}
      <div className="flex flex-wrap items-center gap-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5">
        <PublishCheckbox
          checked={publishBase}
          disabled={!isEntityPublished}
          onChange={next => togglePublish('__base__', next)}
          title={
            isEntityPublished
              ? 'Show the base (shared) view on the reader'
              : 'Publish the entity to enable variant-level publishing'
          }
        />
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 flex-1 min-w-0 truncate">
          Base
        </span>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          Shared fields (shown when no variant is selected)
        </span>
        <VariantTierSelect
          level={variantAccessLevels['__base__'] ?? 0}
          tiers={tiers}
          disabled={!isEntityPublished || !publishBase}
          onChange={level => onChangeVariantTier('__base__', level)}
        />
      </div>

      {ids.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          No {axisLabel.toLowerCase()} variants yet. Add one above.
        </p>
      )}

      {ids.map((id, idx) => {
        const item = variants?.items[id]
        if (!item) return null
        const isDefault = variants?.active === id
        const isPublished = publishedSet.has(id)
        return (
          <div key={id} className="flex flex-wrap items-center gap-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5">
            <PublishCheckbox
              checked={isPublished}
              disabled={!isEntityPublished}
              onChange={next => togglePublish(id, next)}
              title={
                isEntityPublished
                  ? 'Show this variant on the reader'
                  : 'Publish the entity to enable variant-level publishing'
              }
            />
            {renamingId === id ? (
              <>
                <input
                  type="text"
                  value={renameDraft}
                  onChange={e => setRenameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(id) }}
                  autoFocus
                  className="flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-0.5 text-sm text-gray-900 dark:text-gray-100"
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
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => onMove(id, -1)}
                      disabled={idx === 0}
                      aria-label="Move up"
                      title="Move earlier"
                      className="h-5 w-5 flex items-center justify-center rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(id, 1)}
                      disabled={idx === ids.length - 1}
                      aria-label="Move down"
                      title="Move later"
                      className="h-5 w-5 flex items-center justify-center rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                )}
                <VariantTierSelect
                  level={variantAccessLevels[id] ?? 0}
                  tiers={tiers}
                  disabled={!isEntityPublished || !isPublished}
                  onChange={level => onChangeVariantTier(id, level)}
                />
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

function PublishCheckbox({
  checked,
  disabled,
  onChange,
  title,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  title?: string
}) {
  return (
    <label
      className={`flex items-center gap-1 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
      title={title}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-emerald-600"
      />
      <span className="text-[11px] text-gray-600 dark:text-gray-400">Publish</span>
    </label>
  )
}

function VariantTierSelect({
  level,
  tiers,
  disabled,
  onChange,
}: {
  level: number
  tiers: SubscriptionTier[]
  disabled?: boolean
  onChange: (level: number) => void
}) {
  if (tiers.length === 0) return null
  return (
    <label
      className={`flex items-center gap-1 text-[11px] ${disabled ? 'opacity-50' : ''}`}
      title={
        disabled
          ? 'Publish this view first to gate it by tier'
          : 'Minimum subscriber tier for this view (the whole-entity tier acts as a floor)'
      }
    >
      <span className="text-gray-500 dark:text-gray-400">Tier</span>
      <select
        value={level}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
        className="max-w-[8rem] rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-900 dark:text-gray-100 disabled:opacity-50"
      >
        <option value={0}>Public</option>
        {tiers.map(t => (
          <option key={t.id} value={t.tierLevel}>
            {`T${t.tierLevel} · ${t.name}`}
          </option>
        ))}
      </select>
    </label>
  )
}
