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

  const isNew = entityId === 'new' || metadata?.isNew

  useEffect(() => {
    if (isNew) {
      setRel({
        source_entity_id: '',
        target_entity_id: '',
        source_collection: '',
        target_collection: '',
        relationship_type: '',
        label: '',
        description: '',
        bidirectional: false,
        strength: 'moderate',
        color: null
      })
      setLoading(false)
    } else if (entityId) {
      loadRelationship()
    }
  }, [entityId])

  async function loadRelationship() {
    try {
      setLoading(true)
      setError(null)
      const res = await sdk.entities.get('relationships', entityId!)
      setRel(res as any)
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
        {/* Source */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Source Entity ID</label>
            <input
              type="text"
              value={rel.source_entity_id || ''}
              onChange={(e) => updateField('source_entity_id', e.target.value)}
              onBlur={() => !isNew && saveRelationship({ source_entity_id: rel.source_entity_id })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              placeholder="Entity ID..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Source Collection</label>
            <input
              type="text"
              value={rel.source_collection || ''}
              onChange={(e) => updateField('source_collection', e.target.value)}
              onBlur={() => !isNew && saveRelationship({ source_collection: rel.source_collection })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              placeholder="e.g., characters"
            />
          </div>
        </div>

        {/* Target */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target Entity ID</label>
            <input
              type="text"
              value={rel.target_entity_id || ''}
              onChange={(e) => updateField('target_entity_id', e.target.value)}
              onBlur={() => !isNew && saveRelationship({ target_entity_id: rel.target_entity_id })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              placeholder="Entity ID..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target Collection</label>
            <input
              type="text"
              value={rel.target_collection || ''}
              onChange={(e) => updateField('target_collection', e.target.value)}
              onBlur={() => !isNew && saveRelationship({ target_collection: rel.target_collection })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              placeholder="e.g., locations"
            />
          </div>
        </div>

        {/* Relationship Type & Label */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Relationship Type</label>
            <input
              type="text"
              value={rel.relationship_type || ''}
              onChange={(e) => updateField('relationship_type', e.target.value)}
              onBlur={() => !isNew && saveRelationship({ relationship_type: rel.relationship_type })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              placeholder="e.g., ally, enemy, located_in..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Label</label>
            <input
              type="text"
              value={rel.label || ''}
              onChange={(e) => updateField('label', e.target.value)}
              onBlur={() => !isNew && saveRelationship({ label: rel.label })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              placeholder="Display label..."
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
