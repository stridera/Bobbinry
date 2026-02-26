'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'

interface PublishConfig {
  projectId: string
  publishingMode: string
  defaultVisibility: string
  autoReleaseEnabled: boolean
  releaseFrequency: string
  releaseDay?: string
  releaseTime?: string
  slugPrefix?: string
  seoDescription?: string
  ogImageUrl?: string
  enableComments: boolean
  enableReactions: boolean
  moderationMode: string
}

interface PublishingSettingsProps {
  projectId: string
  config: PublishConfig
  onUpdate: (config: PublishConfig) => void
}

export function PublishingSettings({ projectId, config, onUpdate }: PublishingSettingsProps) {
  const { data: session } = useSession()
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(config)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!session?.apiToken) return
    setSaving(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/publish-config`, session.apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publishingMode: draft.publishingMode,
          defaultVisibility: draft.defaultVisibility,
          seoDescription: draft.seoDescription || null,
          ogImageUrl: draft.ogImageUrl || null,
          enableComments: draft.enableComments,
          enableReactions: draft.enableReactions,
          moderationMode: draft.moderationMode
        })
      })
      if (response.ok) {
        const data = await response.json()
        onUpdate(data.config || draft)
        setEditing(false)
      }
    } catch (err) {
      console.error('Failed to save publish config:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-6 cursor-pointer"
      >
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Publishing Settings</h2>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-6 pb-6 border-t border-gray-100 dark:border-gray-700 pt-4">
          {!editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Publishing Mode</p>
                  <p className="text-gray-900 dark:text-gray-100 font-medium capitalize">{config.publishingMode}</p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Default Visibility</p>
                  <p className="text-gray-900 dark:text-gray-100 font-medium capitalize">{config.defaultVisibility.replace('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Comments</p>
                  <p className="text-gray-900 dark:text-gray-100 font-medium">{config.enableComments ? 'Enabled' : 'Disabled'}</p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Reactions</p>
                  <p className="text-gray-900 dark:text-gray-100 font-medium">{config.enableReactions ? 'Enabled' : 'Disabled'}</p>
                </div>
                {config.seoDescription && (
                  <div className="col-span-2">
                    <p className="text-gray-500 dark:text-gray-400">SEO Description</p>
                    <p className="text-gray-900 dark:text-gray-100 text-sm">{config.seoDescription}</p>
                  </div>
                )}
              </div>
              <button
                onClick={() => { setDraft(config); setEditing(true) }}
                className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors cursor-pointer"
              >
                Edit Settings
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Publishing Mode</label>
                  <select
                    value={draft.publishingMode}
                    onChange={(e) => setDraft({ ...draft, publishingMode: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/40 outline-none"
                  >
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="live">Live</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Default Visibility</label>
                  <select
                    value={draft.defaultVisibility}
                    onChange={(e) => setDraft({ ...draft, defaultVisibility: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/40 outline-none"
                  >
                    <option value="public">Public</option>
                    <option value="subscribers_only">Subscribers Only</option>
                    <option value="private">Private</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">SEO Description</label>
                <textarea
                  value={draft.seoDescription || ''}
                  onChange={(e) => setDraft({ ...draft, seoDescription: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/40 outline-none resize-y"
                  placeholder="Description for search engines..."
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">OG Image URL</label>
                <input
                  type="text"
                  value={draft.ogImageUrl || ''}
                  onChange={(e) => setDraft({ ...draft, ogImageUrl: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/40 outline-none"
                  placeholder="https://..."
                />
              </div>

              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enableComments}
                    onChange={(e) => setDraft({ ...draft, enableComments: e.target.checked })}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  Enable Comments
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.enableReactions}
                    onChange={(e) => setDraft({ ...draft, enableReactions: e.target.checked })}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  Enable Reactions
                </label>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setEditing(false)}
                  className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
