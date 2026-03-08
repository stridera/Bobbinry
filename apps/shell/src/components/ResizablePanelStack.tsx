'use client'

import { useState, useEffect, useRef, ReactNode, useCallback } from 'react'
import { PanelActionsProvider } from '@bobbinry/sdk'

interface PanelConfig {
  id: string
  title: string
  content: ReactNode
}

interface ResizablePanelStackProps {
  panels: PanelConfig[]
  slotId: string
  singlePanel?: boolean
}

interface PanelState {
  sizes: number[]  // Heights as percentages
  collapsed: boolean[]
  order: string[]  // Panel IDs in display order
}

const MIN_PANEL_HEIGHT = 100
const HEADER_HEIGHT = 40
const DIVIDER_HEIGHT = 4

// Small chevron SVG icons
function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronUp({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 7.5L6 4.5L9 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GripDots({ className }: { className?: string }) {
  return (
    <svg className={className} width="8" height="14" viewBox="0 0 8 14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <circle cx="2" cy="2" r="1.2" />
      <circle cx="6" cy="2" r="1.2" />
      <circle cx="2" cy="7" r="1.2" />
      <circle cx="6" cy="7" r="1.2" />
      <circle cx="2" cy="12" r="1.2" />
      <circle cx="6" cy="12" r="1.2" />
    </svg>
  )
}

function reconcileOrder(savedOrder: string[], panels: PanelConfig[]): string[] {
  const panelIds = new Set(panels.map(p => p.id))
  // Keep saved IDs that still exist, in saved order
  const kept = savedOrder.filter(id => panelIds.has(id))
  const keptSet = new Set(kept)
  // Append any new panels not in saved order
  const newIds = panels.filter(p => !keptSet.has(p.id)).map(p => p.id)
  return [...kept, ...newIds]
}

export function ResizablePanelStack({ panels, slotId, singlePanel }: ResizablePanelStackProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const actionsRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const actionsCallbacks = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map())
  const [actionsTargets, setActionsTargets] = useState<Map<string, HTMLElement>>(new Map())
  const [containerHeight, setContainerHeight] = useState(600)
  const [panelState, setPanelState] = useState<PanelState>(() => {
    const saved = localStorage.getItem(`panelLayout:${slotId}`)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        const order = reconcileOrder(parsed.order || [], panels)
        if (parsed.sizes?.length === panels.length && parsed.collapsed?.length === panels.length) {
          return { ...parsed, order }
        }
      } catch (e) {
        console.warn('Failed to parse saved panel layout:', e)
      }
    }

    const defaultSize = 100 / panels.length
    return {
      sizes: panels.map(() => defaultSize),
      collapsed: panels.map(() => false),
      order: panels.map(p => p.id)
    }
  })

  const [dragging, setDragging] = useState<{ index: number; startY: number; startSizes: number[] } | null>(null)
  const [reorderDrag, setReorderDrag] = useState<{ sourceIndex: number } | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  // Get panels in display order
  const orderedPanels = panelState.order
    .map(id => panels.find(p => p.id === id))
    .filter((p): p is PanelConfig => p != null)

  // Sync order when panels change
  const panelIds = panels.map(p => p.id).join(',')
  useEffect(() => {
    const newOrder = reconcileOrder(panelState.order, panels)
    if (JSON.stringify(newOrder) !== JSON.stringify(panelState.order)) {
      setPanelState(prev => ({ ...prev, order: newOrder }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelIds])

  // Measure container height
  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.getBoundingClientRect().height)
      }
    }
    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  // Save state to localStorage
  useEffect(() => {
    localStorage.setItem(`panelLayout:${slotId}`, JSON.stringify(panelState))
  }, [panelState, slotId])

  // Handle resize drag
  useEffect(() => {
    if (!dragging || !containerRef.current) return

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      const cHeight = containerRect.height
      const deltaY = e.clientY - dragging.startY

      const newSizes = [...dragging.startSizes]
      const index = dragging.index

      const allHeaders = orderedPanels.length * HEADER_HEIGHT
      const available = cHeight - allHeaders - (orderedPanels.length - 1) * DIVIDER_HEIGHT

      const currentPx = ((dragging.startSizes[index] ?? 0) / 100) * available
      const nextPx = ((dragging.startSizes[index + 1] ?? 0) / 100) * available

      const newCurrentPx = Math.max(MIN_PANEL_HEIGHT, currentPx + deltaY)
      const newNextPx = Math.max(MIN_PANEL_HEIGHT, nextPx - deltaY)

      newSizes[index] = (newCurrentPx / available) * 100
      newSizes[index + 1] = (newNextPx / available) * 100

      setPanelState(prev => ({ ...prev, sizes: newSizes }))
    }

    const handleMouseUp = () => setDragging(null)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, panelState.collapsed, orderedPanels.length])

  const handleDividerMouseDown = (index: number, e: React.MouseEvent) => {
    e.preventDefault()
    setDragging({ index, startY: e.clientY, startSizes: [...panelState.sizes] })
  }

  const toggleCollapse = (index: number) => {
    setPanelState(prev => ({
      ...prev,
      collapsed: prev.collapsed.map((c, i) => i === index ? !c : c)
    }))
  }

  // Drag-to-reorder handlers
  const handleDragStart = useCallback((index: number, e: React.DragEvent) => {
    setReorderDrag({ sourceIndex: index })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    // Use a transparent drag image so the browser default doesn't look weird
    const el = e.currentTarget as HTMLElement
    e.dataTransfer.setDragImage(el, el.offsetWidth / 2, HEADER_HEIGHT / 2)
  }, [])

  const handleDragOver = useCallback((index: number, e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (reorderDrag && reorderDrag.sourceIndex !== index) {
      setDropTarget(index)
    }
  }, [reorderDrag])

  const handleDragLeave = useCallback(() => {
    setDropTarget(null)
  }, [])

  const handleDrop = useCallback((targetIndex: number, e: React.DragEvent) => {
    e.preventDefault()
    setDropTarget(null)
    if (!reorderDrag || reorderDrag.sourceIndex === targetIndex) {
      setReorderDrag(null)
      return
    }

    const srcIdx = reorderDrag.sourceIndex
    setPanelState(prev => {
      const newOrder = [...prev.order]
      const newSizes = [...prev.sizes]
      const newCollapsed = [...prev.collapsed]

      // Move panel from srcIdx to targetIndex
      const movedId = newOrder.splice(srcIdx, 1)[0]!
      const movedSize = newSizes.splice(srcIdx, 1)[0]!
      const movedCollapsed = newCollapsed.splice(srcIdx, 1)[0]!
      newOrder.splice(targetIndex, 0, movedId)
      newSizes.splice(targetIndex, 0, movedSize)
      newCollapsed.splice(targetIndex, 0, movedCollapsed)

      return { sizes: newSizes, collapsed: newCollapsed, order: newOrder }
    })
    setReorderDrag(null)
  }, [reorderDrag])

  const handleDragEnd = useCallback(() => {
    setReorderDrag(null)
    setDropTarget(null)
  }, [])

  // Returns a stable ref callback per panel ID so React doesn't re-fire null→element on re-renders
  const getActionsRef = useCallback((panelId: string) => {
    let cb = actionsCallbacks.current.get(panelId)
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        if (el) {
          actionsRefs.current.set(panelId, el)
        } else {
          actionsRefs.current.delete(panelId)
        }
        setActionsTargets(new Map(actionsRefs.current))
      }
      actionsCallbacks.current.set(panelId, cb)
    }
    return cb
  }, [])

  // Calculate heights — subtract ALL headers (every panel shows its header regardless of collapsed state)
  const allHeadersHeight = orderedPanels.length * HEADER_HEIGHT
  const dividersHeightTotal = (orderedPanels.length - 1) * DIVIDER_HEIGHT
  const availableHeight = containerHeight - allHeadersHeight - dividersHeightTotal

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {orderedPanels.map((panel, index) => {
        const isCollapsed = panelState.collapsed[index]
        const heightPercent = panelState.sizes[index] || 100 / orderedPanels.length
        const heightPx = isCollapsed ? HEADER_HEIGHT : (heightPercent / 100) * availableHeight + HEADER_HEIGHT
        const isDragOver = dropTarget === index && reorderDrag?.sourceIndex !== index
        const isDragSource = reorderDrag?.sourceIndex === index

        return (
          <div key={panel.id}>
            {/* Panel */}
            <div
              style={{ height: `${heightPx}px` }}
              className={`flex flex-col border-b border-gray-200 dark:border-gray-600 ${isDragSource ? 'opacity-50' : ''}`}
            >
              {/* Header */}
              <div
                className={`flex items-center gap-1.5 px-2 h-10 border-b border-gray-200 dark:border-gray-600 select-none transition-colors
                  ${singlePanel
                    ? 'bg-gray-50 dark:bg-gray-700'
                    : `cursor-pointer ${isDragOver
                      ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-400 dark:border-blue-500'
                      : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`
                  }`}
                draggable={!singlePanel}
                onDragStart={singlePanel ? undefined : (e) => handleDragStart(index, e)}
                onDragOver={singlePanel ? undefined : (e) => handleDragOver(index, e)}
                onDragLeave={singlePanel ? undefined : handleDragLeave}
                onDrop={singlePanel ? undefined : (e) => handleDrop(index, e)}
                onDragEnd={singlePanel ? undefined : handleDragEnd}
                onClick={singlePanel ? undefined : () => toggleCollapse(index)}
              >
                {!singlePanel && (
                  <span className="text-gray-300 dark:text-gray-500 cursor-grab active:cursor-grabbing flex-shrink-0">
                    <GripDots />
                  </span>
                )}
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{panel.title}</span>
                {/* Portal target for panel actions */}
                <div
                  ref={getActionsRef(panel.id)}
                  className="flex items-center gap-1 flex-1 justify-end"
                  onClick={(e) => e.stopPropagation()}
                />
                {!singlePanel && (
                  <button
                    className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0 p-0.5"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleCollapse(index)
                    }}
                  >
                    {isCollapsed ? <ChevronDown /> : <ChevronUp />}
                  </button>
                )}
              </div>

              {/* Content */}
              {!isCollapsed && (
                <div className="flex-1 overflow-hidden">
                  <PanelActionsProvider value={actionsTargets.get(panel.id) || null}>
                    {panel.content}
                  </PanelActionsProvider>
                </div>
              )}
            </div>

            {/* Divider (except after last panel) */}
            {!singlePanel && index < orderedPanels.length - 1 && !panelState.collapsed[index] && !panelState.collapsed[index + 1] && (
              <div
                className="h-1 bg-gray-200 dark:bg-gray-600 hover:bg-blue-400 dark:hover:bg-blue-500 cursor-row-resize active:bg-blue-500 transition-colors"
                onMouseDown={(e) => handleDividerMouseDown(index, e)}
                style={{ height: `${DIVIDER_HEIGHT}px` }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
