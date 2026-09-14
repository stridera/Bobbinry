'use client'

import { useState, useCallback, useEffect, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { OptimizedImage } from '@/components/OptimizedImage'
import { SearchReplaceLauncher } from '@/components/SearchReplaceLauncher'
import { StatusBadge } from '@/components/project/StatusBadge'

export interface MastheadStats {
  /** Sum of word_count across active narrative-type entities. */
  words: number
  /** Active narrative-type entities (chapter/scene/prologue/epilogue/interlude). */
  chapters: number
  /** Chapters whose publication is currently `published`. */
  published: number
  reads: number
  comments: number
  /** Open + acknowledged annotations, or null when feedback is disabled. */
  openFeedback: number | null
}

interface ProjectMastheadProps {
  projectId: string
  name: string
  description: string | null
  coverImage: string | null
  publishingMode: string
  projectVisibility?: string | undefined
  /** Public reader URL for the project, or null when it has none yet. */
  readerHref: string | null
  stats: MastheadStats
  onUpdate: (updates: { name?: string; description?: string | null; coverImage?: string | null }) => void
  /** Rendered flush with the bottom edge of the band — the project tab row. */
  children?: ReactNode
}

/**
 * Identity strip at the top of every project page: cover thumbnail, name,
 * description, status badges, the at-a-glance numbers, and the primary
 * actions. Replaces the old page header + 240px cover banner pair.
 */
export function ProjectMasthead({
  projectId,
  name,
  description,
  coverImage,
  publishingMode,
  projectVisibility,
  readerHref,
  stats,
  onUpdate,
  children,
}: ProjectMastheadProps) {
  const { data: session } = useSession()
  const apiToken = session?.apiToken
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(name)
  const [editDescription, setEditDescription] = useState(description || '')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [viewingCover, setViewingCover] = useState(false)

  const isLive = publishingMode === 'live'

  useEffect(() => {
    if (!viewingCover) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewingCover(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [viewingCover])

  const startEditing = () => {
    setEditName(name)
    setEditDescription(description || '')
    setEditing(true)
  }

  const handleSave = async () => {
    if (!editName.trim() || !apiToken) return
    setSaving(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}`, apiToken, {
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

  const handleUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/') || !apiToken) return
    setUploading(true)
    try {
      const presignRes = await apiFetch('/api/uploads/presign', apiToken, {
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
      if (!putRes.ok) {
        throw new Error(`Upload to storage failed (${putRes.status})`)
      }
      const confirmRes = await apiFetch('/api/uploads/confirm', apiToken, {
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
      await apiFetch(`/api/projects/${projectId}`, apiToken, {
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
  }, [apiToken, projectId, name, description, onUpdate])

  const handleRemoveCover = async () => {
    if (!apiToken) return
    try {
      await apiFetch(`/api/projects/${projectId}`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, coverImage: null })
      })
      onUpdate({ coverImage: null })
    } catch (err) {
      console.error('Failed to remove cover:', err)
    }
  }

  const statItems: Array<{ label: string; value: number; title?: string }> = [
    {
      label: 'words',
      value: stats.words,
      title: 'Words across all active chapters, scenes, prologues, epilogues, and interludes. Outlines and supporting docs are excluded.',
    },
    { label: stats.chapters === 1 ? 'chapter' : 'chapters', value: stats.chapters },
    { label: 'published', value: stats.published },
  ]
  if (isLive) {
    statItems.push({ label: 'reads', value: stats.reads, title: 'Total chapter views' })
    statItems.push({ label: 'comments', value: stats.comments })
    if (stats.openFeedback !== null) {
      statItems.push({ label: 'open feedback', value: stats.openFeedback, title: 'Reader annotations awaiting a response' })
    }
  }

  return (
    <>
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
          <Link href="/dashboard" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors">Projects</Link>
          <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-gray-700 dark:text-gray-200 truncate">{name}</span>
        </div>

        <div className="mt-3 flex items-start gap-4 sm:gap-5">
          {/* Cover thumbnail — a book cover, not a banner */}
          <div
            className="group relative shrink-0 w-[68px] h-[100px] sm:w-20 sm:h-[118px] rounded-md overflow-hidden shadow-sm ring-1 ring-black/10 dark:ring-white/10 bg-gray-100 dark:bg-gray-700"
            onDrop={(e) => {
              e.preventDefault()
              const file = e.dataTransfer.files[0]
              if (file) handleUpload(file)
            }}
            onDragOver={(e) => e.preventDefault()}
          >
            {coverImage ? (
              <button
                type="button"
                onClick={() => setViewingCover(true)}
                className="block w-full h-full cursor-zoom-in"
                title="View cover"
              >
                <OptimizedImage
                  src={coverImage}
                  variant="thumb"
                  alt="Project cover"
                  className="w-full h-full object-cover"
                />
              </button>
            ) : (
              <label
                className="flex w-full h-full items-center justify-center bg-gradient-to-br from-teal-500/80 via-teal-600/60 to-amber-500/40 dark:from-teal-700/80 dark:via-teal-800/60 dark:to-amber-700/40 cursor-pointer"
                title="Add a cover image"
              >
                <span className="font-display text-3xl font-bold text-white/90 select-none">
                  {name.charAt(0).toUpperCase()}
                </span>
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
            )}

            {/* Hover controls */}
            <div className={`absolute inset-x-0 bottom-0 flex divide-x divide-white/20 bg-black/60 backdrop-blur-sm text-[11px] font-medium text-white transition-opacity ${uploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
              {uploading ? (
                <span className="flex-1 py-1 text-center">Uploading…</span>
              ) : (
                <>
                  <label className="flex-1 py-1 text-center hover:bg-white/15 cursor-pointer">
                    {coverImage ? 'Change' : 'Add'}
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
                  {coverImage && (
                    <button
                      type="button"
                      onClick={handleRemoveCover}
                      className="flex-1 py-1 text-center hover:bg-red-600/70 cursor-pointer"
                      title="Remove cover"
                    >
                      Remove
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Identity + actions */}
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="space-y-3 max-w-2xl">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
                  className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100 bg-transparent border-b-2 border-gray-300 dark:border-gray-600 focus:border-blue-500 outline-none w-full"
                  placeholder="Project name"
                  autoFocus
                />
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 outline-none resize-y text-sm"
                  placeholder="Add a description for your project..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={saving || !editName.trim()}
                    className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg disabled:opacity-50 font-medium transition-colors cursor-pointer"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-6">
                <div className="min-w-0 sm:flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <h1
                      className="font-display text-2xl sm:text-[28px] leading-tight font-bold text-gray-900 dark:text-gray-100 cursor-text hover:underline decoration-gray-300 dark:decoration-gray-600 underline-offset-4 break-words"
                      onClick={startEditing}
                      title="Click to edit"
                    >
                      {name}
                    </h1>
                    <StatusBadge isLive={isLive} visibility={projectVisibility} />
                  </div>
                  <p
                    className={`mt-1 text-sm cursor-text max-w-2xl ${description ? 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200' : 'text-gray-400 dark:text-gray-500 italic hover:text-gray-600 dark:hover:text-gray-300'} transition-colors`}
                    onClick={startEditing}
                    title="Click to edit"
                  >
                    {description || 'Add a description…'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <SearchReplaceLauncher projectId={projectId} apiToken={apiToken} defaultScope="project" iconOnly />
                  {isLive && readerHref && (
                    <Link
                      href={readerHref}
                      className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg font-medium text-sm transition-colors"
                    >
                      Reader page
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </Link>
                  )}
                  <Link
                    href={`/publish/${projectId}`}
                    className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg font-medium text-sm transition-colors"
                  >
                    Publisher
                  </Link>
                  <Link
                    href={`/projects/${projectId}/write`}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg font-medium text-sm transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Write
                  </Link>
                </div>
              </div>
            )}

            {!editing && (
              <dl className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
                {statItems.map(item => (
                  <div key={item.label} className="flex items-baseline gap-1.5" title={item.title}>
                    <dd className="font-display text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100 leading-none">
                      {item.value.toLocaleString()}
                    </dd>
                    <dt className="text-xs text-gray-500 dark:text-gray-400">{item.label}</dt>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>

        {children}
      </div>
    </header>

    {/* Cover lightbox — kept outside any animated container, which would trap fixed positioning */}
    {coverImage && (
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm transition-opacity duration-300 ${viewingCover ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setViewingCover(false)}
      >
        <button
          onClick={() => setViewingCover(false)}
          className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors cursor-pointer"
          aria-label="Close"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <OptimizedImage
          src={coverImage}
          variant="medium"
          alt="Project cover"
          className={`max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl transition-transform duration-300 ${viewingCover ? 'scale-100' : 'scale-95'}`}
        />
      </div>
    )}
    </>
  )
}
