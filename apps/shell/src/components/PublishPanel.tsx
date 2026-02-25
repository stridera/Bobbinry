'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { config } from '@/lib/config'

interface PublishPanelProps {
  projectId: string
  apiToken?: string
  entityId?: string
  entityType?: string
  context?: {
    projectId: string
    apiToken?: string
    entityId?: string
    entityType?: string
  }
}

interface ChapterPublication {
  chapterId: string
  publishStatus: string
  publishedAt?: string
  viewCount?: number
}

interface ProjectInfo {
  shortUrl: string | null
  ownerId: string | null
  ownerUsername: string | null
}

export function PublishPanel(props: PublishPanelProps) {
  const projectId = props.projectId || props.context?.projectId
  const apiToken = props.apiToken || props.context?.apiToken
  const entityId = props.entityId || props.context?.entityId

  const [publication, setPublication] = useState<ChapterPublication | null>(null)
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState(false)

  const loadData = useCallback(async () => {
    if (!projectId || !apiToken) return
    setLoading(true)

    try {
      // Load project info for shortUrl and owner username
      const projRes = await apiFetch(`/api/projects/${projectId}`, apiToken)
      if (projRes.ok) {
        const data = await projRes.json()
        const project = data.project
        let ownerUsername: string | null = null
        if (project?.ownerId) {
          try {
            const profileRes = await fetch(`${config.apiUrl}/api/users/${project.ownerId}/profile`)
            if (profileRes.ok) {
              const profileData = await profileRes.json()
              ownerUsername = profileData.profile?.username || null
            }
          } catch {}
        }
        setProjectInfo({ shortUrl: project?.shortUrl || null, ownerId: project?.ownerId || null, ownerUsername })
      }

      // Load chapter publication status if we have an entity selected
      if (entityId) {
        try {
          const pubRes = await apiFetch(
            `/api/projects/${projectId}/chapters/${entityId}/publication`,
            apiToken
          )
          if (pubRes.ok) {
            const data = await pubRes.json()
            setPublication(data.publication || null)
          } else {
            setPublication(null)
          }
        } catch {
          setPublication(null)
        }
      }
    } catch (err) {
      console.error('PublishPanel: Failed to load data', err)
    } finally {
      setLoading(false)
    }
  }, [projectId, apiToken, entityId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const publishChapter = async () => {
    if (!projectId || !apiToken || !entityId) return
    setActionInProgress(true)
    try {
      await apiFetch(
        `/api/projects/${projectId}/chapters/${entityId}/publish`,
        apiToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publishStatus: 'published' }),
        }
      )
      await loadData()
    } catch (err) {
      console.error('Failed to publish chapter', err)
    } finally {
      setActionInProgress(false)
    }
  }

  const unpublishChapter = async () => {
    if (!projectId || !apiToken || !entityId) return
    setActionInProgress(true)
    try {
      await apiFetch(
        `/api/projects/${projectId}/chapters/${entityId}/unpublish`,
        apiToken,
        { method: 'POST' }
      )
      await loadData()
    } catch (err) {
      console.error('Failed to unpublish chapter', err)
    } finally {
      setActionInProgress(false)
    }
  }

  const isProjectPublished = !!projectInfo?.shortUrl
  const isPublished = publication?.publishStatus === 'published'

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Publishing
        </h3>
        <Link
          href="/publish"
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          Dashboard
        </Link>
      </div>

      {loading ? (
        <div className="py-4 text-center">
          <span className="text-xs text-gray-400 dark:text-gray-500">Loading...</span>
        </div>
      ) : !isProjectPublished ? (
        <div className="space-y-3">
          <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              This project is not published yet. Enable publishing from the Publisher Dashboard first.
            </p>
            <Link
              href="/publish"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              Go to Publisher Dashboard
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Project status */}
          <div className="flex items-center gap-2 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-gray-600 dark:text-gray-400">Project is live at</span>
            <Link
              href={`/read/${projectInfo.ownerUsername || projectInfo.ownerId}/${projectInfo.shortUrl}`}
              className="text-blue-600 dark:text-blue-400 hover:underline font-mono truncate"
            >
              /read/{projectInfo.ownerUsername || projectInfo.ownerId}/{projectInfo.shortUrl}
            </Link>
          </div>

          {/* Chapter publish status */}
          {entityId ? (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <div className="px-3 py-2.5 bg-gray-50 dark:bg-gray-800/50">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    Chapter Status
                  </span>
                  {isPublished ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      Published
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                      Draft
                    </span>
                  )}
                </div>
              </div>

              <div className="px-3 py-3">
                {isPublished ? (
                  <div className="space-y-2">
                    {publication?.publishedAt && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Published {new Date(publication.publishedAt).toLocaleDateString()}
                      </p>
                    )}
                    {publication?.viewCount !== undefined && publication.viewCount > 0 && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {publication.viewCount} view{publication.viewCount !== 1 ? 's' : ''}
                      </p>
                    )}
                    <button
                      onClick={unpublishChapter}
                      disabled={actionInProgress}
                      className="w-full px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors disabled:opacity-50"
                    >
                      {actionInProgress ? 'Updating...' : 'Unpublish Chapter'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={publishChapter}
                    disabled={actionInProgress}
                    className="w-full px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 transition-colors disabled:opacity-50"
                  >
                    {actionInProgress ? 'Publishing...' : 'Publish Chapter'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Select a chapter to manage its publish status.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
