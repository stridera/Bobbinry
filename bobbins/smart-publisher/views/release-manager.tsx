'use client'

/**
 * ReleaseManager View
 *
 * Drag-to-reorder release queue with authorize/hold controls.
 * Shows queue items with status indicators and chapter titles.
 */

import { useState, useEffect } from 'react'
import { BobbinrySDK } from '@bobbinry/sdk'

interface QueueItem {
  id: string
  chapterId: string
  chapterTitle: string
  queuePosition: number
  status: string
  authorizedAt: string | null
  notes: string | null
}

interface ReleaseManagerProps {
  sdk: BobbinrySDK
  projectId: string
}

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  releasing: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  released: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  held: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
}

export default function ReleaseManager({ sdk, projectId }: ReleaseManagerProps) {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    loadQueue()
  }, [projectId])

  const loadQueue = async () => {
    setLoading(true)
    try {
      const result = await sdk.entities.query<any>({
        collection: 'ReleaseQueue',
        sort: [{ field: 'queue_position', direction: 'asc' }],
        limit: 200
      })

      // Resolve chapter titles
      const queueItems: QueueItem[] = await Promise.all(
        result.data.map(async (entity: any) => {
          const data = entity.entityData || entity
          let title = 'Unknown Chapter'
          try {
            const chapter = await sdk.entities.get('Chapter', data.chapter_id)
            if (chapter) {
              title = (chapter as any).entityData?.title || (chapter as any).title || 'Untitled'
            }
          } catch {}
          return {
            id: entity.id,
            chapterId: data.chapter_id,
            chapterTitle: title,
            queuePosition: data.queue_position,
            status: data.status || 'queued',
            authorizedAt: data.authorized_at,
            notes: data.notes
          }
        })
      )

      setItems(queueItems)
    } catch (err) {
      console.error('Failed to load release queue:', err)
    } finally {
      setLoading(false)
    }
  }

  const authorize = async (itemId: string) => {
    setActionLoading(itemId)
    try {
      await sdk.entities.update('ReleaseQueue', itemId, {
        authorized_at: new Date().toISOString(),
        status: 'queued'
      })
      await loadQueue()
    } catch (err) {
      console.error('Failed to authorize:', err)
    } finally {
      setActionLoading(null)
    }
  }

  const hold = async (itemId: string) => {
    setActionLoading(itemId)
    try {
      await sdk.entities.update('ReleaseQueue', itemId, {
        status: 'held'
      })
      await loadQueue()
    } catch (err) {
      console.error('Failed to hold:', err)
    } finally {
      setActionLoading(null)
    }
  }

  const moveUp = async (index: number) => {
    if (index === 0) return
    const item = items[index]!
    const prevItem = items[index - 1]!
    try {
      await Promise.all([
        sdk.entities.update('ReleaseQueue', item.id, { queue_position: prevItem.queuePosition }),
        sdk.entities.update('ReleaseQueue', prevItem.id, { queue_position: item.queuePosition })
      ])
      await loadQueue()
    } catch {}
  }

  const moveDown = async (index: number) => {
    if (index >= items.length - 1) return
    const item = items[index]!
    const nextItem = items[index + 1]!
    try {
      await Promise.all([
        sdk.entities.update('ReleaseQueue', item.id, { queue_position: nextItem.queuePosition }),
        sdk.entities.update('ReleaseQueue', nextItem.id, { queue_position: item.queuePosition })
      ])
      await loadQueue()
    } catch {}
  }

  if (loading) {
    return <div className="p-6 text-gray-500">Loading release queue...</div>
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Release Queue</h2>
        <button onClick={loadQueue} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          Refresh
        </button>
      </div>

      {items.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 italic">
          No chapters in the release queue. Add chapters from your manuscript to schedule them.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-800"
            >
              {/* Reorder buttons */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-xs"
                >
                  &#9650;
                </button>
                <button
                  onClick={() => moveDown(index)}
                  disabled={index === items.length - 1}
                  className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-xs"
                >
                  &#9660;
                </button>
              </div>

              {/* Position */}
              <span className="text-sm text-gray-400 w-6 text-center">{index + 1}</span>

              {/* Chapter info */}
              <div className="flex-1 min-w-0">
                <span className="font-medium text-gray-900 dark:text-gray-100 truncate block">
                  {item.chapterTitle}
                </span>
                {item.authorizedAt && (
                  <span className="text-xs text-gray-500">
                    Authorized {new Date(item.authorizedAt).toLocaleDateString()}
                  </span>
                )}
              </div>

              {/* Status */}
              <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[item.status] || STATUS_COLORS.queued}`}>
                {item.status}
              </span>

              {/* Actions */}
              <div className="flex gap-1">
                {item.status === 'queued' && !item.authorizedAt && (
                  <button
                    onClick={() => authorize(item.id)}
                    disabled={actionLoading === item.id}
                    className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    Authorize
                  </button>
                )}
                {item.status === 'queued' && (
                  <button
                    onClick={() => hold(item.id)}
                    disabled={actionLoading === item.id}
                    className="text-xs px-2 py-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded disabled:opacity-50"
                  >
                    Hold
                  </button>
                )}
                {item.status === 'held' && (
                  <button
                    onClick={() => authorize(item.id)}
                    disabled={actionLoading === item.id}
                    className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    Resume
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
