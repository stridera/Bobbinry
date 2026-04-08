'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'

interface Chapter {
  id: string
  title: string
  order: number
  collectionName: string
  commentCount: number
  reactionCount: number
  publication: {
    publishStatus: string
    publishedAt: string | null
    viewCount: number
    uniqueViewCount: number
    completionCount: number
    avgReadTimeSeconds: number | null
  } | null
}

interface ChapterOverviewProps {
  chapters: Chapter[]
  projectId: string
  readerBaseUrl: string | null
  onStatusChange?: () => void
}

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
  complete: 'bg-blue-50/40 dark:bg-blue-950/10',
  published: 'bg-green-50/30 dark:bg-green-950/10',
}

export function ChapterOverview({ chapters, projectId, readerBaseUrl, onStatusChange }: ChapterOverviewProps) {
  const { data: session } = useSession()
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  const toggleStatus = async (chapterId: string, currentStatus: string) => {
    const token = session?.apiToken
    if (!token) return

    const endpoint = currentStatus === 'draft'
      ? `/api/projects/${projectId}/chapters/${chapterId}/complete`
      : `/api/projects/${projectId}/chapters/${chapterId}/revert-to-draft`

    setActionInProgress(chapterId)
    try {
      const res = await apiFetch(endpoint, token, { method: 'POST' })
      if (res.ok) {
        onStatusChange?.()
      }
    } catch (err) {
      console.error('Failed to update chapter status:', err)
    } finally {
      setActionInProgress(null)
    }
  }

  if (chapters.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fade-in">
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Chapters</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">No chapters yet. Start writing to see them here.</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fade-in">
      <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Chapters</h2>
      <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">#</th>
              <th className="text-left py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">Title</th>
              <th className="text-left py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">Status</th>
              <th className="text-right py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">
                <span title="Reactions">Reactions</span>
              </th>
              <th className="text-right py-2 text-gray-500 dark:text-gray-400 font-medium">
                <span title="Comments">Comments</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {chapters.map((chapter, i) => {
              const status = chapter.publication?.publishStatus || 'draft'
              const isPublished = status === 'published'
              const readerUrl = isPublished && readerBaseUrl
                ? `${readerBaseUrl}/${chapter.id}`
                : null
              const canToggle = status === 'draft' || status === 'complete'
              const isLoading = actionInProgress === chapter.id
              const rowTint = ROW_TINTS[status] || ''

              return (
                <tr key={chapter.id} className={`border-b border-gray-100 dark:border-gray-700/50 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${rowTint}`}>
                  <td className="py-2.5 pr-4 text-gray-400 dark:text-gray-500 tabular-nums">{i + 1}</td>
                  <td className="py-2.5 pr-4 font-medium">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/projects/${projectId}/write`}
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors"
                      >
                        {chapter.title}
                      </Link>
                      {readerUrl && (
                        <a
                          href={readerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors"
                          title="View published chapter"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || STATUS_COLORS.draft}`}>
                        {STATUS_LABELS[status] || status}
                      </span>
                      {canToggle && (
                        <button
                          onClick={() => toggleStatus(chapter.id, status)}
                          disabled={isLoading}
                          className={`text-xs px-2 py-0.5 rounded-md border transition-colors disabled:opacity-50 ${
                            status === 'draft'
                              ? 'border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-600 dark:text-blue-400 dark:hover:bg-blue-900/20'
                              : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800'
                          }`}
                        >
                          {isLoading ? '...' : status === 'draft' ? 'Mark Ready' : 'Revert to Draft'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                    {chapter.reactionCount > 0 ? chapter.reactionCount.toLocaleString() : '-'}
                  </td>
                  <td className="py-2.5 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                    {chapter.commentCount > 0 ? chapter.commentCount.toLocaleString() : '-'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
