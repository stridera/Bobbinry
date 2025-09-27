'use client'

import { ReactNode, useState } from 'react'
import { ExtensionSlot } from './ExtensionSlot'

interface ShellLayoutProps {
  children: ReactNode
  currentView?: string
  context?: any
}

export function ShellLayout({ children, currentView = 'default', context = {} }: ShellLayoutProps) {
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)

  const shellContext = {
    currentView,
    ...context
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Top Bar */}
      <header className="h-12 bg-white border-b border-gray-200 flex items-center px-4">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
            className="p-1 hover:bg-gray-100 rounded"
            title="Toggle left panel"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <h1 className="text-lg font-semibold">Bobbinry</h1>
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
            onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
            className="p-1 hover:bg-gray-100 rounded"
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
          className={`bg-white border-r border-gray-200 transition-all duration-300 ${
            leftPanelCollapsed ? 'w-0' : 'w-64'
          } overflow-hidden`}
        >
          <div className="h-full">
            <ExtensionSlot
              slotId="shell.leftPanel"
              context={shellContext}
              className="h-full"
              fallback={
                <div className="p-4 text-gray-500 text-sm">
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
          className={`bg-white border-l border-gray-200 transition-all duration-300 ${
            rightPanelCollapsed ? 'w-0' : 'w-80'
          } overflow-hidden`}
        >
          <div className="h-full">
            <ExtensionSlot
              slotId="shell.rightPanel"
              context={shellContext}
              className="h-full"
              fallback={
                <div className="p-4 text-gray-500 text-sm">
                  No contextual panels available
                </div>
              }
            />
          </div>
        </aside>
      </div>

      {/* Status Bar */}
      <footer className="h-6 bg-gray-100 border-t border-gray-200 flex items-center px-4">
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