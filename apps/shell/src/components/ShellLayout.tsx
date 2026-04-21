'use client'

import { ReactNode, useState, useMemo, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { ExtensionSlot } from './ExtensionSlot'
import { UserMenu } from './UserMenu'
import { BobbinManagerPopover } from './bobbins'

const DEFAULT_LEFT_WIDTH = 256   // current w-64
const DEFAULT_RIGHT_WIDTH = 320  // current w-80
const MIN_PANEL_WIDTH = 200
const MAX_PANEL_WIDTH = 600
const RESIZE_HANDLE_WIDTH = 4

interface InstalledBobbin {
  id: string
  version: string
  manifest: {
    name: string
    description?: string
  }
  installedAt: string
}

interface ShellLayoutProps {
  children: ReactNode
  currentView?: string
  context?: any
  onOpenMarketplace?: (slot?: string) => void
  projectId?: string | undefined
  projectName?: string | undefined
  user?: { id: string; email: string; name?: string | null } | undefined
  installedBobbins?: InstalledBobbin[]
}

function EmptySlotFallback({
  icon,
  title,
  description,
  onAction
}: {
  icon: ReactNode
  title: string
  description: string
  onAction?: (() => void) | undefined
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 text-center">
      <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700/50 flex items-center justify-center mb-3 text-gray-400 dark:text-gray-500">
        {icon}
      </div>
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{title}</p>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-4 max-w-[180px] leading-relaxed">{description}</p>
      {onAction && (
        <button
          onClick={onAction}
          className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          Browse Bobbins &rarr;
        </button>
      )}
    </div>
  )
}

export function ShellLayout({ children, currentView = 'default', context = {}, onOpenMarketplace, projectId, projectName, user, installedBobbins = [] }: ShellLayoutProps) {
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const [dynamicContext, setDynamicContext] = useState<Record<string, any>>({})
  const [focusMode, setFocusMode] = useState(false)
  const [showFocusHint, setShowFocusHint] = useState(false)
  const focusModeRef = useRef(false)

  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_LEFT_WIDTH
    const saved = localStorage.getItem('shellPanelWidth:left')
    return saved ? Number(saved) : DEFAULT_LEFT_WIDTH
  })
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_RIGHT_WIDTH
    const saved = localStorage.getItem('shellPanelWidth:right')
    return saved ? Number(saved) : DEFAULT_RIGHT_WIDTH
  })
  const [resizingPanel, setResizingPanel] = useState<'left' | 'right' | null>(null)
  const resizeDragRef = useRef<{ side: 'left' | 'right'; startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    // Restore persisted collapsed state before flipping isHydrated so the
    // panels render in their saved positions on the first client paint.
    const leftSaved = localStorage.getItem('shellPanelCollapsed:left')
    const rightSaved = localStorage.getItem('shellPanelCollapsed:right')
    /* eslint-disable react-hooks/set-state-in-effect -- hydration bridge */
    if (leftSaved === 'true') setLeftPanelCollapsed(true)
    if (rightSaved === 'true') setRightPanelCollapsed(true)
    setIsHydrated(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  // Persist panel widths
  useEffect(() => {
    localStorage.setItem('shellPanelWidth:left', String(leftPanelWidth))
  }, [leftPanelWidth])
  useEffect(() => {
    localStorage.setItem('shellPanelWidth:right', String(rightPanelWidth))
  }, [rightPanelWidth])

  // Persist panel collapsed state (gated on isHydrated so we don't stomp
  // the stored value with the default `false` during the initial render).
  useEffect(() => {
    if (!isHydrated) return
    localStorage.setItem('shellPanelCollapsed:left', String(leftPanelCollapsed))
  }, [leftPanelCollapsed, isHydrated])
  useEffect(() => {
    if (!isHydrated) return
    localStorage.setItem('shellPanelCollapsed:right', String(rightPanelCollapsed))
  }, [rightPanelCollapsed, isHydrated])

  // Drag handler
  useEffect(() => {
    if (!resizingPanel) return

    const handleMouseMove = (e: MouseEvent) => {
      const drag = resizeDragRef.current
      if (!drag) return
      const maxWidth = Math.min(MAX_PANEL_WIDTH, window.innerWidth * 0.5)
      if (drag.side === 'left') {
        const delta = e.clientX - drag.startX
        setLeftPanelWidth(Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, drag.startWidth + delta)))
      } else {
        const delta = drag.startX - e.clientX // inverted for right panel
        setRightPanelWidth(Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, drag.startWidth + delta)))
      }
    }

    const handleMouseUp = () => {
      setResizingPanel(null)
      resizeDragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [resizingPanel])

  const handleResizeMouseDown = useCallback((side: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault()
    resizeDragRef.current = {
      side,
      startX: e.clientX,
      startWidth: side === 'left' ? leftPanelWidth : rightPanelWidth
    }
    setResizingPanel(side)
  }, [leftPanelWidth, rightPanelWidth])

  const handleResizeDoubleClick = useCallback((side: 'left' | 'right') => {
    if (side === 'left') setLeftPanelWidth(DEFAULT_LEFT_WIDTH)
    else setRightPanelWidth(DEFAULT_RIGHT_WIDTH)
  }, [])

  useEffect(() => {
    const handleViewContextChange = (event: Event) => {
      const customEvent = event as CustomEvent<Record<string, any>>
      setDynamicContext(prev => ({ ...prev, ...customEvent.detail }))
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('bobbinry:view-context-change', handleViewContextChange)
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('bobbinry:view-context-change', handleViewContextChange)
      }
    }
  }, [])

  // Keep focus mode ref in sync
  useEffect(() => {
    focusModeRef.current = focusMode
  }, [focusMode])

  // Focus mode keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        setFocusMode(prev => !prev)
      }
      if (e.key === 'Escape' && focusModeRef.current) {
        setFocusMode(false)
      }
    }

    const handleRequestFocusMode = (event: Event) => {
      const detail = (event as CustomEvent).detail
      setFocusMode(detail?.active ?? true)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('bobbinry:request-focus-mode', handleRequestFocusMode)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('bobbinry:request-focus-mode', handleRequestFocusMode)
    }
  }, [])

  // Broadcast focus mode changes
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('bobbinry:focus-mode-change', { detail: { active: focusMode } }))
    if (focusMode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- broadcast side-effect
      setShowFocusHint(true)
      const timeout = setTimeout(() => setShowFocusHint(false), 4000)
      return () => clearTimeout(timeout)
    }
    setShowFocusHint(false)
    return undefined
  }, [focusMode])

  const shellContext = useMemo(() => ({
    currentView: dynamicContext.currentView || currentView,
    ...context,
    ...dynamicContext
  }), [currentView, context, dynamicContext])

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* Top Bar */}
      <header className={`bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-3 gap-1 transition-all duration-300 ${focusMode ? 'h-0 border-b-0 opacity-0 overflow-hidden' : 'h-12'}`}>
        {/* Left: navigation + breadcrumb */}
        <div className="flex items-center gap-1 min-w-0">
          <button
            onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 transition-colors shrink-0"
            title="Toggle left panel"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {projectId && (
            <>
              <Link
                href="/dashboard"
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400 dark:text-gray-500 transition-colors shrink-0"
                title="Back to dashboard"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                {projectName || 'Project'}
              </span>
              <Link
                href={`/projects/${projectId}`}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400 dark:text-gray-500 transition-colors shrink-0"
                title="Project dashboard"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
              </Link>
            </>
          )}
        </div>

        {/* Center: topBar extensions (collapses to spacer when empty) */}
        <div className="flex-1 flex justify-center">
          <ExtensionSlot
            slotId="shell.topBar"
            context={shellContext}
            className="flex items-center space-x-2"
            fallback={<span />}
          />
        </div>

        {/* Right: user, panel toggle */}
        <div className="flex items-center gap-0.5 shrink-0">
          {projectId && (
            <BobbinManagerPopover
              projectId={projectId}
              installedBobbins={installedBobbins}
              onOpenFullMarketplace={onOpenMarketplace ? () => onOpenMarketplace() : undefined}
            />
          )}
          {user && <UserMenu user={user} />}
          <button
            onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 transition-colors"
            title="Toggle right panel"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zM12 13a1 1 0 110-2 1 1 0 010 2zM12 20a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel */}
        <aside
          className={`bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 ${
            resizingPanel === 'left' ? '' : 'transition-all duration-300'
          } overflow-hidden`}
          style={{ width: focusMode || (isHydrated && leftPanelCollapsed) ? 0 : leftPanelWidth }}
        >
          <div className="h-full">
            <ExtensionSlot
              slotId="shell.leftPanel"
              context={shellContext}
              className="h-full"
              fallback={
                <EmptySlotFallback
                  icon={
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                    </svg>
                  }
                  title="No navigation yet"
                  description="Install a bobbin to add project navigation here."
                  onAction={onOpenMarketplace ? () => onOpenMarketplace('shell.leftPanel') : undefined}
                />
              }
            />
          </div>
        </aside>

        {/* Left resize handle */}
        {!focusMode && !(isHydrated && leftPanelCollapsed) && (
          <div
            className="shrink-0 cursor-col-resize bg-transparent hover:bg-blue-400 active:bg-blue-500 transition-colors"
            style={{ width: RESIZE_HANDLE_WIDTH }}
            onMouseDown={(e) => handleResizeMouseDown('left', e)}
            onDoubleClick={() => handleResizeDoubleClick('left')}
          />
        )}

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto relative">
            {children}
            {/* Editor overlay slot (focus tools, ambient sound) */}
            <ExtensionSlot
              slotId="shell.editorOverlay"
              context={shellContext}
              className="absolute inset-0 pointer-events-none [&>*]:pointer-events-auto"
              fallback={null}
            />
          </div>
          {/* Editor footer slot (session stats, progress bars) */}
          <ExtensionSlot
            slotId="shell.editorFooter"
            context={shellContext}
            className="flex items-center justify-end border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 h-7 text-xs text-gray-500 dark:text-gray-400 gap-4"
            fallback={null}
            layout="inline"
          />
        </main>

        {/* Right resize handle */}
        {!focusMode && !(isHydrated && rightPanelCollapsed) && (
          <div
            className="shrink-0 cursor-col-resize bg-transparent hover:bg-blue-400 active:bg-blue-500 transition-colors"
            style={{ width: RESIZE_HANDLE_WIDTH }}
            onMouseDown={(e) => handleResizeMouseDown('right', e)}
            onDoubleClick={() => handleResizeDoubleClick('right')}
          />
        )}

        {/* Right Panel */}
        <aside
          className={`bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 ${
            resizingPanel === 'right' ? '' : 'transition-all duration-300'
          } overflow-hidden`}
          style={{ width: focusMode || (isHydrated && rightPanelCollapsed) ? 0 : rightPanelWidth }}
        >
          <div className="h-full">
            <ExtensionSlot
              slotId="shell.rightPanel"
              context={shellContext}
              className="h-full"
              fallback={
                <EmptySlotFallback
                  icon={
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
                    </svg>
                  }
                  title="No panels yet"
                  description="Install a bobbin that provides contextual panels for this view."
                  onAction={onOpenMarketplace ? () => onOpenMarketplace('shell.rightPanel') : undefined}
                />
              }
            />
          </div>
        </aside>
      </div>

      {/* Status Bar — hidden when no extensions and in focus mode */}
      <ExtensionSlot
        slotId="shell.statusBar"
        context={shellContext}
        className={`bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center px-4 space-x-4 transition-all duration-300 overflow-hidden ${focusMode ? 'h-0 border-t-0 opacity-0' : 'h-6'}`}
        fallback={null}
        layout="inline"
      />
      {/* Focus mode exit hint */}
      {showFocusHint && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-gray-800/80 dark:bg-gray-200/80 text-xs text-gray-200 dark:text-gray-800 pointer-events-none z-50 animate-fade-in select-none">
          Press <kbd className="px-1.5 py-0.5 rounded bg-gray-700 dark:bg-gray-300 text-gray-300 dark:text-gray-700 font-mono text-[10px] mx-0.5">Esc</kbd> to exit focus mode
        </div>
      )}
    </div>
  )
}

export default ShellLayout
