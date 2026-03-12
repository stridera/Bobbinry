'use client'

/**
 * Chapter Publish Panel
 *
 * Right-sidebar panel showing per-chapter publish status and actions.
 * Replaces the hardcoded shell PublishPanel.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  PanelActions,
  PanelActionButton,
  PanelBody,
  PanelCard,
  PanelEmptyState,
  PanelFrame,
  PanelLoadingState,
  PanelMessage,
  PanelPill,
  PanelSectionTitle,
} from '@bobbinry/sdk'

interface ChapterPublishProps {
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

export default function ChapterPublishPanel(props: ChapterPublishProps) {
  const projectId = props.projectId || props.context?.projectId
  const apiToken = props.apiToken || props.context?.apiToken
  const entityId = props.entityId || props.context?.entityId

  const [publication, setPublication] = useState<ChapterPublication | null>(null)
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!projectId || !apiToken) return
    setLoading(true)

    try {
      setError(null)
      const projRes = await apiFetchLocal(`/api/projects/${projectId}`, apiToken)
      if (projRes.ok) {
        const data = await projRes.json()
        const project = data.project
        let ownerUsername: string | null = null
        if (project?.ownerId) {
          try {
            const profileRes = await fetch(`${API_URL}/api/users/${project.ownerId}/profile`)
            if (profileRes.ok) {
              const profileData = await profileRes.json()
              ownerUsername = profileData.profile?.username || null
            }
          } catch {}
        }
        setProjectInfo({ shortUrl: project?.shortUrl || null, ownerId: project?.ownerId || null, ownerUsername })
      }

      if (entityId) {
        try {
          const pubRes = await apiFetchLocal(
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
      console.error('ChapterPublishPanel: Failed to load data', err)
      setError('Failed to load publishing status')
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
      await apiFetchLocal(
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
      await apiFetchLocal(
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
    <PanelFrame>
      <PanelActions>
        <a
          href="/publish"
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          Dashboard
        </a>
      </PanelActions>

      <PanelBody className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <PanelSectionTitle>Chapter Status</PanelSectionTitle>
          {isProjectPublished ? <PanelPill className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">Live</PanelPill> : null}
        </div>

        {loading ? (
          <PanelLoadingState label="Loading publish status…" />
        ) : !isProjectPublished ? (
          <PanelEmptyState
            title="Project is not published"
            description="Enable publishing from the dashboard before you publish individual chapters."
            action={
              <a
                href="/publish"
                className="inline-flex items-center gap-1 rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                Open dashboard
              </a>
            }
          />
        ) : (
          <>
            {error ? <PanelMessage tone="error">{error}</PanelMessage> : null}
            <div className="space-y-2">
              <PanelSectionTitle>Chapter Status</PanelSectionTitle>
              {entityId ? (
                <PanelCard className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Selected chapter</span>
                    <PanelPill className={isPublished ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : ''}>
                      {isPublished ? 'Published' : 'Draft'}
                    </PanelPill>
                  </div>

                  {publication?.publishedAt ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Published {new Date(publication.publishedAt).toLocaleDateString()}
                    </p>
                  ) : null}

                  {publication?.viewCount !== undefined && publication.viewCount > 0 ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {publication.viewCount} view{publication.viewCount !== 1 ? 's' : ''}
                    </p>
                  ) : null}

                  {isPublished ? (
                    <PanelActionButton tone="danger" onClick={unpublishChapter} disabled={actionInProgress} className="w-full">
                      {actionInProgress ? 'Updating…' : 'Unpublish Chapter'}
                    </PanelActionButton>
                  ) : (
                    <PanelActionButton tone="primary" onClick={publishChapter} disabled={actionInProgress} className="w-full">
                      {actionInProgress ? 'Publishing…' : 'Publish Chapter'}
                    </PanelActionButton>
                  )}
                </PanelCard>
              ) : (
                <PanelEmptyState
                  title="No chapter selected"
                  description="Select a chapter in the manuscript to manage its publish status here."
                />
              )}
            </div>
          </>
        )}
      </PanelBody>
    </PanelFrame>
  )
}
