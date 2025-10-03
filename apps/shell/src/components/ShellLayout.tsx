'use client'

import { ReactNode, useState, useMemo, useEffect } from 'react'
import { ExtensionSlot } from './ExtensionSlot'
import { useTheme } from '@/contexts/ThemeContext'

interface ShellLayoutProps {
  children: ReactNode
  currentView?: string
  context?: any
}

export function ShellLayout({ children, currentView = 'default', context = {} }: ShellLayoutProps) {
  const { theme, toggleTheme } = useTheme()
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)
  const [dynamicContext, setDynamicContext] = useState<Record<string, any>>({})

  // Hydration safety
  useEffect(() => {
    setIsHydrated(true)
  }, [])

  // Listen for view context changes from ViewRouter
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

  const shellContext = useMemo(() => ({
    currentView: dynamicContext.currentView || currentView,
    ...context,
    ...dynamicContext
  }), [currentView, context, dynamicContext])

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Top Bar */}
      <header className="h-12 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-4">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            title="Toggle left panel"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <a href="/" className="text-lg font-semibold hover:text-blue-600 transition-colors cursor-pointer">
            Bobbinry
          </a>
        </div>

        <div className="flex-1 flex justify-center">
          <ExtensionSlot
            slotId="shell.topBar"
            context={shellContext}
            className="flex items-center space-x-2"
          />
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={toggleTheme}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
          </button>
          <button
            onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            title="Toggle right panel"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            isHydrated && leftPanelCollapsed ? 'w-0' : 'w-64'
          } overflow-hidden`}
        >
          <div className="h-full">
            <ExtensionSlot
              slotId="shell.leftPanel"
              context={shellContext}
              className="h-full"
              fallback={
                <div className="p-4 text-gray-500 dark:text-gray-400 text-sm">
                  No navigation panels installed
                </div>
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
            isHydrated && rightPanelCollapsed ? 'w-0' : 'w-80'
          } overflow-hidden`}
        >
          <div className="h-full">
            <ExtensionSlot
              slotId="shell.rightPanel"
              context={shellContext}
              className="h-full"
              fallback={
                <div className="p-4 text-gray-500 dark:text-gray-400 text-sm">
                  No contextual panels available
                </div>
              }
            />
          </div>
        </aside>
      </div>

      {/* Status Bar */}
      <footer className="h-6 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center px-4">
        <ExtensionSlot
          slotId="shell.statusBar"
          context={shellContext}
          className="flex items-center space-x-4 w-full"
          fallback={
            <div className="text-xs text-gray-500">
              Ready
            </div>
          }
        />
      </footer>
    </div>
  )
}

export default ShellLayout