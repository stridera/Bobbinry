'use client'

import { useState, useEffect, useRef, ReactNode, useCallback, useMemo } from 'react'
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
  defaultVisibleCount?: number
}

interface PanelState {
  sizes: number[]
  collapsed: boolean[]
  order: string[]
  hidden: string[]
}

const MIN_PANEL_HEIGHT = 100
const HEADER_HEIGHT = 40
const DIVIDER_HEIGHT = 4

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
  const kept = savedOrder.filter(id => panelIds.has(id))
  const keptSet = new Set(kept)
  const newIds = panels.filter(p => !keptSet.has(p.id)).map(p => p.id)
  return [...kept, ...newIds]
}

function createDefaultPanelState(panels: PanelConfig[], defaultVisibleCount?: number): PanelState {
  const order = panels.map(panel => panel.id)
  const totalPanels = order.length || 1
  const visibleTarget = Math.max(1, Math.min(defaultVisibleCount ?? totalPanels, totalPanels))
  const defaultSize = 100 / visibleTarget

  return {
    sizes: order.map(() => defaultSize),
    collapsed: order.map(() => false),
    order,
    hidden: defaultVisibleCount ? order.slice(defaultVisibleCount) : [],
  }
}

function reconcilePanelState(
  previous: PanelState,
  panels: PanelConfig[],
  defaultVisibleCount?: number
): PanelState {
  const nextOrder = reconcileOrder(previous.order || [], panels)
  const defaultState = createDefaultPanelState(panels, defaultVisibleCount)
  const previousOrderSet = new Set(previous.order || [])
  const hiddenSet = new Set((previous.hidden || []).filter(id => nextOrder.includes(id)))
  const hadSavedHiddenState = Array.isArray(previous.hidden)
  const defaultSize = defaultState.sizes[0] || 100

  if (!hadSavedHiddenState && defaultVisibleCount && nextOrder.length > defaultVisibleCount) {
    nextOrder.slice(defaultVisibleCount).forEach(id => hiddenSet.add(id))
  }

  if (hadSavedHiddenState && defaultVisibleCount) {
    let visibleCount = nextOrder.filter(id => !hiddenSet.has(id)).length
    nextOrder
      .filter(id => !previousOrderSet.has(id))
      .forEach(id => {
        if (visibleCount >= defaultVisibleCount) {
          hiddenSet.add(id)
        } else {
          visibleCount += 1
        }
      })
  }

  return {
    order: nextOrder,
    sizes: nextOrder.map((_, index) => previous.sizes?.[index] ?? defaultSize),
    collapsed: nextOrder.map((_, index) => previous.collapsed?.[index] ?? false),
    hidden: Array.from(hiddenSet),
  }
}

function normalizeSizes(values: number[]): number[] {
  if (values.length === 0) return []
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0)
  if (total <= 0) {
    return values.map(() => 100 / values.length)
  }
  return values.map(value => (Math.max(value, 0) / total) * 100)
}

