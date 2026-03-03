'use client'

/**
 * Publish Manager Dashboard Panel
 *
 * Shown on the /publish page when a project is expanded.
 * Provides chapter-by-chapter publish status with toggle buttons,
 * publish all / unpublish all, and analytics preview.
 */

import { useState, useEffect, useCallback } from 'react'

interface PublishManagerPanelProps {
  projectId: string
  apiToken?: string
  context?: {
    projectId: string
    apiToken?: string
  }
}

interface Chapter {
  id: string
  entityData: {
    title?: string
    type?: string
    order?: number
    status?: string
  }
}

interface ChapterPublication {
  chapterId: string
  publishStatus: string
  publishedAt?: string
  viewCount?: number
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

async function apiFetchLocal(path: string, token: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  })
}

export default function PublishManagerPanel(props: PublishManagerPanelProps) {
  const projectId = props.projectId || props.context?.projectId
  const apiToken = props.apiToken || props.context?.apiToken

  const [chapters, setChapters] = useState<Chapter[]>([])
  const [publications, setPublications] = useState<Record<string, ChapterPublication>>({})
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadData = useCallback(async () => {
    if (!projectId || !apiToken) return
    setLoading(true)

    try {
      // Load chapters
      const chapRes = await apiFetchLocal(
        `/api/collections/content/entities?projectId=${projectId}`,
        apiToken
      )
      if (chapRes.ok) {
        const data = await chapRes.json()
        const chapterList = (data.entities || [])
          .filter((e: Chapter) => e.entityData?.type === 'chapter' || !e.entityData?.type)
          .sort((a: Chapter, b: Chapter) => (a.entityData?.order ?? 0) - (b.entityData?.order ?? 0))
        setChapters(chapterList)
      }

      // Load publication statuses
      const pubRes = await apiFetchLocal(
        `/api/projects/${projectId}/publications?status=all`,
        apiToken
      )
      if (pubRes.ok) {
        const data = await pubRes.json()
        const pubMap: Record<string, ChapterPublication> = {}
        for (const pub of (data.publications || [])) {
          pubMap[pub.chapterId] = pub
        }
        setPublications(pubMap)
      }
    } catch (err) {
      console.error('PublishManagerPanel: Failed to load data', err)
    } finally {
      setLoading(false)
    }
  }, [projectId, apiToken])

  useEffect(() => {
    loadData()
  }, [loadData])

  const publishChapter = async (chapterId: string) => {
    if (!projectId || !apiToken) return
    setActionInProgress(chapterId)
    try {
      await apiFetchLocal(
        `/api/projects/${projectId}/chapters/${chapterId}/publish`,
        apiToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publishStatus: 'published' }),
        }
      )
      await loadData()
    } catch {
      setMessage({ type: 'error', text: 'Failed to publish chapter' })
    } finally {
      setActionInProgress(null)
    }
  }

  const unpublishChapter = async (chapterId: string) => {
    if (!projectId || !apiToken) return
    setActionInProgress(chapterId)
    try {
      await apiFetchLocal(
        `/api/projects/${projectId}/chapters/${chapterId}/unpublish`,
        apiToken,
        { method: 'POST' }
      )
      await loadData()
    } catch {
      setMessage({ type: 'error', text: 'Failed to unpublish chapter' })
    } finally {
      setActionInProgress(null)
    }
  }

  const publishAll = async () => {
    if (!projectId || !apiToken || chapters.length === 0) return
    setActionInProgress('publish-all')
    setMessage(null)
    let successCount = 0
    try {
      for (const chapter of chapters) {
        try {
          const res = await apiFetchLocal(
            `/api/projects/${projectId}/chapters/${chapter.id}/publish`,
            apiToken,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ publishStatus: 'published' }),
            }
          )
          if (res.ok) successCount++
        } catch {}
      }
      setMessage({ type: 'success', text: `Published ${successCount} of ${chapters.length} chapters` })
      await loadData()
    } finally {
      setActionInProgress(null)
    }
  }

  const publishedCount = Object.values(publications).filter(p => p.publishStatus === 'published').length
  const totalViews = Object.values(publications).reduce((sum, p) => sum + (p.viewCount || 0), 0)

  if (loading) {
    return (
      <div className="px-5 py-4">
        <span className="text-xs text-gray-400 dark:text-gray-500">Loading publish manager...</span>
      </div>
    )
  }

  return (
    <div className="px-5 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Publish Manager
        </h4>
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span>{publishedCount}/{chapters.length} published</span>
          {totalViews > 0 && <span>{totalViews} total views</span>}
        </div>
      </div>

      {message && (
        <div className={`p-2 rounded text-xs ${
          message.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
        }`}>
          {message.text}
        </div>
      )}

      {chapters.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">
          No chapters found. Open the project editor to start writing.
        </p>
      ) : (
        <>
          {/* Bulk actions */}
          <div className="flex gap-2">
            <button
              onClick={publishAll}
              disabled={actionInProgress !== null}
              className="px-2.5 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors disabled:opacity-50 font-medium"
            >
              {actionInProgress === 'publish-all' ? 'Publishing...' : 'Publish All'}
            </button>
          </div>

          {/* Chapter list */}
          <div className="space-y-1">
            {chapters.map((chapter, idx) => {
              const pub = publications[chapter.id]
              const isPublished = pub?.publishStatus === 'published'
              const title = chapter.entityData?.title || `Chapter ${idx + 1}`
              const isLoading = actionInProgress === chapter.id

              return (
                <div key={chapter.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-gray-400 dark:text-gray-500 w-5 text-right flex-shrink-0">
                      {idx + 1}
                    </span>
                    <span className="text-xs text-gray-800 dark:text-gray-200 truncate">
                      {title}
                    </span>
                    {isPublished && (
                      <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-green-500" title="Published" />
                    )}
                  </div>
                  <button
                    onClick={() => isPublished ? unpublishChapter(chapter.id) : publishChapter(chapter.id)}
                    disabled={isLoading}
                    className={`text-xs px-2 py-0.5 rounded transition-colors disabled:opacity-50 flex-shrink-0 ${
                      isPublished
                        ? 'text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                        : 'text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20'
                    }`}
                  >
                    {isLoading ? '...' : isPublished ? 'Unpublish' : 'Publish'}
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
