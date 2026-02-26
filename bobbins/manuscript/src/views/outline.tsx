import { useState, useEffect, useCallback, useRef } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

interface OutlineViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityId?: string
}

/**
 * Outline View for Manuscript bobbin
 * Displays container hierarchy with drag-to-reorder
 */
export default function OutlineView({ projectId, sdk, entityId }: OutlineViewProps) {
  const [container, setContainer] = useState<any>(null)
  const [children, setChildren] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Drag state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragCounter = useRef(0)

  useEffect(() => {
    if (!entityId) {
      setLoading(false)
      return
    }

    loadContainerData()
  }, [entityId, projectId])

  async function loadContainerData() {
    if (!sdk || !entityId) return

    try {
      setLoading(true)

      // Load the container details
      const containerData = await sdk.entities.get('containers', entityId)
      setContainer(containerData)

      // Load all child containers (try both naming conventions)
      const [childBySnake, childByCamel] = await Promise.all([
        sdk.entities.query({
          collection: 'containers',
          filters: { parent_id: entityId },
          sort: [{ field: 'order', direction: 'asc' }],
          limit: 1000
        }),
        sdk.entities.query({
          collection: 'containers',
          filters: { parentId: entityId },
          sort: [{ field: 'order', direction: 'asc' }],
          limit: 1000
        })
      ])

      // Load all content items in this container (try both naming conventions)
      const [contentBySnake, contentByCamel] = await Promise.all([
        sdk.entities.query({
          collection: 'content',
          filters: { container_id: entityId },
          sort: [{ field: 'order', direction: 'asc' }],
          limit: 1000
        }),
        sdk.entities.query({
          collection: 'content',
          filters: { containerId: entityId },
          sort: [{ field: 'order', direction: 'asc' }],
          limit: 1000
        })
      ])

      // Deduplicate by id (in case both conventions match the same rows)
      const dedup = (a: any[], b: any[]) => {
        const seen = new Set(a.map((x: any) => x.id))
        return [...a, ...b.filter((x: any) => !seen.has(x.id))]
      }
      const childContainers = { data: dedup(childBySnake.data || [], childByCamel.data || []) }
      const contentItems = { data: dedup(contentBySnake.data || [], contentByCamel.data || []) }

      // Combine and sort by order
      const allChildren = [
        ...(childContainers.data || []).map((c: any) => ({ ...c, _type: 'container' })),
        ...(contentItems.data || []).map((c: any) => ({ ...c, _type: 'content' }))
      ].sort((a, b) => (a.order || 0) - (b.order || 0))

      setChildren(allChildren)
    } catch (error) {
      console.error('[OutlineView] Failed to load container:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleItemClick(item: any) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('bobbinry:navigate', {
          detail: {
            entityType: item._type,
            entityId: item.id,
            bobbinId: 'manuscript',
            metadata: {
              type: item.type,
              parentId: item._type === 'container' ? item.parent_id : item.container_id
            }
          }
        })
      )
    }
  }

  // --- Drag-to-reorder handlers ---

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.stopPropagation()
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    // Set minimal drag image data
    e.dataTransfer.setData('text/plain', String(index))
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index)
    }
  }, [draggedIndex])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setDragOverIndex(null)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0

    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null)
      setDragOverIndex(null)
      return
    }

    // Reorder locally first (optimistic)
    const updated = [...children]
    const [moved] = updated.splice(draggedIndex, 1)
    updated.splice(dropIndex, 0, moved)
    setChildren(updated)
    setDraggedIndex(null)
    setDragOverIndex(null)

    // Persist new order values to the backend
    try {
      const updates = updated.map((item, i) => {
        const collection = item._type === 'container' ? 'containers' : 'content'
        const newOrder = (i + 1) * 100
        return sdk.entities.update(collection, item.id, {
          order: newOrder,
          updated_at: new Date().toISOString()
        })
      })
      await Promise.all(updates)
    } catch (error) {
      console.error('[OutlineView] Failed to persist reorder:', error)
      // Reload to get server state on error
      loadContainerData()
    }
  }, [draggedIndex, children, sdk])

  const handleDragEnd = useCallback(() => {
    dragCounter.current = 0
    setDraggedIndex(null)
    setDragOverIndex(null)
  }, [])

  // --- Helpers ---

  function getWordCount(item: any): number {
    const wc = item.word_count ?? item.wordCount ?? 0
    return typeof wc === 'string' ? parseInt(wc, 10) || 0 : Number(wc) || 0
  }

  // --- Render ---

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  if (!entityId || !container) {
    return (
      <div className="p-8 text-center">
        <div className="text-gray-500 dark:text-gray-400">
          <p className="mb-4">Select a folder from the navigation panel to view its contents.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{container.icon || '📁'}</span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {container.title}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {children.length} {children.length === 1 ? 'item' : 'items'}
              {children.length > 1 && ' · drag to reorder'}
            </p>
          </div>
        </div>
      </div>

      {/* Content List */}
      <div className="flex-1 overflow-y-auto p-6">
        {children.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <p>This folder is empty.</p>
            <p className="text-sm mt-2">Use the navigation panel to add items.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {children.map((item, index) => {
              const wordCount = getWordCount(item)
              const isDragged = draggedIndex === index
              const isOver = dragOverIndex === index

              return (
                <div
                  key={item.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragEnter={(e) => handleDragEnter(e, index)}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  onClick={() => handleItemClick(item)}
                  className={`
                    p-4 border rounded-lg cursor-pointer transition-all select-none
                    ${isDragged
                      ? 'opacity-40 border-dashed border-gray-300 dark:border-gray-600'
                      : isOver
                        ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }
                  `}
                >
                  <div className="flex items-center gap-3">
                    {/* Drag handle */}
                    <span
                      className="text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing shrink-0"
                      title="Drag to reorder"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="5" cy="3" r="1.5" />
                        <circle cx="11" cy="3" r="1.5" />
                        <circle cx="5" cy="8" r="1.5" />
                        <circle cx="11" cy="8" r="1.5" />
                        <circle cx="5" cy="13" r="1.5" />
                        <circle cx="11" cy="13" r="1.5" />
                      </svg>
                    </span>
                    <span className="text-xl shrink-0">
                      {item._type === 'container'
                        ? (item.icon || '📁')
                        : '📝'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {item.title}
                      </h3>
                      <div className="flex gap-3 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {item._type === 'container' && (
                          <span className="capitalize">{item.type}</span>
                        )}
                        {item._type === 'content' && wordCount > 0 && (
                          <span>{wordCount.toLocaleString()} words</span>
                        )}
                      </div>
                    </div>
                    <span className="text-gray-400 dark:text-gray-500 shrink-0">›</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
