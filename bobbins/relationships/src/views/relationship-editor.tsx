import { useState, useEffect, useCallback } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

interface RelationshipEditorViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityId?: string
  metadata?: Record<string, any>
}

const STRENGTH_OPTIONS = [
  { value: 'weak', label: 'Weak' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'strong', label: 'Strong' },
]

interface EntityType { type_id: string; label: string; icon?: string }
interface PickEntity { id: string; name: string }

export default function RelationshipEditorView({
  sdk,
  projectId,
  entityId,
  metadata,
}: RelationshipEditorViewProps) {
  const [rel, setRel] = useState<Record<string, any> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved')
  const [error, setError] = useState<string | null>(null)

  // Entity types defined by the user (via the entities bobbin). Drives both
  // picker dropdowns. Empty means the user hasn't defined any types yet.
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([])
  // Cache of entities loaded per type, keyed by type_id. Populated lazily
  // when the user picks a type, plus eagerly for source/target on edit.
  const [entitiesByType, setEntitiesByType] = useState<Record<string, PickEntity[]>>({})
  // Distinct relationship_type values already in use — fed into the combobox.
  const [knownRelTypes, setKnownRelTypes] = useState<string[]>([])

  const isNew = entityId === 'new' || metadata?.isNew

  useEffect(() => {
    loadEntityTypes()
    loadKnownRelTypes()
  }, [])

  useEffect(() => {
    if (isNew) {
      // metadata.prefill comes from the matrix view's click-to-create on an
      // empty cell — gives us source/target pairs without forcing the user to
      // re-pick from the dropdowns.
      const prefill = metadata?.prefill as
        | { sourceId?: string; sourceCollection?: string; targetId?: string; targetCollection?: string }
        | undefined
      setRel({
        source_entity_id: prefill?.sourceId || '',
        target_entity_id: prefill?.targetId || '',
        source_collection: prefill?.sourceCollection || '',
        target_collection: prefill?.targetCollection || '',
        relationship_type: '',
        label: '',
        description: '',
        bidirectional: true, // Most user-level relationships read as mutual (friend, located_in, ally). Easier to uncheck than remember to check.
        strength: 'moderate',
        color: null
      })
      // Warm the entity dropdowns so the prefilled source/target render with names.
      if (prefill?.sourceCollection) ensureEntitiesLoaded(prefill.sourceCollection)
      if (prefill?.targetCollection) ensureEntitiesLoaded(prefill.targetCollection)
      setLoading(false)
    } else if (entityId) {
      loadRelationship()
    }
  }, [entityId])

  async function loadEntityTypes() {
    try {
      const res = await sdk.entities.query({ collection: 'entity_type_definitions', limit: 1000 })
      const types = ((res.data as any[]) || [])
        .map(t => ({
          type_id: t.type_id || t.typeId,
          label: t.label || t.type_id || t.typeId,
          icon: t.icon
        }))
        .filter(t => t.type_id)
        .sort((a, b) => a.label.localeCompare(b.label))
      setEntityTypes(types)
    } catch (err) {
      console.error('[RelEditor] Failed to load entity types:', err)
    }
  }

  async function loadKnownRelTypes() {
    try {
      const res = await sdk.entities.query({ collection: 'relationships', limit: 1000 })
      const seen = new Set<string>()
      for (const r of (res.data as any[]) || []) {
        if (r.relationship_type) seen.add(r.relationship_type)
      }
      setKnownRelTypes([...seen].sort())
    } catch (err) {
      console.error('[RelEditor] Failed to load known relationship types:', err)
    }
  }

  async function ensureEntitiesLoaded(typeId: string) {
    if (!typeId || entitiesByType[typeId]) return
    try {
      const res = await sdk.entities.query({ collection: typeId, limit: 1000 })
      const list: PickEntity[] = ((res.data as any[]) || [])
        .map(e => ({ id: e.id, name: e.name || e.title || e.id }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setEntitiesByType(prev => ({ ...prev, [typeId]: list }))
    } catch (err) {
      console.error(`[RelEditor] Failed to load entities for type ${typeId}:`, err)
      setEntitiesByType(prev => ({ ...prev, [typeId]: [] }))
    }
  }

  async function loadRelationship() {
    try {
      setLoading(true)
      setError(null)
      const res = await sdk.entities.get('relationships', entityId!) as any
      if (!res) {
        // Stale link, deleted relationship, or sentinel id (e.g. 'graph',
        // 'matrix') from the relationships panel — send the user to the
        // graph view which has a proper empty state + create CTA.
        window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
          detail: {
            entityType: 'relationships',
            entityId: 'graph',
            bobbinId: 'relationships',
            metadata: { view: 'graph' }
          }
        }))
        return
      }
      setRel(res)
      // Warm the pickers so the saved entities resolve to their names instead
      // of just bare ids on first render.
      if (res.source_collection) ensureEntitiesLoaded(res.source_collection)
      if (res.target_collection) ensureEntitiesLoaded(res.target_collection)
    } catch (err: any) {
      console.error('[RelEditor] Failed to load:', err)
      setError(err.message || 'Failed to load relationship')
    } finally {
      setLoading(false)
    }
  }

  const saveRelationship = useCallback(async (updates?: Record<string, any>) => {
    if (!rel) return
    try {
      setSaveStatus('saving')
      const data: Record<string, any> = { ...rel, ...updates, updated_at: new Date().toISOString() }

      if (isNew) {
        if (!data.source_entity_id || !data.target_entity_id || !data.relationship_type) {
          setError('Source, target, and relationship type are required')
          setSaveStatus('unsaved')
          return
        }
        const created = await sdk.entities.create('relationships', {
          ...data,
          created_at: new Date().toISOString()
        }) as any
        window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
          detail: {
            entityType: 'relationships',
            entityId: created.id,
            bobbinId: 'relationships',
            metadata: { view: 'relationship-editor' }
          }
        }))
      } else {
        await sdk.entities.update('relationships', entityId!, data)
        if (updates) setRel(prev => prev ? { ...prev, ...updates } : prev)
      }
      setError(null)
      setSaveStatus('saved')
    } catch (err) {
      console.error('[RelEditor] Failed to save:', err)
      setSaveStatus('unsaved')
    }
  }, [rel, entityId, isNew, sdk])

  function updateField(field: string, value: any) {
    setRel(prev => prev ? { ...prev, [field]: value } : prev)
    setSaveStatus('unsaved')
  }

  // Picking a new type wipes the previously-chosen entity on that side —
  // the old id no longer belongs to the new collection.
  function pickType(side: 'source' | 'target', typeId: string) {
    ensureEntitiesLoaded(typeId)
    const updates = {
      [`${side}_collection`]: typeId,
      [`${side}_entity_id`]: ''
    }
    setRel(prev => prev ? { ...prev, ...updates } : prev)
    setSaveStatus('unsaved')
    if (!isNew) saveRelationship(updates)
  }

  function pickEntity(side: 'source' | 'target', id: string) {
    const field = `${side}_entity_id`
    updateField(field, id)
    if (!isNew) saveRelationship({ [field]: id })
  }

  function goBack() {
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'relationships',
        entityId: 'graph',
        bobbinId: 'relationships',
        metadata: { view: 'graph' }
      }
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  if (!rel) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="max-w-md p-6 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
          <p className="text-red-600 dark:text-red-400">{error || 'Relationship not found'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={goBack}
              className="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              ← Back
            </button>
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {isNew ? 'New Relationship' : 'Edit Relationship'}
            </h1>
            <span className="text-xs text-gray-400">
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'unsaved' ? 'Unsaved' : 'Saved'}
            </span>
          </div>
          <button
            onClick={() => saveRelationship()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
          >
            {isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Form */}
      <div className="flex-1 overflow-auto p-6 max-w-2xl mx-auto w-full space-y-6">
        {/* No entity types? Direct the user where to create them. */}
        {entityTypes.length === 0 && (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg text-sm text-amber-800 dark:text-amber-200">
            No entity types defined yet. Create entity types (e.g. Characters, Places) in the Entities workspace before adding relationships.
          </div>
        )}

        {/* Source / Target pickers — one row per side, type then entity */}
        {(['source', 'target'] as const).map(side => {
          const collection = rel[`${side}_collection`] || ''
          const entityIdValue = rel[`${side}_entity_id`] || ''
          const entityList = collection ? entitiesByType[collection] : undefined
          const entityKnown = !entityIdValue || entityList?.some(e => e.id === entityIdValue)
          const sideLabel = side === 'source' ? 'Source' : 'Target'

          return (
            <div key={side} className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{sideLabel} Type</label>
                <select
                  value={collection}
                  onChange={(e) => pickType(side, e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  disabled={entityTypes.length === 0}
                >
                  <option value="">Choose type…</option>
                  {entityTypes.map(t => (
                    <option key={t.type_id} value={t.type_id}>
                      {t.icon ? `${t.icon} ${t.label}` : t.label}
                    </option>
                  ))}
                  {/* Preserve unknown legacy values so editing old data doesn't silently drop the field */}
                  {collection && !entityTypes.some(t => t.type_id === collection) && (
                    <option value={collection}>{collection} (unknown type)</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{sideLabel} Entity</label>
                <select
                  value={entityIdValue}
                  onChange={(e) => pickEntity(side, e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  disabled={!collection || entityList === undefined}
                >
                  <option value="">
                    {!collection
                      ? 'Pick a type first'
                      : entityList === undefined
                        ? 'Loading…'
                        : entityList.length === 0
                          ? `No entities of this type yet`
                          : 'Choose entity…'}
                  </option>
                  {entityList?.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                  {entityIdValue && !entityKnown && (
                    <option value={entityIdValue}>Unknown ({entityIdValue.slice(0, 8)}…)</option>
                  )}
                </select>
              </div>
            </div>
          )
        })}

        {/* Relationship Type & Label */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Relationship Type</label>
            <input
              type="text"
              list="rel-type-suggestions"
              value={rel.relationship_type || ''}
              onChange={(e) => updateField('relationship_type', e.target.value)}
              onBlur={() => !isNew && saveRelationship({ relationship_type: rel.relationship_type })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              placeholder="e.g., ally, enemy, located_in…"
            />
            <datalist id="rel-type-suggestions">
              {knownRelTypes.map(t => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Used to group/filter the graph and matrix. Reuse existing names for consistency.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Label</label>
            <input
              type="text"
              value={rel.label || ''}
              onChange={(e) => updateField('label', e.target.value)}
              onBlur={() => !isNew && saveRelationship({ label: rel.label })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              placeholder="Display label…"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
          <textarea
            value={rel.description || ''}
            onChange={(e) => updateField('description', e.target.value)}
            onBlur={() => !isNew && saveRelationship({ description: rel.description })}
            rows={4}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-y"
            placeholder="Describe this relationship..."
          />
        </div>

        {/* Bidirectional & Strength */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Strength</label>
            <select
              value={rel.strength || 'moderate'}
              onChange={(e) => {
                updateField('strength', e.target.value)
                if (!isNew) saveRelationship({ strength: e.target.value })
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              {STRENGTH_OPTIONS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={rel.bidirectional || false}
                onChange={(e) => {
                  updateField('bidirectional', e.target.checked)
                  if (!isNew) saveRelationship({ bidirectional: e.target.checked })
                }}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Bidirectional</span>
            </label>
          </div>
        </div>

        {/* Color */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Color</label>
          <div className="flex gap-2 flex-wrap">
            {[null, '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'].map((color, i) => (
              <button
                key={i}
                onClick={() => {
                  updateField('color', color)
                  if (!isNew) saveRelationship({ color })
                }}
                className={`w-8 h-8 rounded-full border-2 ${rel.color === color ? 'border-white ring-2 ring-blue-500' : 'border-gray-300 dark:border-gray-600'}`}
                style={{ backgroundColor: color || '#6b7280' }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