function isSamePanelState(left: PanelState, right: PanelState): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function ResizablePanelStack({
  panels,
  slotId,
  singlePanel,
  defaultVisibleCount,
}: ResizablePanelStackProps) {
  const listContainerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const actionsRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const actionsCallbacks = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map())
  const [actionsTargets, setActionsTargets] = useState<Map<string, HTMLElement>>(new Map())
  const [containerHeight, setContainerHeight] = useState(600)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [panelState, setPanelState] = useState<PanelState>(() => {
    if (typeof window === 'undefined') {
      return createDefaultPanelState(panels, defaultVisibleCount)
    }

    const saved = localStorage.getItem(`panelLayout:${slotId}`)
    if (!saved) {
      return createDefaultPanelState(panels, defaultVisibleCount)
    }

    try {
      const parsed = JSON.parse(saved)
      return reconcilePanelState(parsed, panels, defaultVisibleCount)
    } catch (error) {
      console.warn('Failed to parse saved panel layout:', error)
      return createDefaultPanelState(panels, defaultVisibleCount)
    }
  })

  const orderedPanels = useMemo(() => {
    return panelState.order
      .map((id, orderIndex) => {
        const panel = panels.find(candidate => candidate.id === id)
        return panel ? { panel, orderIndex } : null
      })
      .filter((item): item is { panel: PanelConfig; orderIndex: number } => item != null)
  }, [panelState.order, panels])

  const hiddenSet = useMemo(() => new Set(panelState.hidden), [panelState.hidden])
  const visiblePanels = useMemo(
    () => orderedPanels.filter(item => !hiddenSet.has(item.panel.id)),
    [orderedPanels, hiddenSet]
  )
  const visibleSizes = useMemo(
    () => normalizeSizes(visiblePanels.map(item => panelState.sizes[item.orderIndex] ?? 0)),
    [visiblePanels, panelState.sizes]
  )

  const effectiveSinglePanel = singlePanel || visiblePanels.length <= 1
  const [dragging, setDragging] = useState<{ index: number; startY: number; startSizes: number[] } | null>(null)
  const [reorderDrag, setReorderDrag] = useState<{ sourceIndex: number } | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  const panelIds = panels.map(panel => panel.id).join(',')
  useEffect(() => {
    setPanelState(previous => {
      const next = reconcilePanelState(previous, panels, defaultVisibleCount)
      return isSamePanelState(previous, next) ? previous : next
    })
  }, [panelIds, defaultVisibleCount, panels])

  useEffect(() => {
    const updateHeight = () => {
      if (listContainerRef.current) {
        setContainerHeight(listContainerRef.current.getBoundingClientRect().height)
      }
    }

    updateHeight()
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  useEffect(() => {
    localStorage.setItem(`panelLayout:${slotId}`, JSON.stringify(panelState))
  }, [panelState, slotId])

  useEffect(() => {
    if (!isMenuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isMenuOpen])

  useEffect(() => {
    if (!dragging || !listContainerRef.current || visiblePanels.length < 2) return

    const handleMouseMove = (event: MouseEvent) => {
      const container = listContainerRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      const available =
        containerRect.height -
        visiblePanels.length * HEADER_HEIGHT -
        (visiblePanels.length - 1) * DIVIDER_HEIGHT

      const deltaY = event.clientY - dragging.startY
      const nextVisibleSizes = [...dragging.startSizes]
      const currentPx = ((dragging.startSizes[dragging.index] ?? 0) / 100) * available
      const nextPx = ((dragging.startSizes[dragging.index + 1] ?? 0) / 100) * available
      const newCurrentPx = Math.max(MIN_PANEL_HEIGHT, currentPx + deltaY)
      const newNextPx = Math.max(MIN_PANEL_HEIGHT, nextPx - deltaY)

      nextVisibleSizes[dragging.index] = (newCurrentPx / available) * 100
      nextVisibleSizes[dragging.index + 1] = (newNextPx / available) * 100

      const normalized = normalizeSizes(nextVisibleSizes)
      setPanelState(previous => {
        const sizes = [...previous.sizes]
        visiblePanels.forEach((item, index) => {
          sizes[item.orderIndex] = normalized[index] ?? sizes[item.orderIndex] ?? 0
        })
        return { ...previous, sizes }
      })
    }

    const handleMouseUp = () => setDragging(null)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, visiblePanels])

  const handleDividerMouseDown = (index: number, event: React.MouseEvent) => {
    event.preventDefault()
    setDragging({ index, startY: event.clientY, startSizes: [...visibleSizes] })
  }

  const toggleCollapse = (index: number) => {
    const panel = visiblePanels[index]
    if (!panel) return

    setPanelState(previous => {
      const collapsed = [...previous.collapsed]
      collapsed[panel.orderIndex] = !collapsed[panel.orderIndex]
      return { ...previous, collapsed }
    })
  }

  const toggleHidden = (panelId: string) => {
    setPanelState(previous => {
      const nextHidden = new Set(previous.hidden)
      if (nextHidden.has(panelId)) {
        nextHidden.delete(panelId)
      } else {
        nextHidden.add(panelId)
      }
      return { ...previous, hidden: Array.from(nextHidden) }
    })
  }

  const resetLayout = () => {
    setPanelState(createDefaultPanelState(panels, defaultVisibleCount))
    setIsMenuOpen(false)
  }

  const showAllPanels = () => {
    setPanelState(previous => ({ ...previous, hidden: [] }))
  }

  const handleDragStart = useCallback((index: number, event: React.DragEvent) => {
    setReorderDrag({ sourceIndex: index })
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
    const element = event.currentTarget as HTMLElement
    event.dataTransfer.setDragImage(element, element.offsetWidth / 2, HEADER_HEIGHT / 2)
  }, [])

  const handleDragOver = useCallback((index: number, event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (reorderDrag && reorderDrag.sourceIndex !== index) {
      setDropTarget(index)
    }
  }, [reorderDrag])

  const handleDragLeave = useCallback(() => {
    setDropTarget(null)
  }, [])

  const handleDrop = useCallback((targetIndex: number, event: React.DragEvent) => {
    event.preventDefault()
    setDropTarget(null)

    if (!reorderDrag || reorderDrag.sourceIndex === targetIndex) {
      setReorderDrag(null)
      return
    }

    const sourcePanel = visiblePanels[reorderDrag.sourceIndex]
    const targetPanel = visiblePanels[targetIndex]
    if (!sourcePanel || !targetPanel) {
      setReorderDrag(null)
      return
    }

    setPanelState(previous => {
      const order = [...previous.order]
      const sizes = [...previous.sizes]
      const collapsed = [...previous.collapsed]

      const movedId = order.splice(sourcePanel.orderIndex, 1)[0]
      const movedSize = sizes.splice(sourcePanel.orderIndex, 1)[0]
      const movedCollapsed = collapsed.splice(sourcePanel.orderIndex, 1)[0]

      if (!movedId) return previous

      order.splice(targetPanel.orderIndex, 0, movedId)
      sizes.splice(targetPanel.orderIndex, 0, movedSize ?? 0)
      collapsed.splice(targetPanel.orderIndex, 0, movedCollapsed ?? false)

      return { ...previous, order, sizes, collapsed }
    })

    setReorderDrag(null)
  }, [reorderDrag, visiblePanels])

  const handleDragEnd = useCallback(() => {
    setReorderDrag(null)
    setDropTarget(null)
  }, [])

  const getActionsRef = useCallback((panelId: string) => {
    let callback = actionsCallbacks.current.get(panelId)
    if (!callback) {
      callback = (element: HTMLDivElement | null) => {
        if (element) {
          actionsRefs.current.set(panelId, element)
        } else {
          actionsRefs.current.delete(panelId)
        }
        setActionsTargets(new Map(actionsRefs.current))
      }
      actionsCallbacks.current.set(panelId, callback)
    }
    return callback
  }, [])

  const allHeadersHeight = visiblePanels.length * HEADER_HEIGHT
  const dividersHeightTotal = Math.max(0, visiblePanels.length - 1) * DIVIDER_HEIGHT
  const availableHeight = Math.max(0, containerHeight - allHeadersHeight - dividersHeightTotal)
  const hiddenCount = panels.length - visiblePanels.length
  const showManagementBar = panels.length > 1 || hiddenCount > 0

  return (
    <div className="flex h-full flex-col">
      {showManagementBar ? (
        <div className="relative border-b border-gray-200 bg-gray-50 px-2 py-1.5 dark:border-gray-700 dark:bg-gray-800/80" ref={menuRef}>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIsMenuOpen(open => !open)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100"
            >
              Panels
              <span className="text-gray-400 dark:text-gray-500">{visiblePanels.length}/{panels.length}</span>
              {isMenuOpen ? <ChevronUp /> : <ChevronDown />}
            </button>
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={showAllPanels}
                className="text-xs text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Show hidden ({hiddenCount})
              </button>
            ) : null}
          </div>

          {isMenuOpen ? (
            <div className="absolute left-2 right-2 top-full z-20 mt-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                Visible Panels
              </div>
              <div className="space-y-1">
                {orderedPanels.map(item => {
                  const isVisible = !hiddenSet.has(item.panel.id)
                  return (
                    <label
                      key={item.panel.id}
                      className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      <span className="truncate">{item.panel.title}</span>
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={() => toggleHidden(item.panel.id)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                    </label>
                  )
                })}
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 dark:border-gray-700">
                <button
                  type="button"
                  onClick={showAllPanels}
                  className="text-xs text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  Show all
                </button>
                <button
                  type="button"
                  onClick={resetLayout}
                  className="text-xs text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  Reset layout
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div ref={listContainerRef} className="flex h-full flex-1 flex-col">
        {visiblePanels.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">No panels shown</div>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              Use the panel menu to show the bobbin panels you want in this slot.
            </p>
            <button
              type="button"
              onClick={() => setIsMenuOpen(true)}
              className="mt-4 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Choose panels
            </button>
          </div>
        ) : (
          // eslint-disable-next-line react-hooks/refs -- getActionsRef is a stable ref-callback factory, not reading mutable state for render
          visiblePanels.map((item, index) => {
            const isCollapsed = panelState.collapsed[item.orderIndex]
            const heightPercent = visibleSizes[index] || 100 / visiblePanels.length
            const heightPx = isCollapsed ? HEADER_HEIGHT : (heightPercent / 100) * availableHeight + HEADER_HEIGHT
            const isDragOver = dropTarget === index && reorderDrag?.sourceIndex !== index
            const isDragSource = reorderDrag?.sourceIndex === index
            const nextVisiblePanel = visiblePanels[index + 1]

            return (
              <div key={item.panel.id}>
                <div
                  style={{ height: `${heightPx}px` }}
                  className={`flex flex-col border-b border-gray-200 dark:border-gray-600 ${isDragSource ? 'opacity-50' : ''}`}
                >
                  <div
                    className={`flex h-10 items-center gap-1.5 border-b border-gray-200 px-2 transition-colors select-none dark:border-gray-600 ${
                      effectiveSinglePanel
                        ? 'bg-gray-50 dark:bg-gray-700'
                        : `cursor-pointer ${
                            isDragOver
                              ? 'border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/30'
                              : 'bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600'
                          }`
                    }`}
                    draggable={!effectiveSinglePanel}
                    onDragStart={effectiveSinglePanel ? undefined : event => handleDragStart(index, event)}
                    onDragOver={effectiveSinglePanel ? undefined : event => handleDragOver(index, event)}
                    onDragLeave={effectiveSinglePanel ? undefined : handleDragLeave}
                    onDrop={effectiveSinglePanel ? undefined : event => handleDrop(index, event)}
                    onDragEnd={effectiveSinglePanel ? undefined : handleDragEnd}
                    onClick={effectiveSinglePanel ? undefined : () => toggleCollapse(index)}
                  >
                    {!effectiveSinglePanel ? (
                      <span className="flex-shrink-0 cursor-grab text-gray-300 active:cursor-grabbing dark:text-gray-500">
                        <GripDots />
                      </span>
                    ) : null}
                    <span className="truncate text-sm font-medium text-gray-700 dark:text-gray-200">
                      {item.panel.title}
                    </span>
                    <div
                      ref={getActionsRef(item.panel.id)}
                      className="flex flex-1 items-center justify-end gap-1"
                      onClick={event => event.stopPropagation()}
                    />
                    {panels.length > 1 ? (
                      <button
                        type="button"
                        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-600 dark:hover:text-gray-200"
                        onClick={event => {
                          event.stopPropagation()
                          toggleHidden(item.panel.id)
                        }}
                        title="Hide panel"
                        aria-label={`Hide ${item.panel.title}`}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    ) : null}
                    {!effectiveSinglePanel ? (
                      <button
                        type="button"
                        className="flex-shrink-0 p-0.5 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                        onClick={event => {
                          event.stopPropagation()
                          toggleCollapse(index)
                        }}
                      >
                        {isCollapsed ? <ChevronDown /> : <ChevronUp />}
                      </button>
                    ) : null}
                  </div>

                  {!isCollapsed ? (
                    <div className="flex-1 overflow-hidden">
                      <PanelActionsProvider value={actionsTargets.get(item.panel.id) || null}>
                        {item.panel.content}
                      </PanelActionsProvider>
                    </div>
                  ) : null}
                </div>

                {!effectiveSinglePanel && nextVisiblePanel && !panelState.collapsed[item.orderIndex] && !panelState.collapsed[nextVisiblePanel.orderIndex] ? (
                  <div
                    className="h-1 cursor-row-resize bg-gray-200 transition-colors hover:bg-blue-400 active:bg-blue-500 dark:bg-gray-600 dark:hover:bg-blue-500"
                    onMouseDown={event => handleDividerMouseDown(index, event)}
                    style={{ height: `${DIVIDER_HEIGHT}px` }}
                  />
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
