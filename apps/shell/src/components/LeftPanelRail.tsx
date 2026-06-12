'use client'

import { useEffect, useMemo, useState, memo, ReactNode, useSyncExternalStore } from 'react'
import { PanelActionsProvider } from '@bobbinry/sdk'
import { extensionRegistry, RegisteredExtension } from '@/lib/extensions'
import { useExtensions } from './ExtensionProvider'
import { PanelIcon } from './icons/PanelIcon'

export const RAIL_WIDTH = 44

const SLOT_ID = 'shell.leftPanel'
const ACTIVE_STORAGE_KEY = 'shellLeftRail:active'

interface LeftPanelRailProps {
  context?: any
  collapsed: boolean
  columnWidth: number
  animate: boolean
  onToggleCollapse: () => void
  onOpenMarketplace?: (() => void) | undefined
  emptyFallback?: ReactNode
}

const noopSubscribe = () => () => {}

const PanelContent = memo(function PanelContent({
  extension,
  context,
}: {
  extension: RegisteredExtension
  context: any
}) {
  const Component = extension.component
  if (typeof Component === 'function') {
    return <Component {...context} context={context} />
  }

  return (
    <div className="h-full flex flex-col items-center justify-center p-6 text-center">
      <p className="text-sm text-gray-700 dark:text-gray-300">
        Native component unavailable for {extension.contribution.title || extension.id}
      </p>
    </div>
  )
}, (prevProps, nextProps) => {
  return prevProps.extension.id === nextProps.extension.id &&
         prevProps.extension.component === nextProps.extension.component &&
         prevProps.context === nextProps.context
})

export function LeftPanelRail({
  context,
  collapsed,
  columnWidth,
  animate,
  onToggleCollapse,
  onOpenMarketplace,
  emptyFallback,
}: LeftPanelRailProps) {
  const extensionContext = useExtensions()
  const registeredCount = extensionContext?.extensions?.length ?? 0
  const [slotChangeVersion, setSlotChangeVersion] = useState(0)
  const isHydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)

  const [activeId, setActiveId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem(ACTIVE_STORAGE_KEY)
  })
  const [actionsEl, setActionsEl] = useState<HTMLDivElement | null>(null)

  const extensions = useMemo(() => {
    if (!isHydrated) return []
    return extensionRegistry.getExtensionsForSlot(SLOT_ID, context)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, isHydrated, registeredCount, slotChangeVersion])

  useEffect(() => {
    const unsubscribe = extensionRegistry.onSlotChange(SLOT_ID, () => {
      setSlotChangeVersion(v => v + 1)
    })
    return unsubscribe
  }, [])

  // One-time cleanup of the obsolete stacked-layout state for this slot.
  // Right-slot keys (panelLayout:shell.rightPanel*) must survive.
  useEffect(() => {
    try {
      Object.keys(localStorage)
        .filter(key => key.startsWith(`panelLayout:${SLOT_ID}`))
        .forEach(key => localStorage.removeItem(key))
    } catch {
      // localStorage unavailable (private mode) — nothing to clean
    }
  }, [])

  // Saved id may point at an uninstalled bobbin or a panel whose `when`
  // condition is currently false — fall back to the first (priority-sorted)
  // extension without overwriting the saved preference.
  const activeExtension = useMemo(() => {
    return extensions.find(ext => ext.id === activeId) ?? extensions[0] ?? null
  }, [extensions, activeId])

  const handleIconClick = (ext: RegisteredExtension) => {
    if (activeExtension?.id === ext.id && !collapsed) {
      onToggleCollapse()
      return
    }
    const isPanelSwitch = activeExtension?.id !== ext.id
    setActiveId(ext.id)
    try {
      localStorage.setItem(ACTIVE_STORAGE_KEY, ext.id)
    } catch {
      // best-effort persistence
    }
    if (collapsed) onToggleCollapse()

    // Activating a module also brings up its main view: the bobbin's
    // last-visited location if we have one, else the manifest-declared home.
    if (isPanelSwitch) {
      const projectId = context?.projectId
      let detail: Record<string, any> | null = null
      if (projectId) {
        try {
          const saved = localStorage.getItem(`bobbinry:lastNav:${projectId}:${ext.bobbinId}`)
          if (saved) detail = JSON.parse(saved)
        } catch {
          // fall through to home
        }
      }
      if (!detail && ext.contribution.home) {
        detail = { ...ext.contribution.home, bobbinId: ext.bobbinId }
      }
      if (detail) {
        window.dispatchEvent(new CustomEvent('bobbinry:navigate', { detail }))
      }
    }
  }

  return (
    <div className="flex h-full">
      {/* Icon rail */}
      <div
        className={`flex flex-col items-center shrink-0 border-r bg-gray-50 dark:bg-gray-800 py-1 ${
          collapsed ? 'border-transparent' : 'border-gray-200 dark:border-gray-700'
        }`}
        style={{ width: RAIL_WIDTH }}
        role="tablist"
        aria-orientation="vertical"
        aria-label="Sidebar panels"
      >
        {extensions.map(ext => {
          const isActive = activeExtension?.id === ext.id
          return (
            <button
              key={ext.id}
              type="button"
              role="tab"
              aria-selected={isActive && !collapsed}
              title={ext.contribution.title || ext.id}
              onClick={() => handleIconClick(ext)}
              className="relative flex h-11 w-full items-center justify-center"
            >
              {isActive && !collapsed && (
                <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-blue-600 dark:bg-blue-400" />
              )}
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                  isActive && !collapsed
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <PanelIcon
                  name={(ext.contribution as { icon?: string }).icon}
                  fallbackLabel={ext.contribution.title || ext.id}
                />
              </span>
            </button>
          )
        })}
        <div className="flex-1" />
        {onOpenMarketplace && (
          <button
            type="button"
            title="Browse bobbins"
            onClick={onOpenMarketplace}
            className="flex h-11 w-full items-center justify-center text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      {/* Active panel column */}
      <div
        className={`overflow-hidden ${animate ? 'transition-all duration-300' : ''}`}
        style={{ width: collapsed ? 0 : columnWidth }}
      >
        <div className="flex h-full flex-col" style={{ width: columnWidth }}>
          {activeExtension ? (
            <>
              <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-gray-200 bg-gray-50 px-3 select-none dark:border-gray-600 dark:bg-gray-700">
                <span className="truncate text-sm font-medium text-gray-700 dark:text-gray-200">
                  {activeExtension.contribution.title || activeExtension.id}
                </span>
                <div
                  ref={setActionsEl}
                  className="flex flex-1 items-center justify-end gap-1"
                />
              </div>
              <div className="flex-1 overflow-hidden">
                <PanelActionsProvider value={actionsEl}>
                  <PanelContent extension={activeExtension} context={context} />
                </PanelActionsProvider>
              </div>
            </>
          ) : (
            emptyFallback ?? null
          )}
        </div>
      </div>
    </div>
  )
}

export default LeftPanelRail
