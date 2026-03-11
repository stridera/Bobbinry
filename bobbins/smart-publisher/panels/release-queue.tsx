'use client'

/**
 * Release Queue Dashboard Panel
 *
 * Compact view shown on the /publish page when smart-publisher is installed.
 * Shows next scheduled release, queue summary, and quick authorize/hold actions.
 * When empty, shows an informative state explaining the release queue feature.
 */

import { useState, useEffect, useCallback } from 'react'

interface ReleaseQueuePanelProps {
  projectId: string
  apiToken?: string
  refreshKey?: number
  context?: {
    projectId: string
    apiToken?: string
    refreshKey?: number
  }
}

interface QueueItem {
  id: string
  chapterTitle: string
  status: string
  authorizedAt: string | null
  queuePosition: number
  notes: string | null
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const DEFAULT_STATUS = { dot: 'bg-yellow-500', label: 'Queued', bg: 'bg-yellow-50 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-800/30' }
const STATUS_CONFIG: Record<string, { dot: string; label: string; bg: string }> = {
  queued: {
    dot: 'bg-yellow-500',
    label: 'Queued',
    bg: 'bg-yellow-50 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-800/30',
  },
  releasing: {
    dot: 'bg-blue-500',
    label: 'Releasing',
    bg: 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800/30',
  },
  released: {
    dot: 'bg-green-500',
    label: 'Released',
    bg: 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800/30',
  },
  held: {
    dot: 'bg-red-500',
    label: 'On Hold',
    bg: 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30',
  },
}

async function apiFetchLocal(path: string, token: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  })
}

