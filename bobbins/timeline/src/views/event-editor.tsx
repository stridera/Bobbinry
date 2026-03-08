import { useState, useEffect, useCallback } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

interface EventEditorViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityId?: string
  metadata?: Record<string, any>
}

export default function EventEditorView({
  sdk,
  projectId,
  entityId,
  metadata,
}: EventEditorViewProps) {
  const [event, setEvent] = useState<Record<string, any> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved')
  const [error, setError] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')

  useEffect(() => {
    if (entityId) {
      loadEvent()
    }
  }, [entityId])

  async function loadEvent() {
    try {
      setLoading(true)
      setError(null)
      const res = await sdk.entities.get('timeline_events', entityId!)
      setEvent(res as any)
    } catch (err: any) {
      console.error('[EventEditor] Failed to load:', err)
      setError(err.message || 'Failed to load event')
    } finally {
      setLoading(false)
    }
  }

  const saveEvent = useCallback(async (updates: Record<string, any>) => {
    if (!entityId || !event) return
    try {
      setSaveStatus('saving')
      await sdk.entities.update('timeline_events', entityId, {
        ...updates,
        updated_at: new Date().toISOString()
      })
      setEvent(prev => prev ? { ...prev, ...updates } : prev)
      setSaveStatus('saved')
      window.dispatchEvent(new CustomEvent('bobbinry:entity-updated', {
        detail: { entityId, changes: updates }
      }))
    } catch (err) {
      console.error('[EventEditor] Failed to save:', err)
      setSaveStatus('unsaved')
    }
  }, [entityId, event, sdk])

  function updateField(field: string, value: any) {
    setEvent(prev => prev ? { ...prev, [field]: value } : prev)
    setSaveStatus('unsaved')
  }

  function handleAddTag() {
    const tag = tagInput.trim()
    if (!tag || !event) return
    const tags = [...(event.tags || []), tag]
    setTagInput('')
    setEvent(prev => prev ? { ...prev, tags } : prev)
    saveEvent({ tags })
  }

  function handleRemoveTag(tag: string) {
    if (!event) return
    const tags = (event.tags || []).filter((t: string) => t !== tag)
    setEvent(prev => prev ? { ...prev, tags } : prev)
    saveEvent({ tags })
  }

  function goBack() {
    const timelineId = metadata?.timelineId || event?.timeline_id
    if (timelineId) {
      window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
        detail: {
          entityType: 'timelines',
          entityId: timelineId,
          bobbinId: 'timeline',
          metadata: { view: 'timeline', timelineId }
        }
      }))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  if (error || !event) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="max-w-md p-6 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
          <p className="text-red-600 dark:text-red-400">{error || 'Event not found'}</p>
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
            <span className="text-xs text-gray-400">
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'unsaved' ? 'Unsaved' : 'Saved'}
            </span>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-auto p-6 max-w-2xl mx-auto w-full space-y-6">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
          <input
            type="text"
            value={event.title || ''}
            onChange={(e) => updateField('title', e.target.value)}
            onBlur={() => saveEvent({ title: event.title })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            placeholder="Event title..."
          />
        </div>

        {/* Date Label & Sort Order */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date Label</label>
            <input
              type="text"
              value={event.date_label || ''}
              onChange={(e) => updateField('date_label', e.target.value)}
              onBlur={() => saveEvent({ date_label: event.date_label })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              placeholder="e.g., Year 1, Chapter 3..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sort Order</label>
            <input
              type="number"
              value={event.sort_order || 0}
              onChange={(e) => updateField('sort_order', parseInt(e.target.value) || 0)}
              onBlur={() => saveEvent({ sort_order: event.sort_order })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>

        {/* Duration */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Duration Label</label>
          <input
            type="text"
            value={event.duration_label || ''}
            onChange={(e) => updateField('duration_label', e.target.value)}
            onBlur={() => saveEvent({ duration_label: event.duration_label })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            placeholder="e.g., 3 days, 1 hour..."
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
          <textarea
            value={event.description || ''}
            onChange={(e) => updateField('description', e.target.value)}
            onBlur={() => saveEvent({ description: event.description })}
            rows={6}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-y"
            placeholder="Describe this event..."
          />
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tags</label>
          <div className="flex flex-wrap gap-1 mb-2">
            {(event.tags || []).map((tag: string, i: number) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs"
              >
                {tag}
                <button onClick={() => handleRemoveTag(tag)} className="text-gray-400 hover:text-red-500">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag() }}
              placeholder="Add tag..."
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
            <button
              onClick={handleAddTag}
              className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
            >
              +
            </button>
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
                  saveEvent({ color })
                }}
                className={`w-8 h-8 rounded-full border-2 ${event.color === color ? 'border-white ring-2 ring-blue-500' : 'border-gray-300 dark:border-gray-600'}`}
                style={{ backgroundColor: color || '#6b7280' }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
