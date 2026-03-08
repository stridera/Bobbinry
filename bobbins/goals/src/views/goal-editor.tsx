import { useState, useEffect, useCallback } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

interface GoalEditorViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityId?: string
  metadata?: Record<string, any>
}

const GOAL_TYPES = [
  { value: 'daily', label: 'Daily' },
  { value: 'session', label: 'Session' },
  { value: 'project', label: 'Project' },
  { value: 'custom', label: 'Custom' },
]

const GOAL_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'paused', label: 'Paused' },
  { value: 'failed', label: 'Failed' },
]

export default function GoalEditorView({
  sdk,
  projectId,
  entityId,
  metadata,
}: GoalEditorViewProps) {
  const [goal, setGoal] = useState<Record<string, any> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved')
  const [error, setError] = useState<string | null>(null)

  const isNew = entityId === 'new' || metadata?.isNew

  useEffect(() => {
    if (isNew) {
      setGoal({
        name: '',
        type: 'project',
        target_count: 50000,
        current_count: 0,
        start_date: new Date().toISOString().split('T')[0],
        end_date: '',
        status: 'active'
      })
      setLoading(false)
    } else if (entityId) {
      loadGoal()
    }
  }, [entityId])

  async function loadGoal() {
    try {
      setLoading(true)
      setError(null)
      const res = await sdk.entities.get('goals', entityId!)
      setGoal(res as any)
    } catch (err: any) {
      console.error('[GoalEditor] Failed to load:', err)
      setError(err.message || 'Failed to load goal')
    } finally {
      setLoading(false)
    }
  }

  const saveGoal = useCallback(async (updates?: Record<string, any>) => {
    if (!goal) return
    try {
      setSaveStatus('saving')
      const data = { ...goal, ...updates, updated_at: new Date().toISOString() }

      if (isNew) {
        const created = await sdk.entities.create('goals', {
          ...data,
          created_at: new Date().toISOString()
        }) as any
        // Navigate to saved goal
        window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
          detail: {
            entityType: 'goals',
            entityId: created.id,
            bobbinId: 'goals',
            metadata: { view: 'goal-editor' }
          }
        }))
      } else {
        await sdk.entities.update('goals', entityId!, data)
        if (updates) setGoal(prev => prev ? { ...prev, ...updates } : prev)
      }
      setSaveStatus('saved')
    } catch (err) {
      console.error('[GoalEditor] Failed to save:', err)
      setSaveStatus('unsaved')
    }
  }, [goal, entityId, isNew, sdk])

  function updateField(field: string, value: any) {
    setGoal(prev => prev ? { ...prev, [field]: value } : prev)
    setSaveStatus('unsaved')
  }

  function goBack() {
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'goals',
        entityId: 'dashboard',
        bobbinId: 'goals',
        metadata: { view: 'dashboard' }
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

  if (error || !goal) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="max-w-md p-6 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
          <p className="text-red-600 dark:text-red-400">{error || 'Goal not found'}</p>
        </div>
      </div>
    )
  }

  const progress = goal.target_count > 0
    ? Math.min(100, Math.round(((goal.current_count || 0) / goal.target_count) * 100))
    : 0

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
              ← Dashboard
            </button>
            <span className="text-xs text-gray-400">
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'unsaved' ? 'Unsaved' : 'Saved'}
            </span>
          </div>
          <button
            onClick={() => saveGoal()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
          >
            {isNew ? 'Create Goal' : 'Save'}
          </button>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-auto p-6 max-w-2xl mx-auto w-full space-y-6">
        {/* Progress Preview */}
        {!isNew && (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Progress</span>
              <span className="text-sm text-gray-500">
                {(goal.current_count || 0).toLocaleString()} / {(goal.target_count || 0).toLocaleString()}
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4">
              <div
                className="bg-blue-600 dark:bg-blue-500 h-4 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-right mt-1">
              <span className="text-sm font-medium text-blue-600 dark:text-blue-400">{progress}%</span>
            </div>
          </div>
        )}

        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Goal Name</label>
          <input
            type="text"
            value={goal.name || ''}
            onChange={(e) => updateField('name', e.target.value)}
            onBlur={() => !isNew && saveGoal({ name: goal.name })}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            placeholder="e.g., NaNoWriMo 2026"
          />
        </div>

        {/* Type & Status */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
            <select
              value={goal.type || 'custom'}
              onChange={(e) => {
                updateField('type', e.target.value)
                if (!isNew) saveGoal({ type: e.target.value })
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              {GOAL_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
            <select
              value={goal.status || 'active'}
              onChange={(e) => {
                updateField('status', e.target.value)
                if (!isNew) saveGoal({ status: e.target.value })
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              {GOAL_STATUSES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Target & Current Count */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Target (words)</label>
            <input
              type="number"
              value={goal.target_count || 0}
              onChange={(e) => updateField('target_count', parseInt(e.target.value) || 0)}
              onBlur={() => !isNew && saveGoal({ target_count: goal.target_count })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Current Count</label>
            <input
              type="number"
              value={goal.current_count || 0}
              onChange={(e) => updateField('current_count', parseInt(e.target.value) || 0)}
              onBlur={() => !isNew && saveGoal({ current_count: goal.current_count })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>

        {/* Date Range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date</label>
            <input
              type="date"
              value={goal.start_date?.split('T')[0] || ''}
              onChange={(e) => {
                updateField('start_date', e.target.value)
                if (!isNew) saveGoal({ start_date: e.target.value })
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date</label>
            <input
              type="date"
              value={goal.end_date?.split('T')[0] || ''}
              onChange={(e) => {
                updateField('end_date', e.target.value)
                if (!isNew) saveGoal({ end_date: e.target.value })
              }}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