export default function ReleaseQueuePanel(props: ReleaseQueuePanelProps) {
  const projectId = props.projectId || props.context?.projectId
  const apiToken = props.apiToken || props.context?.apiToken
  const refreshKey = props.refreshKey ?? props.context?.refreshKey ?? 0

  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const loadQueue = useCallback(async () => {
    if (!projectId || !apiToken) return
    setLoading(true)
    try {
      const res = await apiFetchLocal(
        `/api/collections/ReleaseQueue/entities?projectId=${projectId}`,
        apiToken
      )
      if (res.ok) {
        const data = await res.json()
        const entities = data.entities || []
        const queueItems: QueueItem[] = entities
          .sort((a: any, b: any) => (a.queue_position ?? 0) - (b.queue_position ?? 0))
          .map((entity: any) => ({
            id: entity.id,
            chapterTitle: entity.chapter_title || entity.title || 'Chapter',
            status: entity.status || 'queued',
            authorizedAt: entity.authorized_at || null,
            queuePosition: entity.queue_position ?? 0,
            notes: entity.notes || null,
          }))
        setItems(queueItems)
      }
    } catch (err) {
      console.error('ReleaseQueuePanel: Failed to load queue', err)
    } finally {
      setLoading(false)
    }
  }, [projectId, apiToken])

  useEffect(() => {
    loadQueue()
  }, [loadQueue, refreshKey])

  const updateItem = async (itemId: string, updates: Record<string, unknown>) => {
    if (!projectId || !apiToken) return
    setActionLoading(itemId)
    try {
      await apiFetchLocal(
        `/api/collections/ReleaseQueue/entities/${itemId}`,
        apiToken,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: updates }),
        }
      )
      await loadQueue()
    } catch {
      console.error('Failed to update queue item')
    } finally {
      setActionLoading(null)
    }
  }

  const authorize = (itemId: string) =>
    updateItem(itemId, { authorized_at: new Date().toISOString(), status: 'queued' })

  const hold = (itemId: string) =>
    updateItem(itemId, { status: 'held' })

  const resume = (itemId: string) =>
    updateItem(itemId, { status: 'queued', authorized_at: new Date().toISOString() })

  if (loading) {
    return (
      <div className="px-5 py-4">
        <div className="h-4 w-32 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
      </div>
    )
  }

  // Empty state — explain what the release queue is
  if (items.length === 0) {
    return (
      <div className="px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-purple-500 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Release Queue
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
              Schedule chapters for automatic release on a cadence. Add chapters to the queue from the project editor,
              and they'll be published in order based on your release schedule.
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">
              No chapters queued yet
            </p>
          </div>
        </div>
      </div>
    )
  }

  const queuedItems = items.filter(i => i.status === 'queued')
  const heldItems = items.filter(i => i.status === 'held')
  const releasedItems = items.filter(i => i.status === 'released')
  const pendingItems = items.filter(i => i.status !== 'released')

  // Next up — first queued item that's authorized
  const nextUp = queuedItems.find(i => i.authorizedAt)
  const needsAuth = queuedItems.filter(i => !i.authorizedAt)

  return (
    <div className="px-5 py-4 space-y-3">
      {/* Header with summary */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Release Queue
        </h4>
        <div className="flex items-center gap-2 text-[11px]">
          {pendingItems.length > 0 && (
            <span className="text-gray-500 dark:text-gray-400">
              {pendingItems.length} pending
            </span>
          )}
          {heldItems.length > 0 && (
            <span className="text-red-600 dark:text-red-400 font-medium">
              {heldItems.length} held
            </span>
          )}
          {releasedItems.length > 0 && (
            <span className="text-green-600 dark:text-green-400">
              {releasedItems.length} released
            </span>
          )}
        </div>
      </div>

      {/* Next up callout */}
      {nextUp && (
        <div className="flex items-center gap-3 px-3 py-2.5 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30 rounded-lg">
          <div className="w-5 h-5 rounded-md bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
            <svg className="w-3 h-3 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-700 dark:text-gray-300">
              <span className="font-medium">Next up:</span>{' '}
              <span className="truncate">{nextUp.chapterTitle}</span>
            </p>
          </div>
          <button
            onClick={() => hold(nextUp.id)}
            disabled={actionLoading === nextUp.id}
            className="text-[11px] px-2 py-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50 flex-shrink-0"
          >
            Hold
          </button>
        </div>
      )}

      {/* Authorization needed */}
      {needsAuth.length > 0 && (
        <div className="px-3 py-2 bg-yellow-50/50 dark:bg-yellow-900/10 border border-yellow-100 dark:border-yellow-800/30 rounded-lg">
          <p className="text-[11px] text-yellow-700 dark:text-yellow-400 font-medium mb-1.5">
            {needsAuth.length} chapter{needsAuth.length !== 1 ? 's' : ''} awaiting authorization
          </p>
          <div className="space-y-1">
            {needsAuth.map(item => (
              <div key={item.id} className="flex items-center justify-between">
                <span className="text-xs text-gray-700 dark:text-gray-300 truncate min-w-0">
                  {item.chapterTitle}
                </span>
                <button
                  onClick={() => authorize(item.id)}
                  disabled={actionLoading === item.id}
                  className="text-[11px] px-2 py-0.5 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors disabled:opacity-50 flex-shrink-0 font-medium"
                >
                  {actionLoading === item.id ? '...' : 'Authorize'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Queue list */}
      <div className="space-y-0.5">
        {items.map((item, idx) => {
          const config = STATUS_CONFIG[item.status] ?? DEFAULT_STATUS
          const isActionTarget = actionLoading === item.id

          return (
            <div
              key={item.id}
              className="group flex items-center gap-3 py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              {/* Position */}
              <span className="text-[11px] text-gray-400 dark:text-gray-500 w-4 text-right tabular-nums flex-shrink-0">
                {idx + 1}
              </span>

              {/* Status dot */}
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${config.dot}`} />

              {/* Title */}
              <span className="text-xs text-gray-800 dark:text-gray-200 truncate min-w-0 flex-1">
                {item.chapterTitle}
              </span>

              {/* Status label + actions */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {config.label}
                </span>

                {/* Actions on hover */}
                {item.status === 'queued' && (
                  <button
                    onClick={() => hold(item.id)}
                    disabled={isActionTarget}
                    className="text-[11px] px-1.5 py-0.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                  >
                    Hold
                  </button>
                )}
                {item.status === 'held' && (
                  <button
                    onClick={() => resume(item.id)}
                    disabled={isActionTarget}
                    className="text-[11px] px-1.5 py-0.5 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                  >
                    Resume
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Notes for held items */}
      {heldItems.filter(i => i.notes).length > 0 && (
        <div className="pt-1 border-t border-gray-100 dark:border-gray-800">
          {heldItems.filter(i => i.notes).map(item => (
            <p key={item.id} className="text-[11px] text-gray-400 dark:text-gray-500 italic px-2 py-0.5">
              {item.chapterTitle}: {item.notes}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
