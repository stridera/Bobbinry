'use client'

import { useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'

interface DashboardHeroProps {
  projectId: string
  name: string
  description: string | null
  coverImage: string | null
  readerUrl: string | null
  onUpdate: (updates: { name?: string; description?: string | null; coverImage?: string | null }) => void
}

export function DashboardHero({ projectId, name, description, coverImage, readerUrl, onUpdate }: DashboardHeroProps) {
  const { data: session } = useSession()
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(name)
  const [editDescription, setEditDescription] = useState(description || '')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  const hasChanges = editName !== name || editDescription !== (description || '')

  const handleSave = async () => {
    if (!editName.trim() || !session?.apiToken) return
    setSaving(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}`, session.apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
          coverImage
        })
      })
      if (response.ok) {
        onUpdate({ name: editName.trim(), description: editDescription.trim() || null })
        setEditing(false)
      }
    } catch (err) {
      console.error('Failed to save:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleCancelEdit = () => {
    setEditName(name)
    setEditDescription(description || '')
    setEditing(false)
  }

  const handleUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/') || !session?.apiToken) return
    setUploading(true)
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
      await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
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

      // Also persist to project
      await apiFetch(`/api/projects/${projectId}`, session.apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, coverImage: url })
      })
      onUpdate({ coverImage: url })
    } catch (err) {
      console.error('Cover upload failed:', err)
    } finally {
      setUploading(false)
    }
  }, [session?.apiToken, projectId, name, description, onUpdate])

  const handleRemoveCover = async () => {
    if (!session?.apiToken) return
    try {
      await apiFetch(`/api/projects/${projectId}`, session.apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, coverImage: null })
      })
      onUpdate({ coverImage: null })
    } catch (err) {
      console.error('Failed to remove cover:', err)
    }
  }

  return (
    <div className="relative rounded-xl overflow-hidden shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in">
      {/* Cover image area */}
      <div
        className="relative h-60 w-full"
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files[0]
          if (file) handleUpload(file)
        }}
        onDragOver={(e) => e.preventDefault()}
      >
        {coverImage ? (
          <>
            <img
              src={coverImage}
              alt="Project cover"
              className="w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          </>
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-teal-500/80 via-teal-600/60 to-amber-500/40 dark:from-teal-700/80 dark:via-teal-800/60 dark:to-amber-700/40">
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          </div>
        )}

        {/* Cover image controls */}
        <div className="absolute top-3 right-3 flex gap-2">
          {coverImage && (
            <button
              onClick={handleRemoveCover}
              className="px-3 py-1.5 bg-red-600/90 hover:bg-red-700 text-white text-xs rounded-lg backdrop-blur-sm transition-colors cursor-pointer"
            >
              Remove Cover
            </button>
          )}
          <label className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs rounded-lg backdrop-blur-sm transition-colors cursor-pointer">
            {uploading ? 'Uploading...' : coverImage ? 'Change Cover' : 'Add Cover'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleUpload(file)
                e.target.value = ''
              }}
            />
          </label>
        </div>

        {/* Title overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-6">
          {editing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="font-display text-3xl font-bold text-white bg-transparent border-b-2 border-white/50 focus:border-white outline-none w-full placeholder-white/50"
              placeholder="Project name"
              autoFocus
            />
          ) : (
            <div className="flex items-end justify-between gap-4">
              <h1
                className="font-display text-3xl font-bold text-white cursor-pointer hover:underline decoration-white/40"
                onClick={() => setEditing(true)}
                title="Click to edit"
              >
                {name}
              </h1>
              {readerUrl && (
                <Link
                  href={readerUrl}
                  className="flex-shrink-0 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs rounded-lg backdrop-blur-sm transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View Reader Page
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Description area */}
      <div className="bg-white dark:bg-gray-800 p-6">
        {editing ? (
          <div className="space-y-3">
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none resize-y text-sm"
              placeholder="Add a description for your project..."
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleCancelEdit}
                className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editName.trim()}
                className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg disabled:opacity-50 font-medium transition-colors cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        ) : (
          <p
            className="text-gray-600 dark:text-gray-400 text-sm cursor-pointer hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
            onClick={() => setEditing(true)}
            title="Click to edit"
          >
            {description || 'Click to add a description...'}
          </p>
        )}
      </div>
    </div>
  )
}
