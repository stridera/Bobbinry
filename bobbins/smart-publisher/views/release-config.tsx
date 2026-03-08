'use client'

/**
 * ReleaseConfig View
 *
 * Configure the smart publisher's release frequency,
 * per-tier delays, and automation settings.
 */

import { useState, useEffect } from 'react'
import { BobbinrySDK } from '@bobbinry/sdk'

interface TierDelay {
  tierLevel: number
  delayDays: number
}

interface PolicyConfig {
  release_frequency: string
  release_day: string
  release_time: string
  tier_delays: TierDelay[]
  max_queue_size: number
  auto_authorize: boolean
}

interface ReleaseConfigProps {
  sdk: BobbinrySDK
  projectId: string
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 Weeks' },
  { value: 'monthly', label: 'Monthly (1st)' }
]

export default function ReleaseConfig({ sdk, projectId }: ReleaseConfigProps) {
  const [policyId, setPolicyId] = useState<string | null>(null)
  const [config, setConfig] = useState<PolicyConfig>({
    release_frequency: 'weekly',
    release_day: 'Monday',
    release_time: '12:00',
    tier_delays: [],
    max_queue_size: 50,
    auto_authorize: false
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadPolicy()
  }, [projectId])

  const loadPolicy = async () => {
    setLoading(true)
    try {
      const result = await sdk.entities.query<any>({
        collection: 'ReleasePolicy',
        limit: 1
      })
      if (result.data.length > 0) {
        const entity = result.data[0]!
        const data = entity.entityData || entity
        setPolicyId(entity.id)
        setConfig({
          release_frequency: data.release_frequency || 'weekly',
          release_day: data.release_day || 'Monday',
          release_time: data.release_time || '12:00',
          tier_delays: data.tier_delays || [],
          max_queue_size: data.max_queue_size || 50,
          auto_authorize: data.auto_authorize || false
        })
      }
    } catch (err) {
      console.error('Failed to load policy:', err)
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      if (policyId) {
        await sdk.entities.update('ReleasePolicy', policyId, config)
      } else {
        const result = await sdk.entities.create('ReleasePolicy', config)
        setPolicyId((result as any).id || (result as any).entity?.id)
      }
      setMessage({ type: 'success', text: 'Release policy saved!' })
      setTimeout(() => setMessage(null), 3000)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  const addTierDelay = () => {
    const nextLevel = config.tier_delays.length > 0
      ? Math.max(...config.tier_delays.map(t => t.tierLevel)) + 1
      : 1
    setConfig({
      ...config,
      tier_delays: [...config.tier_delays, { tierLevel: nextLevel, delayDays: 7 }]
    })
  }

  const removeTierDelay = (index: number) => {
    setConfig({
      ...config,
      tier_delays: config.tier_delays.filter((_, i) => i !== index)
    })
  }

  const updateTierDelay = (index: number, field: 'tierLevel' | 'delayDays', value: number) => {
    const updated = [...config.tier_delays]
    updated[index] = { ...updated[index]!, [field]: value }
    setConfig({ ...config, tier_delays: updated })
  }

  if (loading) {
    return <div className="p-6 text-gray-500">Loading configuration...</div>
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">Release Settings</h2>

      {message && (
        <div className={`mb-4 p-3 rounded text-sm ${
          message.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      <div className="space-y-6">
        {/* Frequency */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Release Frequency
          </label>
          <div className="grid grid-cols-4 gap-2">
            {FREQUENCIES.map(f => (
              <button
                key={f.value}
                onClick={() => setConfig({ ...config, release_frequency: f.value })}
                className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                  config.release_frequency === f.value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900/30'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Day & Time */}
        <div className="grid grid-cols-2 gap-4">
          {(config.release_frequency === 'weekly' || config.release_frequency === 'biweekly') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Release Day</label>
              <select
                value={config.release_day}
                onChange={e => setConfig({ ...config, release_day: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
              >
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Release Time (UTC)</label>
            <input
              type="time"
              value={config.release_time}
              onChange={e => setConfig({ ...config, release_time: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
            />
          </div>
        </div>

        {/* Tier Delays */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Tier-Based Delays</label>
            <button
              onClick={addTierDelay}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              + Add Tier
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Higher tiers get content sooner. Tier 0 (free followers) gets content after all delays.
          </p>
          {config.tier_delays.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No tier delays - all content released immediately to everyone.</p>
          ) : (
            <div className="space-y-2">
              {config.tier_delays
                .sort((a, b) => b.tierLevel - a.tierLevel)
                .map((td, index) => (
                  <div key={index} className="flex items-center gap-3 text-sm">
                    <span className="text-gray-500 w-12">Tier</span>
                    <input
                      type="number"
                      min="1"
                      value={td.tierLevel}
                      onChange={e => updateTierDelay(index, 'tierLevel', parseInt(e.target.value) || 1)}
                      className="w-16 px-2 py-1 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded text-sm"
                    />
                    <span className="text-gray-500">waits</span>
                    <input
                      type="number"
                      min="0"
                      value={td.delayDays}
                      onChange={e => updateTierDelay(index, 'delayDays', parseInt(e.target.value) || 0)}
                      className="w-16 px-2 py-1 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded text-sm"
                    />
                    <span className="text-gray-500">days</span>
                    <button
                      onClick={() => removeTierDelay(index)}
                      className="text-red-500 hover:underline text-xs"
                    >
                      remove
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Options */}
        <div className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={config.auto_authorize}
              onChange={e => setConfig({ ...config, auto_authorize: e.target.checked })}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Auto-authorize chapters when added to the queue
            </span>
          </label>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max Queue Size</label>
            <input
              type="number"
              min="1"
              value={config.max_queue_size}
              onChange={e => setConfig({ ...config, max_queue_size: parseInt(e.target.value) || 50 })}
              className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
            />
          </div>
        </div>

        {/* Save */}
        <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={save}
            disabled={saving}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
