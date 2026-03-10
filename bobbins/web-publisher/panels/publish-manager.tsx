'use client'

/**
 * Publish Manager Dashboard Panel
 *
 * Compact publishing stats summary shown on the /publish page.
 * The chapter-level management is handled by the built-in PublishDashboard chapter list.
 * This panel provides aggregate stats and quick bulk actions.
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

interface ChapterPublication {
  chapterId: string
  publishStatus: string
  publishedAt?: string
  viewCount?: number
  uniqueViewCount?: number
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

  const [publications, setPublications] = useState<ChapterPublication[]>([])
  const [totalChapters, setTotalChapters] = useState(0)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    if (!projectId || !apiToken) return
    setLoading(true)

    try {
      const [chapRes, pubRes] = await Promise.all([
        apiFetchLocal(`/api/collections/content/entities?projectId=${projectId}`, apiToken),
        apiFetchLocal(`/api/projects/${projectId}/publications?status=all`, apiToken),
      ])

      if (chapRes.ok) {
        const data = await chapRes.json()
        setTotalChapters((data.entities || []).length)
      }

      if (pubRes.ok) {
        const data = await pubRes.json()
        setPublications(data.publications || [])
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

  const publishedPubs = publications.filter(p => p.publishStatus === 'published')
  const publishedCount = publishedPubs.length
  const totalViews = publications.reduce((sum, p) => sum + (p.viewCount || 0), 0)
  const uniqueViews = publications.reduce((sum, p) => sum + (p.uniqueViewCount || 0), 0)
  const lastPublished = publishedPubs
    .filter(p => p.publishedAt)
    .sort((a, b) => new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime())[0]

  if (loading) {
    return (
      <div className="px-5 py-3">
        <div className="h-4 w-32 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
      </div>
    )
  }

  if (totalChapters === 0) return null

  if (publishedCount === 0) {
    return (
      <div className="px-5 py-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          No chapters published yet. Use the controls above to publish your chapters.
        </p>
      </div>
    )
  }

  return (
    <div className="px-5 py-3">
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
          <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            <span className="font-medium text-gray-700 dark:text-gray-300">{publishedCount}</span>/{totalChapters} published
          </span>
        </div>

        {totalViews > 0 && (
          <>
            <span className="text-gray-300 dark:text-gray-700">|</span>
            <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span>
                <span className="font-medium text-gray-700 dark:text-gray-300">{totalViews.toLocaleString()}</span> view{totalViews !== 1 ? 's' : ''}
                {uniqueViews > 0 && uniqueViews !== totalViews && (
                  <span className="text-gray-400 dark:text-gray-500"> ({uniqueViews.toLocaleString()} unique)</span>
                )}
              </span>
            </div>
          </>
        )}

        {lastPublished?.publishedAt && (
          <>
            <span className="text-gray-300 dark:text-gray-700">|</span>
            <span className="text-gray-500 dark:text-gray-400">
              Last published {new Date(lastPublished.publishedAt).toLocaleDateString()}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
