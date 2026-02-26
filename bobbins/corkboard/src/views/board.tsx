import { useState, useEffect, useCallback, useRef } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

interface BoardViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityType?: string
  entityId?: string
  metadata?: Record<string, any>
}

interface CardItem {
  id: string
  title: string
  type: string
  order: number
  status?: string
  synopsis?: string
  word_count?: number
  wordCount?: number
  notes?: string
  icon?: string
  _type: 'container' | 'content'
  [key: string]: any
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  'in-progress': 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  done: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

export default function BoardView({ projectId, sdk, entityId }: BoardViewProps) {
  const isRoot = entityId === 'ROOT'
  const [container, setContainer] = useState<any>(null)
  const [cards, setCards] = useState<CardItem[]>([])
  const [loading, setLoading] = useState(true)

  // Drag state
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const dragCounter = useRef(0)

  // Inline synopsis editing
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!entityId) {
      setLoading(false)
      return
    }
    if (isRoot) {
      loadRootData()
    } else {
      loadData()
    }
  }, [entityId, projectId])

  // Auto-focus textarea when editing starts
  useEffect(() => {
    if (editingId && textareaRef.current) {
      textareaRef.current.focus()
      // Place cursor at end
      const len = textareaRef.current.value.length
      textareaRef.current.setSelectionRange(len, len)
    }
  }, [editingId])

  async function loadData() {
    if (!sdk || !entityId) return

    try {
      setLoading(true)

      const containerData = await sdk.entities.get('containers', entityId)
      setContainer(containerData)

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

      const dedup = (a: any[], b: any[]) => {
        const seen = new Set(a.map((x: any) => x.id))
        return [...a, ...b.filter((x: any) => !seen.has(x.id))]
      }

      const allChildren: CardItem[] = [
        ...dedup(childBySnake.data || [], childByCamel.data || []).map((c: any) => ({ ...c, _type: 'container' as const })),
        ...dedup(contentBySnake.data || [], contentByCamel.data || []).map((c: any) => ({ ...c, _type: 'content' as const }))
      ].sort((a, b) => (a.order || 0) - (b.order || 0))

      setCards(allChildren)
    } catch (error) {
      console.error('[BoardView] Failed to load:', error)
    } finally {
      setLoading(false)
    }
  }

  async function loadRootData() {
    if (!sdk) return

    try {
      setLoading(true)
      setContainer({ title: 'Manuscript', icon: '📝', _isRoot: true })

      const [allContainers, allContent] = await Promise.all([
        sdk.entities.query({ collection: 'containers', limit: 1000 }),
        sdk.entities.query({ collection: 'content', limit: 1000 })
      ])

      const rootContainers = ((allContainers.data || []) as any[])
        .filter((c: any) => {
          const pid = c.parent_id || c.parentId
          return !pid || pid === 'ROOT'
        })
        .map((c: any) => ({ ...c, _type: 'container' as const }))

      const rootContent = ((allContent.data || []) as any[])
        .filter((c: any) => !c.container_id && !c.containerId)
        .map((c: any) => ({ ...c, _type: 'content' as const }))

      const allChildren: CardItem[] = [...rootContainers, ...rootContent]
        .sort((a, b) => (a.order || 0) - (b.order || 0))

      setCards(allChildren)
    } catch (error) {
      console.error('[BoardView] Failed to load root:', error)
    } finally {
      setLoading(false)
    }
  }

  function getWordCount(item: CardItem): number {
    const wc = item.word_count ?? item.wordCount ?? 0
    return typeof wc === 'string' ? parseInt(wc, 10) || 0 : Number(wc) || 0
  }

  function handleCardClick(item: CardItem) {
    // Don't navigate if we're editing synopsis
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

  function startEditing(card: CardItem, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingId(card.id)
    setEditText(card.synopsis || '')
  }

  async function saveSynopsis(cardId: string) {
    const card = cards.find(c => c.id === cardId)
    if (!card) return

    const trimmed = editText.trim()
    // Skip save if unchanged
    if (trimmed === (card.synopsis || '')) {
      setEditingId(null)
      return
    }

    setSaving(cardId)
    try {
      const collection = card._type === 'container' ? 'containers' : 'content'
      await sdk.entities.update(collection, cardId, {
        synopsis: trimmed,
        updated_at: new Date().toISOString()
      })
      // Update local state
      setCards(prev => prev.map(c =>
        c.id === cardId ? { ...c, synopsis: trimmed } : c
      ))
    } catch (error) {
      console.error('[BoardView] Failed to save synopsis:', error)
    } finally {
      setSaving(null)
      setEditingId(null)
    }
  }

  function handleSynopsisKeyDown(e: React.KeyboardEvent, cardId: string) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      saveSynopsis(cardId)
    } else if (e.key === 'Escape') {
      setEditingId(null)
    }
  }

  // --- Drag-to-reorder ---

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    // Don't drag if editing
    if (editingId) {
      e.preventDefault()
      return
    }
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    // Make the dragged card slightly transparent via the element
    const el = e.currentTarget as HTMLElement
    requestAnimationFrame(() => { el.style.opacity = '0.4' })
  }, [editingId])

  const handleDragEnter = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault()
    dragCounter.current++
    if (draggedId && draggedId !== id) {
      setDropTargetId(id)
    }
  }, [draggedId])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setDropTargetId(null)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    dragCounter.current = 0

    if (!draggedId || draggedId === targetId) {
      setDraggedId(null)
      setDropTargetId(null)
      return
    }

    const srcIdx = cards.findIndex(c => c.id === draggedId)
    const tgtIdx = cards.findIndex(c => c.id === targetId)
    if (srcIdx === -1 || tgtIdx === -1) return

    // Optimistic reorder
    const updated = [...cards]
    const moved = updated.splice(srcIdx, 1)[0]!
    updated.splice(tgtIdx, 0, moved)
    setCards(updated)
    setDraggedId(null)
    setDropTargetId(null)

    // Persist new order
    try {
      await Promise.all(
        updated.map((item, i) => {
          const collection = item._type === 'container' ? 'containers' : 'content'
          return sdk.entities.update(collection, item.id, {
            order: (i + 1) * 100,
            updated_at: new Date().toISOString()
          })
        })
      )
    } catch (error) {
      console.error('[BoardView] Failed to persist reorder:', error)
      isRoot ? loadRootData() : loadData()
    }
  }, [draggedId, cards, sdk])

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    dragCounter.current = 0
    setDraggedId(null)
    setDropTargetId(null)
    // Reset opacity
    const el = e.currentTarget as HTMLElement
    el.style.opacity = ''
  }, [])

  // --- Render ---

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="text-gray-500 dark:text-gray-400">Loading board...</div>
      </div>
    )
  }

  if (!entityId || !container) {
    return (
      <div className="p-8 text-center">
        <div className="text-gray-500 dark:text-gray-400">
          <p>Select a folder from the navigation panel to view its contents as cards.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{container.icon || '📋'}</span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {container.title}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {cards.length} {cards.length === 1 ? 'card' : 'cards'}
              {cards.length > 1 && ' · drag cards to reorder'}
            </p>
          </div>
        </div>
      </div>

      {/* Card Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {cards.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <p>No items to display.</p>
            <p className="text-sm mt-2">Use the navigation panel to add items.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {cards.map((card) => {
              const wordCount = getWordCount(card)
              const isDragged = draggedId === card.id
              const isDropTarget = dropTargetId === card.id
              const isEditing = editingId === card.id
              const isSaving = saving === card.id
              const status = card.status || 'draft'
              const statusClass = STATUS_COLORS[status] || STATUS_COLORS.draft

              return (
                <div
                  key={card.id}
                  draggable={!isEditing}
                  onDragStart={(e) => handleDragStart(e, card.id)}
                  onDragEnter={(e) => handleDragEnter(e, card.id)}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, card.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => handleCardClick(card)}
                  className={`
                    group rounded-lg border transition-all select-none
                    flex flex-col overflow-hidden
                    ${isEditing
                      ? 'border-blue-400 dark:border-blue-500 ring-1 ring-blue-200 dark:ring-blue-800 shadow-md cursor-default'
                      : isDragged
                        ? 'opacity-40 border-dashed border-gray-300 dark:border-gray-600 cursor-grabbing'
                        : isDropTarget
                          ? 'border-blue-400 dark:border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800 shadow-md cursor-grab'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm cursor-grab'
                    }
                    bg-white dark:bg-gray-800
                  `}
                >
                  {/* Card header - the "label" portion */}
                  <div className="flex items-start gap-2 px-3 pt-3 pb-2">
                    <span className="text-base shrink-0 mt-0.5">
                      {card._type === 'container' ? (card.icon || '📁') : '📝'}
                    </span>
                    <h3 className="font-medium text-gray-900 dark:text-gray-100 text-sm leading-snug line-clamp-2 flex-1">
                      {card.title}
                    </h3>
                    <span className="text-[10px] text-gray-300 dark:text-gray-600 tabular-nums shrink-0 mt-0.5">
                      {cards.indexOf(card) + 1}
                    </span>
                  </div>

                  {/* Synopsis area - the "index card lined" portion */}
                  <div
                    onClick={(e) => { if (!isEditing) startEditing(card, e) }}
                    className={`
                      flex-1 mx-2 mb-2 rounded cursor-text relative
                      transition-colors
                      ${isEditing
                        ? 'bg-white dark:bg-gray-900'
                        : 'bg-amber-50/60 dark:bg-gray-700/40 hover:bg-amber-50 dark:hover:bg-gray-700/60'
                      }
                    `}
                    style={!isEditing ? {
                      backgroundImage: `repeating-linear-gradient(
                        to bottom,
                        transparent,
                        transparent 19px,
                        rgba(180, 160, 130, 0.15) 19px,
                        rgba(180, 160, 130, 0.15) 20px
                      )`,
                      backgroundPosition: '0 8px',
                      minHeight: '80px',
                    } : { minHeight: '80px' }}
                  >
                    {isEditing ? (
                      <div onClick={(e) => e.stopPropagation()} className="h-full flex flex-col">
                        <textarea
                          ref={textareaRef}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onBlur={() => saveSynopsis(card.id)}
                          onKeyDown={(e) => handleSynopsisKeyDown(e, card.id)}
                          placeholder="Write a short synopsis..."
                          maxLength={300}
                          className="w-full flex-1 text-xs leading-[20px] text-gray-700 dark:text-gray-200 bg-transparent p-2 resize-none focus:outline-none placeholder:text-gray-400 dark:placeholder:text-gray-500"
                          style={{ minHeight: '60px' }}
                        />
                        <div className="flex items-center justify-between px-2 pb-1.5">
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">
                            {editText.length}/300
                          </span>
                          {isSaving ? (
                            <span className="text-[10px] text-blue-500">Saving...</span>
                          ) : (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">
                              Enter to save
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="p-2 h-full relative">
                        {card.synopsis ? (
                          <p className="text-xs leading-[20px] text-gray-600 dark:text-gray-400 line-clamp-4">
                            {card.synopsis}
                          </p>
                        ) : (
                          <span className="text-xs text-gray-400/70 dark:text-gray-500/70 italic">
                            Synopsis...
                          </span>
                        )}
                        {/* Pencil icon hover cue */}
                        <span className="absolute top-1.5 right-1.5 text-amber-400/0 group-hover:text-amber-400/60 dark:group-hover:text-amber-500/50 transition-colors">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" />
                          </svg>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Card footer */}
                  <div className="flex items-center gap-2 px-3 pb-2.5">
                    {card._type === 'content' && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusClass}`}>
                        {status}
                      </span>
                    )}
                    {card._type === 'container' && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 capitalize">
                        {card.type}
                      </span>
                    )}
                    {wordCount > 0 && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto tabular-nums">
                        {wordCount.toLocaleString()}w
                      </span>
                    )}
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
