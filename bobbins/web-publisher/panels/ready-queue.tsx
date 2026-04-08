'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  PanelActionButton,
  PanelCard,
  PanelEmptyState,
  PanelLoadingState,
  PanelMessage,
  PanelSectionTitle,
} from '@bobbinry/sdk'
import { apiFetchLocal } from '../lib/api'

interface ReadyQueuePanelProps {
  projectId: string
  apiToken?: string
  refreshKey?: number
  onAction?: () => void
  context?: {
    projectId: string
    apiToken?: string
    refreshKey?: number
    onAction?: () => void
  }
}

interface ChapterEntity {
  id: string
  title?: string
  order?: number
}

interface ChapterPublication {
  chapterId: string
  publishStatus: string
}

interface ReadyChapter {
  id: string
  title: string
  order: number
}

export default function ReadyQueuePanel(props: ReadyQueuePanelProps) {
  const projectId = props.projectId || props.context?.projectId
  const apiToken = props.apiToken || props.context?.apiToken
  const refreshKey = props.refreshKey ?? props.context?.refreshKey ?? 0
  const onAction = props.onAction || props.context?.onAction

  const [chapters, setChapters] = useState<ReadyChapter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [schedulingChapterId, setSchedulingChapterId] = useState<string | null>(null)
  const [scheduledDate, setScheduledDate] = useState('')
  const [autoReleaseEnabled, setAutoReleaseEnabled] = useState(false)

  const loadData = useCallback(async () => {
    if (!projectId || !apiToken) return
    setLoading(true)

    try {
      setError(null)

      const [chapRes, pubRes, configRes] = await Promise.all([
        apiFetchLocal(`/api/collections/content/entities?projectId=${projectId}&limit=500`, apiToken),
        apiFetchLocal(`/api/projects/${projectId}/publications?status=all`, apiToken),
        apiFetchLocal(`/api/projects/${projectId}/publish-config`, apiToken),
      ])

      let entities: ChapterEntity[] = []
      let publications: ChapterPublication[] = []

      if (chapRes.ok) {
        const data = await chapRes.json()
        entities = data.entities || []
      }
      if (pubRes.ok) {
        const data = await pubRes.json()
        publications = data.publications || []
      }
      if (configRes.ok) {
        const data = await configRes.json()
        setAutoReleaseEnabled(data.config?.autoReleaseEnabled ?? false)
      }

      const completePubs = new Set(
        publications
          .filter((p) => p.publishStatus === 'complete')
          .map((p) => p.chapterId)
      )

      const ready: ReadyChapter[] = entities
        .filter((e) => completePubs.has(e.id))
        .map((e, idx) => ({
          id: e.id,
          title: e.title || `Chapter ${idx + 1}`,
          order: e.order ?? idx,
        }))
        .sort((a, b) => a.order - b.order)

      setChapters(ready)
    } catch (err) {
      console.error('ReadyQueuePanel: Failed to load data', err)
      setError('Failed to load ready chapters.')
    } finally {
      setLoading(false)
    }
  }, [projectId, apiToken])

  useEffect(() => {
    void loadData()
  }, [loadData, refreshKey])

  const publishChapter = async (chapterId: string) => {
    if (!projectId || !apiToken) return
    setActionInProgress(chapterId)
    try {
      const res = await apiFetchLocal(
        `/api/projects/${projectId}/chapters/${chapterId}/publish`,
        apiToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publishStatus: 'published' }),
        }
      )
      if (res.ok) {
        setChapters((prev) => prev.filter((c) => c.id !== chapterId))
        onAction?.()
      } else {
        setError('Failed to publish chapter.')
      }
    } catch {
      setError('Failed to publish chapter.')
    } finally {
      setActionInProgress(null)
    }
  }

  const scheduleChapter = async (chapterId: string) => {
    if (!projectId || !apiToken || !scheduledDate) return
    setActionInProgress(chapterId)
    try {
      const res = await apiFetchLocal(
        `/api/projects/${projectId}/chapters/${chapterId}/publish`,
        apiToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            publishStatus: 'scheduled',
            scheduledFor: new Date(scheduledDate).toISOString(),
          }),
        }
      )
      if (res.ok) {
        setChapters((prev) => prev.filter((c) => c.id !== chapterId))
        setSchedulingChapterId(null)
        setScheduledDate('')
        onAction?.()
      } else {
        setError('Failed to schedule chapter.')
      }
    } catch {
      setError('Failed to schedule chapter.')
    } finally {
      setActionInProgress(null)
    }
  }

  if (loading) {
    return (
      <div className="px-5 py-4">
        <PanelLoadingState label="Loading ready chapters..." />
      </div>
    )
  }

  if (chapters.length === 0) {
    return (
      <div className="px-5 py-4">
        {error ? <PanelMessage tone="error">{error}</PanelMessage> : null}
        <PanelEmptyState
          title="No chapters ready"
          description="Mark chapters as ready from the project dashboard to see them here."
        />
      </div>
    )
  }

  return (
    <div className="space-y-3 px-5 py-4">
      {error ? <PanelMessage tone="error">{error}</PanelMessage> : null}

      <div className="flex items-center justify-between">
        <PanelSectionTitle>Ready to publish</PanelSectionTitle>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {chapters.length} chapter{chapters.length !== 1 ? 's' : ''}
        </span>
      </div>

      {autoReleaseEnabled && (
        <PanelCard className="border-blue-100 bg-blue-50/50 dark:border-blue-800/30 dark:bg-blue-900/10">
          <p className="text-[11px] text-blue-700 dark:text-blue-300">
            Auto-scheduling is active. New ready chapters are automatically assigned to the next release slot.
          </p>
        </PanelCard>
      )}

      <div className="space-y-1">
        {chapters.map((chapter, idx) => {
          const isLoading = actionInProgress === chapter.id
          const isScheduling = schedulingChapterId === chapter.id

          return (
            <div key={chapter.id} className="space-y-0">
              <div className="group flex items-center gap-3 rounded border-l-2 border-blue-400 py-2 pl-3 pr-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <span className="w-4 flex-shrink-0 text-right text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-gray-800 dark:text-gray-200">
                    {chapter.title}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => {
                      if (isScheduling) {
                        setSchedulingChapterId(null)
                        setScheduledDate('')
                      } else {
                        setSchedulingChapterId(chapter.id)
                      }
                    }}
                    disabled={isLoading}
                    className="rounded px-2 py-1 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                  >
                    {isScheduling ? 'Cancel' : 'Schedule'}
                  </button>
                  <button
                    onClick={() => publishChapter(chapter.id)}
                    disabled={isLoading}
                    className="rounded px-2 py-1 text-[11px] font-medium text-green-600 transition-colors hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-900/20"
                  >
                    {isLoading ? '...' : 'Publish Now'}
                  </button>
                </div>
              </div>

              {isScheduling && (
                <div className="ml-8 flex items-center gap-2 py-2">
                  <input
                    type="datetime-local"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                  <PanelActionButton
                    onClick={() => scheduleChapter(chapter.id)}
                    disabled={!scheduledDate || isLoading}
                  >
                    {isLoading ? '...' : 'Confirm'}
                  </PanelActionButton>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
