'use client'

/**
 * Release Queue Dashboard Panel
 *
 * Compact view shown on the /publish page when smart-publisher is installed.
 * Shows next scheduled release, queue summary, and quick authorize/hold actions.
 */

import { useState, useEffect, useCallback } from 'react'

interface ReleaseQueuePanelProps {
  projectId: string
  apiToken?: string
  context?: {
    projectId: string
    apiToken?: string
  }
}

interface QueueItem {
  id: string
  chapterTitle: string
  status: string
  authorizedAt: string | null
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

const STATUS_DOT: Record<string, string> = {
  queued: 'bg-yellow-500',
  releasing: 'bg-blue-500',
  released: 'bg-green-500',
  held: 'bg-red-500',
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
          .slice(0, 5)
          .map((entity: any) => ({
            id: entity.id,
            chapterTitle: entity.chapter_title || entity.title || 'Chapter',
            status: entity.status || 'queued',
            authorizedAt: entity.authorized_at || null,
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
  }, [loadQueue])

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

  if (loading) {
    return (
      <div className="px-5 py-3">
        <div className="h-4 w-32 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
      </div>
    )
  }

  // Don't render if queue is empty — no noise in the dashboard
  if (items.length === 0) return null

  const queuedCount = items.filter(i => i.status === 'queued').length
  const heldCount = items.filter(i => i.status === 'held').length

  return (
    <div className="px-5 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Release Queue
        </h4>
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {queuedCount > 0 && <span>{queuedCount} queued</span>}
          {heldCount > 0 && <span className="text-red-500">{heldCount} held</span>}
        </div>
      </div>

      <div className="space-y-0.5">
        {items.map(item => (
          <div key={item.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[item.status] || STATUS_DOT.queued}`} />
              <span className="text-xs text-gray-800 dark:text-gray-200 truncate">
                {item.chapterTitle}
              </span>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              {item.status === 'queued' && !item.authorizedAt && (
                <button
                  onClick={() => authorize(item.id)}
                  disabled={actionLoading === item.id}
                  className="text-xs px-1.5 py-0.5 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded disabled:opacity-50"
                >
                  Authorize
                </button>
              )}
              {item.status === 'queued' && (
                <button
                  onClick={() => hold(item.id)}
                  disabled={actionLoading === item.id}
                  className="text-xs px-1.5 py-0.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded disabled:opacity-50"
                >
                  Hold
                </button>
              )}
              {item.status === 'held' && (
                <button
                  onClick={() => authorize(item.id)}
                  disabled={actionLoading === item.id}
                  className="text-xs px-1.5 py-0.5 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded disabled:opacity-50"
                >
                  Resume
                </button>
              )}
              {item.status === 'released' && (
                <span className="text-xs text-gray-400 dark:text-gray-500">Released</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
