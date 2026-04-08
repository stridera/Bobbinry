'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api'

interface ChapterReleaseTableProps {
  projectId: string
  apiToken: string
  readerBaseUrl: string | null
  autoReleaseEnabled: boolean
  refreshKey: number
  onRefresh: () => void
}

interface ChapterEntity {
  id: string
  title?: string
  order?: number
}

interface ChapterPublication {
  chapterId: string
  publishStatus: string
  publishedAt?: string
  viewCount?: number
  uniqueViewCount?: number
  completionCount?: number
}

interface ChapterRow {
  id: string
  title: string
  order: number
  status: string
  publishedAt?: string | undefined
  viewCount: number
}

type StatusFilter = 'all' | 'draft' | 'complete' | 'scheduled' | 'published'

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  complete: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  scheduled: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  published: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  archived: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

const STATUS_LABELS: Record<string, string> = {
  complete: 'ready',
}

const ROW_TINTS: Record<string, string> = {
  complete: 'bg-blue-50/30 dark:bg-blue-950/10',
  scheduled: 'bg-amber-50/30 dark:bg-amber-950/10',
  published: 'bg-green-50/20 dark:bg-green-950/10',
}

const FILTER_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'complete', label: 'Ready' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' },
]

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/* ── Main component ── */
export function ChapterReleaseTable({
  projectId,
  apiToken,
  readerBaseUrl,
  autoReleaseEnabled,
  refreshKey,
  onRefresh,
}: ChapterReleaseTableProps) {
  const [chapters, setChapters] = useState<ChapterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [schedulingChapterId, setSchedulingChapterId] = useState<string | null>(null)
  const [scheduledDate, setScheduledDate] = useState('')
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      setError(null)
      const [chapRes, pubRes] = await Promise.all([
        apiFetch(`/api/collections/content/entities?projectId=${projectId}&limit=500`, apiToken),
        apiFetch(`/api/projects/${projectId}/publications?status=all`, apiToken),
      ])

      let entities: ChapterEntity[] = []
      let publications: ChapterPublication[] = []

      if (chapRes.ok) {
        const data = await chapRes.json()
        entities = (data.entities || []).sort(
          (a: ChapterEntity, b: ChapterEntity) => (a.order ?? 0) - (b.order ?? 0)
        )
      }
      if (pubRes.ok) {
        const data = await pubRes.json()
        publications = data.publications || []
      }

      const pubMap = new Map(publications.map((p) => [p.chapterId, p]))
      const merged: ChapterRow[] = entities.map((e, idx) => {
        const pub = pubMap.get(e.id)
        return {
          id: e.id,
          title: e.title || `Chapter ${idx + 1}`,
          order: e.order ?? idx,
          status: pub?.publishStatus || 'draft',
          publishedAt: pub?.publishedAt,
          viewCount: Number(pub?.viewCount || 0),
        }
      })

      setChapters(merged)
    } catch (err) {
      console.error('ChapterReleaseTable: Failed to load data', err)
      setError('Failed to load chapters.')
    } finally {
      setLoading(false)
    }
  }, [projectId, apiToken])

  useEffect(() => {
    void loadData()
  }, [loadData, refreshKey])

  /* ── Actions ── */

  const doAction = async (chapterId: string, endpoint: string, body?: object) => {
    setActionInProgress(chapterId)
    setError(null)
    try {
      const res = await apiFetch(endpoint, apiToken, {
        method: 'POST',
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Action failed')
      }
      await loadData()
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionInProgress(null)
    }
  }

  const markReady = (id: string) =>
    doAction(id, `/api/projects/${projectId}/chapters/${id}/complete`)

  const revertToDraft = (id: string) =>
    doAction(id, `/api/projects/${projectId}/chapters/${id}/revert-to-draft`)

  const publishNow = (id: string) =>
    doAction(id, `/api/projects/${projectId}/chapters/${id}/publish`, { publishStatus: 'published' })

  const releaseNow = (id: string) =>
    doAction(id, `/api/projects/${projectId}/chapters/${id}/publish`, {
      publishStatus: 'published',
      publishEarly: true,
    })

  const unpublish = (id: string) =>
    doAction(id, `/api/projects/${projectId}/chapters/${id}/unpublish`)

  const scheduleChapter = async (id: string) => {
    if (!scheduledDate) return
    setSchedulingChapterId(null)
    setScheduledDate('')
    await doAction(id, `/api/projects/${projectId}/chapters/${id}/publish`, {
      publishStatus: 'scheduled',
      scheduledFor: new Date(scheduledDate).toISOString(),
    })
  }

  const startScheduling = (id: string, existingDate?: string) => {
    setSchedulingChapterId(id)
    if (existingDate) {
      const local = new Date(existingDate)
      const pad = (n: number) => String(n).padStart(2, '0')
      setScheduledDate(
        `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`
      )
    } else {
      setScheduledDate('')
    }
  }

  const cancelScheduling = () => {
    setSchedulingChapterId(null)
    setScheduledDate('')
  }

  /* ── Filtering ── */

  const filteredChapters =
    filter === 'all'
      ? chapters
      : chapters.filter((c) => c.status === filter)

  const statusCounts = chapters.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  /* ── Render ── */

  if (loading) {
    return (
      <div className="px-5 py-8">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-32 rounded bg-gray-100 dark:bg-gray-700" />
          <div className="h-8 w-full rounded bg-gray-100 dark:bg-gray-700" />
          <div className="h-8 w-full rounded bg-gray-100 dark:bg-gray-700" />
          <div className="h-8 w-full rounded bg-gray-100 dark:bg-gray-700" />
        </div>
      </div>
    )
  }

  if (chapters.length === 0) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">
          No chapters yet. Start writing to see them here.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Header with filter tabs */}
      <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-display text-base font-semibold text-gray-900 dark:text-gray-100">
            Chapters
          </h3>
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
            {FILTER_TABS.map((tab) => {
              const count = tab.value === 'all' ? chapters.length : (statusCounts[tab.value] || 0)
              if (tab.value !== 'all' && count === 0) return null
              return (
                <button
                  key={tab.value}
                  onClick={() => setFilter(tab.value)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    filter === tab.value
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                  }`}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className="ml-1 text-gray-400 dark:text-gray-500">{count}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {autoReleaseEnabled && (filter === 'all' || filter === 'draft' || filter === 'complete') && (
        <div className="mx-5 mt-4 rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-xs text-blue-700 dark:border-blue-800/30 dark:bg-blue-900/10 dark:text-blue-300">
          Auto-scheduling is active. Chapters are scheduled in manuscript order when marked ready.
        </div>
      )}

      <div className="overflow-x-auto px-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium pl-4">#</th>
              <th className="text-left py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">Title</th>
              <th className="text-left py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">Status</th>
              <th className="text-left py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">Date</th>
              <th className="text-right py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">Views</th>
              <th className="text-right py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredChapters.map((chapter, idx) => {
              const isLoading = actionInProgress === chapter.id
              return (
                <React.Fragment key={chapter.id}>
                  <tr className={`border-b border-gray-100 dark:border-gray-700/50 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${ROW_TINTS[chapter.status] || ''}`}>
                    <td className="py-2.5 pr-4 text-gray-400 dark:text-gray-500 tabular-nums pl-4">
                      {idx + 1}
                    </td>
                    <td className="py-2.5 pr-4 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-900 dark:text-gray-100 truncate">
                          {chapter.title}
                        </span>
                        {chapter.status === 'published' && readerBaseUrl && (
                          <a
                            href={`${readerBaseUrl}/${chapter.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-shrink-0 text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors"
                            title="View in reader"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[chapter.status] || STATUS_COLORS.draft}`}>
                        {STATUS_LABELS[chapter.status] || chapter.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-gray-500 dark:text-gray-400">
                      {chapter.publishedAt ? formatDate(chapter.publishedAt) : ''}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-gray-600 dark:text-gray-400 tabular-nums text-xs">
                      {chapter.status === 'published' && chapter.viewCount > 0
                        ? chapter.viewCount.toLocaleString()
                        : chapter.status === 'published' ? '-' : ''}
                    </td>
                    <td className="py-2.5 pr-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {isLoading ? (
                          <span className="text-xs text-gray-400">...</span>
                        ) : (
                          <ChapterActions
                            chapter={chapter}
                            onMarkReady={() => markReady(chapter.id)}
                            onRevertToDraft={() => revertToDraft(chapter.id)}
                            onPublishNow={() => publishNow(chapter.id)}
                            onReleaseNow={() => releaseNow(chapter.id)}
                            onSchedule={() => startScheduling(chapter.id)}
                            onReschedule={() => startScheduling(chapter.id, chapter.publishedAt)}
                            onUnschedule={() => unpublish(chapter.id)}
                            onUnpublish={() => unpublish(chapter.id)}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                  {schedulingChapterId === chapter.id && (
                    <tr className="bg-gray-50/80 dark:bg-gray-800/30">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="flex items-center gap-3 ml-8">
                          <input
                            type="datetime-local"
                            value={scheduledDate}
                            onChange={(e) => setScheduledDate(e.target.value)}
                            className="rounded border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                          />
                          <button
                            onClick={() => void scheduleChapter(chapter.id)}
                            disabled={!scheduledDate || actionInProgress === chapter.id}
                            className="rounded px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
                          >
                            {actionInProgress === chapter.id ? '...' : 'Confirm'}
                          </button>
                          <button
                            onClick={cancelScheduling}
                            className="rounded px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {filteredChapters.length === 0 && (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">
            No {filter === 'complete' ? 'ready' : filter} chapters.
          </p>
        </div>
      )}
    </div>
  )
}

/* ── Chapter action buttons ── */

function ChapterActions({
  chapter,
  onMarkReady,
  onRevertToDraft,
  onPublishNow,
  onReleaseNow,
  onSchedule,
  onReschedule,
  onUnschedule,
  onUnpublish,
}: {
  chapter: ChapterRow
  onMarkReady: () => void
  onRevertToDraft: () => void
  onPublishNow: () => void
  onReleaseNow: () => void
  onSchedule: () => void
  onReschedule: () => void
  onUnschedule: () => void
  onUnpublish: () => void
}) {
  const btnClass = (color: string) =>
    `rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${color}`

  switch (chapter.status) {
    case 'draft':
      return (
        <button onClick={onMarkReady} className={btnClass('text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20')}>
          Mark Ready
        </button>
      )
    case 'complete':
      return (
        <>
          <button onClick={onSchedule} className={btnClass('text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20')}>
            Schedule
          </button>
          <button onClick={onPublishNow} className={btnClass('text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20')}>
            Publish Now
          </button>
          <button onClick={onRevertToDraft} className={btnClass('text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800')}>
            Revert
          </button>
        </>
      )
    case 'scheduled':
      return (
        <>
          <button onClick={onReleaseNow} className={btnClass('text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20')}>
            Release Now
          </button>
          <button onClick={onReschedule} className={btnClass('text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20')}>
            Reschedule
          </button>
          <button onClick={onUnschedule} className={btnClass('text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800')}>
            Unschedule
          </button>
        </>
      )
    case 'published':
      return (
        <button onClick={onUnpublish} className={btnClass('text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20')}>
          Unpublish
        </button>
      )
    default:
      return null
  }
}
