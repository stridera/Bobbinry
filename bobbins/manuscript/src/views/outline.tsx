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
 * Displays container hierarchy with drag-to-reorder and inline synopsis editing
 */
export default function OutlineView({ projectId, sdk, entityId }: OutlineViewProps) {
  const [container, setContainer] = useState<any>(null)
  const [children, setChildren] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Drag state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragCounter = useRef(0)

  // Synopsis editing state
  // editingId can be a child item id OR 'header' for the container synopsis
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isRoot = entityId === 'ROOT'

  useEffect(() => {
    if (!entityId) {
      setLoading(false)
      return
    }

    if (isRoot) {
      loadRootData()
    } else {
      loadContainerData()
    }
  }, [entityId, projectId])

  // Auto-focus textarea when editing starts
  useEffect(() => {
    if (editingId && textareaRef.current) {
      textareaRef.current.focus()
      const len = textareaRef.current.value.length
      textareaRef.current.setSelectionRange(len, len)
    }
  }, [editingId])

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

  async function loadRootData() {
    if (!sdk) return

    try {
      setLoading(true)
      setContainer({ title: 'Manuscript', icon: '📝', synopsis: null, _isRoot: true })

      // Load ALL containers and content, then filter to root level
      const [allContainers, allContent] = await Promise.all([
        sdk.entities.query({ collection: 'containers', limit: 1000 }),
        sdk.entities.query({ collection: 'content', limit: 1000 })
      ])

      // Root containers: parent_id is null, undefined, or 'ROOT'
      const rootContainers = ((allContainers.data || []) as any[])
        .filter((c: any) => {
          const pid = c.parent_id || c.parentId
          return !pid || pid === 'ROOT'
        })
        .map((c: any) => ({ ...c, _type: 'container' as const }))

      // Root content: container_id is null or undefined
      const rootContent = ((allContent.data || []) as any[])
        .filter((c: any) => !c.container_id && !c.containerId)
        .map((c: any) => ({ ...c, _type: 'content' as const }))

      const allChildren = [...rootContainers, ...rootContent]
        .sort((a, b) => (a.order || 0) - (b.order || 0))

      setChildren(allChildren)
    } catch (error) {
      console.error('[OutlineView] Failed to load root:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleItemClick(item: any) {
    // Don't navigate if editing synopsis on this item
    if (editingId === item.id) return

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

  // --- Synopsis editing ---

  function startEditingSynopsis(id: string, currentSynopsis: string, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingId(id)
    setEditText(currentSynopsis || '')
  }

  async function saveSynopsis(targetId: string) {
    const trimmed = editText.trim()

    if (targetId === 'header') {
      // Editing the container's own synopsis
      if (trimmed === (container?.synopsis || '')) {
        setEditingId(null)
        return
      }
      setSaving(targetId)
      try {
        await sdk.entities.update('containers', entityId!, {
          synopsis: trimmed,
          updated_at: new Date().toISOString()
        })
        setContainer((prev: any) => ({ ...prev, synopsis: trimmed }))
      } catch (error) {
        console.error('[OutlineView] Failed to save container synopsis:', error)
      } finally {
        setSaving(null)
        setEditingId(null)
      }
    } else {
      // Editing a child item's synopsis
      const item = children.find(c => c.id === targetId)
      if (!item) return
      if (trimmed === (item.synopsis || '')) {
        setEditingId(null)
        return
      }
      setSaving(targetId)
      try {
        const collection = item._type === 'container' ? 'containers' : 'content'
        await sdk.entities.update(collection, targetId, {
          synopsis: trimmed,
          updated_at: new Date().toISOString()
        })
        setChildren(prev => prev.map(c =>
          c.id === targetId ? { ...c, synopsis: trimmed } : c
        ))
      } catch (error) {
        console.error('[OutlineView] Failed to save synopsis:', error)
      } finally {
        setSaving(null)
        setEditingId(null)
      }
    }
  }

  function handleSynopsisKeyDown(e: React.KeyboardEvent, targetId: string) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      saveSynopsis(targetId)
    } else if (e.key === 'Escape') {
      setEditingId(null)
    }
  }

  // --- Drag-to-reorder handlers ---

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    if (editingId) { e.preventDefault(); return }
    e.stopPropagation()
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }, [editingId])

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
      isRoot ? loadRootData() : loadContainerData()
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

  const isEditingHeader = editingId === 'header'

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-start gap-3">
          <span className="text-2xl mt-0.5">{container.icon || '📁'}</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {container.title}
            </h1>

            {/* Container synopsis - editable (not for root) */}
            {!isRoot && <div className="mt-1">
              {isEditingHeader ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <textarea
                    ref={textareaRef}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={() => saveSynopsis('header')}
                    onKeyDown={(e) => handleSynopsisKeyDown(e, 'header')}
                    placeholder="Write a synopsis for this section..."
                    maxLength={300}
                    rows={2}
                    className="w-full text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  />
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[10px] text-gray-400">
                      {editText.length}/300 · Enter to save · Esc to cancel
                    </span>
                    {saving === 'header' && (
                      <span className="text-[10px] text-blue-500">Saving...</span>
                    )}
                  </div>
                </div>
              ) : (
                <p
                  onClick={(e) => startEditingSynopsis('header', container.synopsis || '', e)}
                  className="text-sm cursor-text group/syn"
                >
                  {container.synopsis ? (
                    <span className="text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                      {container.synopsis}
                      <span className="inline-block ml-1.5 text-gray-300 dark:text-gray-600 opacity-0 group-hover/syn:opacity-100 transition-opacity align-middle">
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" />
                        </svg>
                      </span>
                    </span>
                  ) : (
                    <span className="text-gray-300 dark:text-gray-600 italic hover:text-gray-400 dark:hover:text-gray-500 transition-colors">
                      Add synopsis...
                    </span>
                  )}
                </p>
              )}
            </div>}

            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
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
            <p>{isRoot ? 'No items in the manuscript yet.' : 'This folder is empty.'}</p>
            <p className="text-sm mt-2">Use the navigation panel to add items.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {children.map((item, index) => {
              const wordCount = getWordCount(item)
              const isDragged = draggedIndex === index
              const isOver = dragOverIndex === index
              const isEditingThis = editingId === item.id

              return (
                <div
                  key={item.id}
                  draggable={!isEditingThis}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragEnter={(e) => handleDragEnter(e, index)}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  onClick={() => handleItemClick(item)}
                  className={`
                    group p-4 border rounded-lg transition-all select-none
                    ${isEditingThis
                      ? 'border-blue-300 dark:border-blue-600 bg-blue-50/30 dark:bg-blue-900/10 cursor-default'
                      : isDragged
                        ? 'opacity-40 border-dashed border-gray-300 dark:border-gray-600 cursor-grabbing'
                        : isOver
                          ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm cursor-pointer'
                          : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer'
                    }
                  `}
                >
                  <div className="flex items-start gap-3">
                    {/* Drag handle */}
                    <span
                      className="text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing shrink-0 mt-1"
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
                    <span className="text-xl shrink-0 mt-0.5">
                      {item._type === 'container'
                        ? (item.icon || '📁')
                        : '📝'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {item.title}
                      </h3>

                      {/* Synopsis - inline editable */}
                      {isEditingThis ? (
                        <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                          <textarea
                            ref={textareaRef}
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onBlur={() => saveSynopsis(item.id)}
                            onKeyDown={(e) => handleSynopsisKeyDown(e, item.id)}
                            placeholder="Write a short synopsis..."
                            maxLength={300}
                            rows={2}
                            className="w-full text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                          />
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[10px] text-gray-400">
                              {editText.length}/300 · Enter to save
                            </span>
                            {saving === item.id && (
                              <span className="text-[10px] text-blue-500">Saving...</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={(e) => startEditingSynopsis(item.id, item.synopsis || '', e)}
                          className="mt-0.5 cursor-text group/syn"
                        >
                          {item.synopsis ? (
                            <p className="text-xs text-gray-400 dark:text-gray-500 truncate hover:text-gray-500 dark:hover:text-gray-400 transition-colors">
                              {item.synopsis}
                              <span className="inline-block ml-1 text-gray-300 dark:text-gray-600 opacity-0 group-hover/syn:opacity-100 transition-opacity align-middle">
                                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" />
                                </svg>
                              </span>
                            </p>
                          ) : (
                            <p className="text-xs text-gray-300 dark:text-gray-600 italic opacity-0 group-hover:opacity-100 transition-opacity hover:text-gray-400 dark:hover:text-gray-500">
                              Add synopsis...
                            </p>
                          )}
                        </div>
                      )}

                      <div className="flex gap-3 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {item._type === 'container' && (
                          <span className="capitalize">{item.type}</span>
                        )}
                        {item._type === 'content' && wordCount > 0 && (
                          <span>{wordCount.toLocaleString()} words</span>
                        )}
                        {item._type === 'content' && item.status && item.status !== 'draft' && (
                          <span className="capitalize">{item.status}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-gray-400 dark:text-gray-500 shrink-0 mt-1">›</span>
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
