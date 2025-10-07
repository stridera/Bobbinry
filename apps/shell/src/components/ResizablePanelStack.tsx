'use client'

import { useState, useEffect, useRef, ReactNode } from 'react'

interface PanelConfig {
  id: string
  title: string
  content: ReactNode
}

interface ResizablePanelStackProps {
  panels: PanelConfig[]
  slotId: string
}

interface PanelState {
  sizes: number[]  // Heights as percentages
  collapsed: boolean[]
}

const MIN_PANEL_HEIGHT = 100
const HEADER_HEIGHT = 40
const DIVIDER_HEIGHT = 4

export function ResizablePanelStack({ panels, slotId }: ResizablePanelStackProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(600)
  const [panelState, setPanelState] = useState<PanelState>(() => {
    // Try to load saved state from localStorage
    const saved = localStorage.getItem(`panelLayout:${slotId}`)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        // Validate that saved state matches current panels
        if (parsed.sizes?.length === panels.length && parsed.collapsed?.length === panels.length) {
          return parsed
        }
      } catch (e) {
        console.warn('Failed to parse saved panel layout:', e)
      }
    }

    // Default: equal sizes, all expanded
    const defaultSize = 100 / panels.length
    return {
      sizes: panels.map(() => defaultSize),
      collapsed: panels.map(() => false)
    }
  })

  const [dragging, setDragging] = useState<{ index: number; startY: number; startSizes: number[] } | null>(null)

  // Measure container height on mount and when window resizes
  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.getBoundingClientRect().height)
      }
    }

    // Initial measurement
    updateHeight()

    // Update on resize
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  // Save state to localStorage when it changes
  useEffect(() => {
    localStorage.setItem(`panelLayout:${slotId}`, JSON.stringify(panelState))
  }, [panelState, slotId])

  // Handle mouse move during drag
  useEffect(() => {
    if (!dragging || !containerRef.current) return

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      const containerHeight = containerRect.height
      const deltaY = e.clientY - dragging.startY
      const deltaPercent = (deltaY / containerHeight) * 100

      // Calculate new sizes
      const newSizes = [...dragging.startSizes]
      const index = dragging.index

      // Get collapsed panels info
      const collapsedHeightTotal = panelState.collapsed.reduce((sum, isCollapsed) =>
        sum + (isCollapsed ? HEADER_HEIGHT : 0), 0
      )
      const availableHeight = containerHeight - collapsedHeightTotal - (panels.length - 1) * DIVIDER_HEIGHT

      // Adjust sizes of adjacent panels
      const currentHeightPx = ((dragging.startSizes[index] ?? 0) / 100) * availableHeight
      const nextHeightPx = ((dragging.startSizes[index + 1] ?? 0) / 100) * availableHeight

      const newCurrentHeightPx = Math.max(MIN_PANEL_HEIGHT, currentHeightPx + deltaY)
      const newNextHeightPx = Math.max(MIN_PANEL_HEIGHT, nextHeightPx - deltaY)

      // Convert back to percentages
      newSizes[index] = (newCurrentHeightPx / availableHeight) * 100
      newSizes[index + 1] = (newNextHeightPx / availableHeight) * 100

      setPanelState(prev => ({ ...prev, sizes: newSizes }))
    }

    const handleMouseUp = () => {
      setDragging(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, panelState.collapsed, panels.length])

  const handleDividerMouseDown = (index: number, e: React.MouseEvent) => {
    e.preventDefault()
    setDragging({
      index,
      startY: e.clientY,
      startSizes: [...panelState.sizes]
    })
  }

  const toggleCollapse = (index: number) => {
    setPanelState(prev => ({
      ...prev,
      collapsed: prev.collapsed.map((c, i) => i === index ? !c : c)
    }))
  }

  // Calculate actual heights in pixels
  const collapsedHeightTotal = panelState.collapsed.reduce((sum, isCollapsed) =>
    sum + (isCollapsed ? HEADER_HEIGHT : 0), 0
  )
  const dividersHeightTotal = (panels.length - 1) * DIVIDER_HEIGHT
  const availableHeight = containerHeight - collapsedHeightTotal - dividersHeightTotal

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {panels.map((panel, index) => {
        const isCollapsed = panelState.collapsed[index]
        const heightPercent = panelState.sizes[index] || 100 / panels.length
        const heightPx = isCollapsed ? HEADER_HEIGHT : (heightPercent / 100) * availableHeight + HEADER_HEIGHT

        return (
          <div key={panel.id}>
            {/* Panel */}
            <div
              style={{ height: `${heightPx}px` }}
              className="flex flex-col border-b border-gray-200"
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-3 h-10 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                onClick={() => toggleCollapse(index)}
              >
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{panel.title}</span>
                <button
                  className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleCollapse(index)
                  }}
                >
                  {isCollapsed ? '▼' : '▲'}
                </button>
              </div>

              {/* Content */}
              {!isCollapsed && (
                <div className="flex-1 overflow-hidden">
                  {panel.content}
                </div>
              )}
            </div>

            {/* Divider (except after last panel) */}
            {index < panels.length - 1 && !panelState.collapsed[index] && !panelState.collapsed[index + 1] && (
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
