'use client'

import { ReactNode, useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { ExtensionSlot } from './ExtensionSlot'
import { UserMenu } from './UserMenu'
import { useTheme } from '@/contexts/ThemeContext'

interface ShellLayoutProps {
  children: ReactNode
  currentView?: string
  context?: any
  onOpenMarketplace?: () => void
  projectId?: string | undefined
  projectName?: string | undefined
  user?: { id: string; email: string; name?: string | null } | undefined
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

export function ShellLayout({ children, currentView = 'default', context = {}, onOpenMarketplace, projectId, projectName, user }: ShellLayoutProps) {
  const { theme, toggleTheme } = useTheme()
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const [dynamicContext, setDynamicContext] = useState<Record<string, any>>({})
  const [focusMode, setFocusMode] = useState(false)
  const [showFocusHint, setShowFocusHint] = useState(false)
  const focusModeRef = useRef(false)

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  useEffect(() => {
    const handleViewContextChange = (event: Event) => {
      const customEvent = event as CustomEvent<Record<string, any>>
      console.log('[ShellLayout] View context changed:', customEvent.detail)
      setDynamicContext(customEvent.detail)
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
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
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

        {/* Right: theme, user, panel toggle */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={toggleTheme}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 transition-colors"
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
          </button>
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
          className={`bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 ${
            focusMode || (isHydrated && leftPanelCollapsed) ? 'w-0' : 'w-64'
          } overflow-hidden`}
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
                  onAction={onOpenMarketplace}
                />
              }
            />
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {children}
        </main>

        {/* Right Panel */}
        <aside
          className={`bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 transition-all duration-300 ${
            focusMode || (isHydrated && rightPanelCollapsed) ? 'w-0' : 'w-80'
          } overflow-hidden`}
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
                  onAction={onOpenMarketplace}
                />
              }
            />
          </div>
        </aside>
      </div>

      {/* Status Bar */}
      <footer className={`bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center px-4 transition-all duration-300 overflow-hidden ${focusMode ? 'h-0 border-t-0 opacity-0' : 'h-6'}`}>
        <ExtensionSlot
          slotId="shell.statusBar"
          context={shellContext}
          className="flex items-center space-x-4 w-full"
          fallback={
            <div className="text-xs text-gray-400 dark:text-gray-500">
              Ready
            </div>
          }
        />
      </footer>
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
