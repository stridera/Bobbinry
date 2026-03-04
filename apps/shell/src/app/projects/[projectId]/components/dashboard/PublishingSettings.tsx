'use client'

import { useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'
import { OptimizedImage } from '@/components/OptimizedImage'

function HelpTip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex ml-1 align-middle">
      <span className="w-3.5 h-3.5 inline-flex items-center justify-center rounded-full border border-gray-300 dark:border-gray-500 text-gray-400 dark:text-gray-500 text-[9px] font-bold cursor-help leading-none">?</span>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-52 px-2.5 py-1.5 rounded-md bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs leading-snug opacity-0 group-hover:opacity-100 transition-opacity z-10 text-center shadow-lg">
        {text}
      </span>
    </span>
  )
}

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
  const [uploadingOg, setUploadingOg] = useState(false)

  const handleOgUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/') || !session?.apiToken) return
    setUploadingOg(true)
    try {
      const presignRes = await apiFetch('/api/uploads/presign', session.apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size, context: 'cover', projectId })
      })
      if (!presignRes.ok) {
        const errBody = await presignRes.json().catch(() => ({}))
        throw new Error(errBody.error || `Presign failed (${presignRes.status})`)
      }
      const { uploadUrl, fileKey } = await presignRes.json()
      const putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`)
      const confirmRes = await apiFetch('/api/uploads/confirm', session.apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey, filename: file.name, contentType: file.type, size: file.size, context: 'cover', projectId })
      })
      if (!confirmRes.ok) {
        const errBody = await confirmRes.json().catch(() => ({}))
        throw new Error(errBody.error || `Confirm failed (${confirmRes.status})`)
      }
      const { url } = await confirmRes.json()
      setDraft(d => ({ ...d, ogImageUrl: url }))
    } catch (err) {
      console.error('OG image upload failed:', err)
    } finally {
      setUploadingOg(false)
    }
  }, [session?.apiToken, projectId])

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
                  <p className="text-gray-500 dark:text-gray-400">Publishing Mode<HelpTip text="Whether your project is listed on the platform. Draft = only you can see it, Scheduled = goes live on a date, Live = published and discoverable." /></p>
                  <p className="text-gray-900 dark:text-gray-100 font-medium capitalize">{config.publishingMode}</p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Default Visibility<HelpTip text="Who can read new chapters by default. Public = everyone, Subscribers Only = paying supporters, Private = only you." /></p>
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
                    <p className="text-gray-500 dark:text-gray-400">SEO Description<HelpTip text="A short summary shown in search engine results like Google. Helps readers find your work." /></p>
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
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Publishing Mode<HelpTip text="Whether your project is listed on the platform. Draft = only you can see it, Scheduled = goes live on a date, Live = published and discoverable." /></label>
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
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Default Visibility<HelpTip text="Who can read new chapters by default. Public = everyone, Subscribers Only = paying supporters, Private = only you." /></label>
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
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">SEO Description<HelpTip text="A short summary shown in search engine results like Google. Helps readers find your work." /></label>
                <textarea
                  value={draft.seoDescription || ''}
                  onChange={(e) => setDraft({ ...draft, seoDescription: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/40 outline-none resize-y"
                  placeholder="Description for search engines..."
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">OG Image<HelpTip text="The preview image shown when your project is shared on social media (Facebook, Twitter, Discord, etc.)." /></label>
                {draft.ogImageUrl ? (
                  <div className="space-y-2">
                    <div className="relative w-full max-w-sm h-32 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700">
                      <OptimizedImage
                        src={draft.ogImageUrl}
                        variant="medium"
                        alt="OG preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex gap-3">
                      <label className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors cursor-pointer">
                        {uploadingOg ? 'Uploading...' : 'Change Image'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          className="hidden"
                          disabled={uploadingOg}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handleOgUpload(file)
                            e.target.value = ''
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, ogImageUrl: '' })}
                        className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="flex items-center justify-center w-full max-w-sm h-24 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-gray-400 dark:hover:border-gray-500 transition-colors cursor-pointer bg-gray-50 dark:bg-gray-900/50">
                    <div className="text-center">
                      <svg className="w-6 h-6 mx-auto text-gray-400 dark:text-gray-500 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {uploadingOg ? 'Uploading...' : 'Upload OG Image'}
                      </span>
                    </div>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      disabled={uploadingOg}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleOgUpload(file)
                        e.target.value = ''
                      }}
                    />
                  </label>
                )}
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
