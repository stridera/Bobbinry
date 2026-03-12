'use client'

/**
 * Publish Manager Dashboard Panel
 *
 * Rich analytics summary shown on the /publish page.
 * Shows aggregate stats, per-chapter performance, and publishing progress.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  PanelActionButton,
  PanelCard,
  PanelEmptyState,
  PanelLoadingState,
  PanelMessage,
  PanelPill,
  PanelSectionTitle,
} from '@bobbinry/sdk'
import { apiFetchLocal } from '../lib/api'
import { formatReadTime, formatCompactNumber } from '../lib/format'

interface PublishManagerPanelProps {
  projectId: string
  apiToken?: string
  refreshKey?: number
  selectedChapterId?: string | null
  onSelectChapter?: (chapterId: string | null) => void
  context?: {
    projectId: string
    apiToken?: string
    refreshKey?: number
    selectedChapterId?: string | null
    onSelectChapter?: (chapterId: string | null) => void
  }
}

interface ChapterPublication {
  chapterId: string
  publishStatus: string
  publishedAt?: string
  firstPublishedAt?: string
  lastPublishedAt?: string
  viewCount?: number
  uniqueViewCount?: number
  completionCount?: number
  avgReadTimeSeconds?: number
}

interface ChapterEntity {
  id: string
  title?: string
  order?: number
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

interface ChapterWithStats {
  id: string
  title: string
  order: number
  publishStatus: string
  viewCount: number
  uniqueViewCount: number
  completionCount: number
  avgReadTimeSeconds: number
  publishedAt?: string | undefined
}

export default function PublishManagerPanel(props: PublishManagerPanelProps) {
  const projectId = props.projectId || props.context?.projectId
  const apiToken = props.apiToken || props.context?.apiToken
  const refreshKey = props.refreshKey ?? props.context?.refreshKey ?? 0
  const selectedChapterId = props.selectedChapterId ?? props.context?.selectedChapterId
  const onSelectChapter = props.onSelectChapter || props.context?.onSelectChapter

  const [chaptersWithStats, setChaptersWithStats] = useState<ChapterWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAllChapters, setShowAllChapters] = useState(false)

  const loadData = useCallback(async () => {
    if (!projectId || !apiToken) return
    setLoading(true)

    try {
      setError(null)
      const [chapRes, pubRes] = await Promise.all([
        apiFetchLocal(`/api/collections/content/entities?projectId=${projectId}`, apiToken),
        apiFetchLocal(`/api/projects/${projectId}/publications?status=all`, apiToken),
      ])

      let chapters: ChapterEntity[] = []
      let publications: ChapterPublication[] = []

      if (chapRes.ok) {
        const data = await chapRes.json()
        chapters = (data.entities || []).sort(
          (a: ChapterEntity, b: ChapterEntity) => (a.order ?? 0) - (b.order ?? 0)
        )
      }

      if (pubRes.ok) {
        const data = await pubRes.json()
        publications = data.publications || []
      }

      // Merge chapters with publication data
      const pubMap = new Map(publications.map(p => [p.chapterId, p]))
      const merged: ChapterWithStats[] = chapters.map((ch, idx) => {
        const pub = pubMap.get(ch.id)
        return {
          id: ch.id,
          title: ch.title || `Chapter ${idx + 1}`,
          order: ch.order ?? idx,
          publishStatus: pub?.publishStatus || 'draft',
          viewCount: Number(pub?.viewCount || 0),
          uniqueViewCount: Number(pub?.uniqueViewCount || 0),
          completionCount: Number(pub?.completionCount || 0),
          avgReadTimeSeconds: Number(pub?.avgReadTimeSeconds || 0),
          publishedAt: pub?.publishedAt,
        }
      })

      setChaptersWithStats(merged)
    } catch (err) {
      console.error('PublishManagerPanel: Failed to load data', err)
      setError('Failed to load publishing analytics.')
    } finally {
      setLoading(false)
    }
  }, [projectId, apiToken])

  useEffect(() => {
    loadData()
  }, [loadData, refreshKey])

  if (loading) {
    return (
      <div className="px-5 py-4">
        <PanelLoadingState label="Loading publishing analytics…" />
      </div>
    )
  }

  if (chaptersWithStats.length === 0) {
    return (
      <div className="px-5 py-4">
        <PanelEmptyState
          title="No chapter data yet"
          description="Add chapters to this project to see publishing progress and audience metrics."
        />
      </div>
    )
  }

  const published = chaptersWithStats.filter(c => c.publishStatus === 'published')
  const drafts = chaptersWithStats.filter(c => c.publishStatus === 'draft')
  const complete = chaptersWithStats.filter(c => c.publishStatus === 'complete')
  const totalChapters = chaptersWithStats.length
  const publishedCount = published.length

  const totalViews = chaptersWithStats.reduce((s, c) => s + c.viewCount, 0)
  const totalUniqueViews = chaptersWithStats.reduce((s, c) => s + c.uniqueViewCount, 0)
  const totalCompletions = chaptersWithStats.reduce((s, c) => s + c.completionCount, 0)
  const avgReadTime = totalViews > 0
    ? Math.round(chaptersWithStats.reduce((s, c) => s + c.avgReadTimeSeconds * c.viewCount, 0) / totalViews)
    : 0
  const completionRate = totalViews > 0
    ? ((totalCompletions / totalViews) * 100).toFixed(0)
    : '0'

  const maxViews = Math.max(...chaptersWithStats.map(c => c.viewCount), 1)

  // Most popular published chapter
  const topChapter = [...published].sort((a, b) => b.viewCount - a.viewCount)[0]

  // Most recently published
  const lastPublished = [...published]
    .filter(c => c.publishedAt)
    .sort((a, b) => new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime())[0]

  // Chapters to display in the table
  const visibleChapters = showAllChapters ? chaptersWithStats : chaptersWithStats.slice(0, 5)
  const hasMore = chaptersWithStats.length > 5

  // If nothing is published yet, show a simpler prompt
  if (publishedCount === 0) {
    return (
      <div className="space-y-3 px-5 py-4">
        {error ? <PanelMessage tone="error">{error}</PanelMessage> : null}
        <PanelCard className="flex items-center gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
            <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              <span className="font-medium">{totalChapters} chapter{totalChapters !== 1 ? 's' : ''}</span> ready to publish
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {complete.length > 0
                ? `${complete.length} marked complete, ${drafts.length} draft`
                : 'Use the controls above to publish individual chapters or all at once'
              }
            </p>
          </div>
        </PanelCard>
      </div>
    )
  }

  return (
    <div className="px-5 py-4 space-y-4">
      {error ? <PanelMessage tone="error">{error}</PanelMessage> : null}

      <div className="flex items-center justify-between gap-3">
        <PanelSectionTitle>Publishing Analytics</PanelSectionTitle>
        {lastPublished?.publishedAt && (
          <PanelPill className="bg-transparent px-0 text-gray-400 dark:bg-transparent dark:text-gray-500">
            Last published {timeAgo(lastPublished.publishedAt)}
          </PanelPill>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <PanelCard>
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">
            {formatCompactNumber(totalViews)}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            total views
            {totalUniqueViews > 0 && totalUniqueViews !== totalViews && (
              <span className="text-gray-400 dark:text-gray-500"> ({formatCompactNumber(totalUniqueViews)} unique)</span>
            )}
          </div>
        </PanelCard>

        <PanelCard>
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">
            {formatCompactNumber(totalCompletions)}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            completions
          </div>
        </PanelCard>

        <PanelCard>
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">
            {completionRate}%
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            finish rate
          </div>
        </PanelCard>

        <PanelCard>
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">
            {avgReadTime > 0 ? formatReadTime(avgReadTime) : '-'}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            avg read time
          </div>
        </PanelCard>
      </div>

      <PanelCard className="space-y-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            {publishedCount}/{totalChapters} chapters published
          </span>
          <div className="flex items-center gap-3 text-[11px]">
            {publishedCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-gray-500 dark:text-gray-400">{publishedCount}</span>
              </span>
            )}
            {complete.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="text-gray-500 dark:text-gray-400">{complete.length}</span>
              </span>
            )}
            {drafts.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600" />
                <span className="text-gray-500 dark:text-gray-400">{drafts.length}</span>
              </span>
            )}
          </div>
        </div>
        <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden flex">
          {publishedCount > 0 && (
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-500"
              style={{ width: `${(publishedCount / totalChapters) * 100}%` }}
            />
          )}
          {complete.length > 0 && (
            <div
              className="h-full bg-blue-400 transition-all duration-500"
              style={{ width: `${(complete.length / totalChapters) * 100}%` }}
            />
          )}
        </div>
      </PanelCard>

      {topChapter && topChapter.viewCount > 0 && (
        <PanelCard className="flex items-center gap-3 border-green-100 bg-green-50/50 dark:border-green-800/30 dark:bg-green-900/10">
          <div className="w-6 h-6 rounded-md bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-700 dark:text-gray-300">
              <span className="font-medium truncate">{topChapter.title}</span>
              {' '}is your most-read chapter
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {topChapter.viewCount.toLocaleString()} view{topChapter.viewCount !== 1 ? 's' : ''}
              {topChapter.completionCount > 0 && (
                <span> &middot; {topChapter.completionCount} completion{topChapter.completionCount !== 1 ? 's' : ''}</span>
              )}
            </p>
          </div>
        </PanelCard>
      )}

      {published.length > 0 && (
        <div>
          <PanelSectionTitle>Chapter Performance</PanelSectionTitle>
          <div className="space-y-1">
            {visibleChapters.map((chapter, idx) => {
              const barWidth = chapter.viewCount > 0 ? (chapter.viewCount / maxViews) * 100 : 0
              const isPublished = chapter.publishStatus === 'published'
              const isSelected = selectedChapterId === chapter.id

              return (
                <div
                  key={chapter.id}
                  onClick={() => onSelectChapter?.(isSelected ? null : chapter.id)}
                  className={`group flex items-center gap-3 py-1.5 px-2 rounded transition-colors ${
                    onSelectChapter ? 'cursor-pointer' : ''
                  } ${
                    isSelected
                      ? 'bg-teal-50 dark:bg-teal-900/15 border-l-2 border-teal-500 pl-1.5'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <span className="text-[11px] text-gray-400 dark:text-gray-500 w-5 text-right tabular-nums flex-shrink-0">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-gray-800 dark:text-gray-200 truncate">
                        {chapter.title}
                      </span>
                      {!isPublished && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">
                          {chapter.publishStatus}
                        </span>
                      )}
                    </div>
                    {/* View bar */}
                    <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-400 dark:bg-blue-500 rounded-full transition-all duration-300"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] tabular-nums flex-shrink-0">
                    <span className="text-gray-600 dark:text-gray-400 w-12 text-right">
                      {chapter.viewCount > 0 ? chapter.viewCount.toLocaleString() : '-'}
                    </span>
                    <span className="text-gray-400 dark:text-gray-500 w-8 text-right opacity-0 group-hover:opacity-100 transition-opacity" title="Completions">
                      {chapter.completionCount > 0 ? chapter.completionCount.toLocaleString() : ''}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Show more / less toggle */}
          {hasMore && (
            <PanelActionButton
              onClick={() => setShowAllChapters(!showAllChapters)}
              className="mt-2"
            >
              {showAllChapters
                ? 'Show less'
                : `Show all ${totalChapters} chapters`
              }
            </PanelActionButton>
          )}
        </div>
      )}
    </div>
  )
}
