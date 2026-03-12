'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  PanelCard,
  PanelEmptyState,
  PanelLoadingState,
  PanelMessage,
  PanelPill,
  PanelSectionTitle,
} from '@bobbinry/sdk'
import { apiFetchLocal } from '../lib/api'
import { formatDateTime } from '../lib/time'

interface ScheduledReleasesPanelProps {
  projectId: string
  apiToken?: string
  refreshKey?: number
  context?: {
    projectId: string
    apiToken?: string
    refreshKey?: number
  }
}

interface ChapterEntity {
  id: string
  title?: string
}

interface ChapterPublication {
  chapterId: string
  publishStatus: string
  publishedAt?: string
}

interface ScheduledReleaseItem {
  chapterId: string
  chapterTitle: string
  scheduledFor: string
}

export default function ScheduledReleasesPanel(props: ScheduledReleasesPanelProps) {
  const projectId = props.projectId || props.context?.projectId
  const apiToken = props.apiToken || props.context?.apiToken
  const refreshKey = props.refreshKey ?? props.context?.refreshKey ?? 0

  const [items, setItems] = useState<ScheduledReleaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadScheduledReleases = useCallback(async () => {
    if (!projectId || !apiToken) return
    setLoading(true)

    try {
      setError(null)

      const [publicationsRes, chaptersRes] = await Promise.all([
        apiFetchLocal(`/api/projects/${projectId}/publications?status=all`, apiToken),
        apiFetchLocal(`/api/collections/content/entities?projectId=${projectId}&limit=500`, apiToken),
      ])

      const chapterEntities: ChapterEntity[] = chaptersRes.ok ? ((await chaptersRes.json()).entities || []) : []
      const chapterPublications: ChapterPublication[] = publicationsRes.ok ? ((await publicationsRes.json()).publications || []) : []
      const chapterTitles = new Map(chapterEntities.map((chapter) => [chapter.id, chapter.title || 'Untitled chapter']))

      const scheduledItems: ScheduledReleaseItem[] = chapterPublications
        .filter((publication) => publication.publishStatus === 'scheduled')
        .filter((publication) => !!publication.publishedAt)
        .map((publication) => ({
          chapterId: publication.chapterId,
          chapterTitle: chapterTitles.get(publication.chapterId) || 'Untitled chapter',
          scheduledFor: publication.publishedAt!,
        }))
        .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())

      setItems(scheduledItems)
    } catch (err) {
      console.error('ScheduledReleasesPanel: Failed to load scheduled releases', err)
      setError('Failed to load scheduled releases.')
    } finally {
      setLoading(false)
    }
  }, [projectId, apiToken])

  useEffect(() => {
    void loadScheduledReleases()
  }, [loadScheduledReleases, refreshKey])

  if (loading) {
    return (
      <div className="px-5 py-4">
        <PanelLoadingState label="Loading scheduled releases..." />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="px-5 py-4">
        {error ? <PanelMessage tone="error">{error}</PanelMessage> : null}
        <PanelEmptyState
          title="Scheduled releases"
          description="No chapters are currently scheduled for future release."
        />
      </div>
    )
  }

  const nextUp = items[0]

  return (
    <div className="space-y-3 px-5 py-4">
      {error ? <PanelMessage tone="error">{error}</PanelMessage> : null}

      <div className="flex items-center justify-between">
        <PanelSectionTitle>Scheduled releases</PanelSectionTitle>
        <div className="flex items-center gap-2 text-[11px]">
          <PanelPill className="bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
            {items.length} scheduled
          </PanelPill>
        </div>
      </div>

      {nextUp ? (
        <PanelCard className="flex items-center gap-3 border-blue-100 bg-blue-50/50 dark:border-blue-800/30 dark:bg-blue-900/10">
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-blue-100 dark:bg-blue-900/30">
            <svg className="h-3 w-3 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-700 dark:text-gray-300">
              <span className="font-medium">Next release:</span>{' '}
              <span className="truncate">{nextUp.chapterTitle}</span>
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {formatDateTime(nextUp.scheduledFor, 'local')}
            </p>
          </div>
        </PanelCard>
      ) : null}

      <div className="space-y-0.5">
        {items.slice(1).map((item, index) => (
          <div
            key={`${item.chapterId}:${item.scheduledFor}`}
            className="group flex items-center gap-3 rounded px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
          >
            <span className="w-4 flex-shrink-0 text-right text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
              {index + 2}
            </span>
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-xs text-gray-800 dark:text-gray-200">
                {item.chapterTitle}
              </span>
              <span className="block text-[10px] text-gray-400 dark:text-gray-500">
                {formatDateTime(item.scheduledFor, 'local')}
              </span>
            </div>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              Scheduled
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
