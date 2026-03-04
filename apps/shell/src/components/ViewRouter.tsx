'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { BobbinrySDK } from '@bobbinry/sdk'
import { viewRegistry, ViewRegistryEntry } from '@/lib/view-registry'

interface ViewRouterProps {
  projectId: string
  sdk: BobbinrySDK
}

interface NavigationState {
  entityType: string
  entityId: string
  bobbinId: string
  metadata?: Record<string, any>
}

function ViewIcon({ type }: { type: string }) {
  switch (type) {
    case 'tree':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="2" y1="3" x2="12" y2="3" />
          <line x1="4" y1="6.5" x2="12" y2="6.5" />
          <line x1="4" y1="10" x2="12" y2="10" />
        </svg>
      )
    case 'board':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="1" width="5" height="5" rx="1" />
          <rect x="8" y="1" width="5" height="5" rx="1" />
          <rect x="1" y="8" width="5" height="5" rx="1" />
          <rect x="8" y="8" width="5" height="5" rx="1" />
        </svg>
      )
    case 'editor':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.5 1.5L12.5 4.5L4.5 12.5H1.5V9.5L9.5 1.5Z" />
        </svg>
      )
    default:
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="1" width="12" height="12" rx="2" />
        </svg>
      )
  }
}

/** Load and return the user's preferred viewId for an entity type, if any */
function getViewPreference(entityType: string): string | null {
  try {
    const prefs = JSON.parse(localStorage.getItem('viewPreferences') || '{}')
    return prefs[entityType] || null
  } catch {
    return null
  }
}

function setViewPreference(entityType: string, viewId: string) {
  try {
    const prefs = JSON.parse(localStorage.getItem('viewPreferences') || '{}')
    prefs[entityType] = viewId
    localStorage.setItem('viewPreferences', JSON.stringify(prefs))
  } catch {}
}

/**
 * ViewRouter - Routes navigation events to appropriate views
 *
 * Listens for bobbinry:navigate events and renders the appropriate view
 * based on entity type and installed views. Shows a view switcher when
 * multiple views can handle the same entity type.
 */
export function ViewRouter({ projectId, sdk }: ViewRouterProps) {
  const [currentNav, setCurrentNav] = useState<NavigationState | null>(null)
  const [ViewComponent, setViewComponent] = useState<React.ComponentType<any> | null>(null)
  const [compatibleViews, setCompatibleViews] = useState<ViewRegistryEntry[]>([])
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const isNavigatingRef = useRef(false)
  const lastDispatchedViewRef = useRef<string | null>(null)
  const loadingViewRef = useRef<string | null>(null)

  // Stable key for current navigation - used to deduplicate setCurrentNav calls.
  // Without this, every event handler creates a new object reference which
  // re-triggers effects even when navigating to the same entity.
  const navKeyRef = useRef<string>('')

  function navKey(nav: NavigationState | null): string {
    return nav ? `${nav.bobbinId}:${nav.entityType}:${nav.entityId}` : ''
  }

  function updateNav(nav: NavigationState | null) {
    const key = navKey(nav)
    if (key === navKeyRef.current) return
    navKeyRef.current = key
    setCurrentNav(nav)
  }

  // Check for initial state from history on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && window.history.state) {
      const state = window.history.state as NavigationState
      if (state.entityType && state.entityId && state.bobbinId) {
        console.log('[ViewRouter] Restoring state from history:', state)
        updateNav(state)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Listen for navigation events
  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const customEvent = event as CustomEvent<NavigationState>
      const navState = customEvent.detail

      console.log('[ViewRouter] Navigation event received:', navState)

      if (!isNavigatingRef.current) {
        const url = `/projects/${projectId}/${navState.bobbinId}/${navState.entityType}/${navState.entityId}`
        window.history.pushState(navState, '', url)
      }

      updateNav(navState)
    }

    const handlePopState = (event: PopStateEvent) => {
      if (event.state) {
        isNavigatingRef.current = true
        updateNav(event.state as NavigationState)
        setTimeout(() => { isNavigatingRef.current = false }, 0)
      } else {
        updateNav(null)
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('bobbinry:navigate', handleNavigate)
      window.addEventListener('popstate', handlePopState)
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('bobbinry:navigate', handleNavigate)
        window.removeEventListener('popstate', handlePopState)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Resolve compatible views and load the component when navigation changes.
  useEffect(() => {
    if (!currentNav) {
      setCompatibleViews([])
      setActiveViewId(null)
      setViewComponent(null)
      lastDispatchedViewRef.current = null
      loadingViewRef.current = null

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('bobbinry:view-context-change', {
          detail: { currentView: 'project' }
        }))
      }
      return
    }

    const { entityType } = currentNav
    const views = viewRegistry.getViewsByHandler(entityType)

    // Only update compatibleViews if the set of view IDs actually changed
    setCompatibleViews(prev => {
      const prevIds = prev.map(v => v.viewId).join(',')
      const newIds = views.map(v => v.viewId).join(',')
      return prevIds === newIds ? prev : views
    })

    if (views.length === 0) {
      console.warn(`[ViewRouter] No views found for entity type: ${entityType}`)
      setActiveViewId(null)
      setViewComponent(null)
      return
    }

    // Determine which view to use:
    // 1. Explicit request in metadata
    // 2. Saved preference for this entity type
    // 3. First (highest priority)
    let selected: ViewRegistryEntry = views[0]!

    if (currentNav.metadata?.view) {
      const requestedId = `${currentNav.bobbinId}.${currentNav.metadata.view}`
      const match = views.find(v => v.viewId === requestedId)
      if (match) selected = match
    } else {
      const pref = getViewPreference(entityType)
      if (pref) {
        const match = views.find(v => v.viewId === pref)
        if (match) selected = match
      }
    }

    setActiveViewId(selected.viewId)
    loadView(selected, currentNav)
  }, [currentNav])

  // Load component when user manually switches views via the tab bar.
  // The loadingViewRef guard ensures this is a no-op when activeViewId was
  // just set by the navigation effect above (same viewKey already loaded).
  useEffect(() => {
    if (!activeViewId || !currentNav) return

    const entry = viewRegistry.get(activeViewId)
    if (!entry) return

    loadView(entry, currentNav)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeViewId])

  function loadView(entry: ViewRegistryEntry, nav: NavigationState) {
    // Deduplicate: skip if we're already showing this exact view+entity combination
    const viewKey = `${entry.viewId}:${nav.entityType}:${nav.entityId}`
    if (loadingViewRef.current === viewKey) return
    loadingViewRef.current = viewKey

    // Dispatch view context change
    if (typeof window !== 'undefined' && lastDispatchedViewRef.current !== viewKey) {
      lastDispatchedViewRef.current = viewKey
      window.dispatchEvent(new CustomEvent('bobbinry:view-context-change', {
        detail: {
          currentView: entry.viewId,
          inView: 'project',
          entityType: nav.entityType,
          entityId: nav.entityId,
          bobbinId: nav.bobbinId
        }
      }))
    }

    // Load component
    if (entry.execution === 'native' && entry.componentLoader) {
      entry.componentLoader()
        .then((component) => {
          setViewComponent(() => component as React.ComponentType<any>)
        })
        .catch((error: unknown) => {
          console.error('[ViewRouter] Failed to load component:', error)
          setViewComponent(null)
        })
    } else if (entry.execution === 'sandboxed') {
      console.warn('[ViewRouter] Sandboxed views not yet supported')
      setViewComponent(null)
    }
  }

  const handleViewSwitch = useCallback((viewId: string) => {
    if (!currentNav) return
    setActiveViewId(viewId)
    setViewPreference(currentNav.entityType, viewId)
  }, [currentNav])

  // Placeholder when no entity selected
  if (!currentNav || !ViewComponent) {
    if (currentNav && compatibleViews.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500">
            <p>No views available for this item type.</p>
          </div>
        </div>
      )
    }

    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <svg className="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Choose something from the sidebar to begin
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* View switcher - only shown when multiple views are available */}
      {compatibleViews.length > 1 && (
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <span className="text-xs text-gray-400 dark:text-gray-500 mr-1.5">View:</span>
          {compatibleViews.map((view) => {
            const isActive = view.viewId === activeViewId
            const viewType = view.metadata.type || 'custom'
            const label = view.metadata.name || view.viewId.split('.').pop() || 'View'

            return (
              <button
                key={view.viewId}
                onClick={() => handleViewSwitch(view.viewId)}
                className={`
                  flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors
                  ${isActive
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm border border-gray-200 dark:border-gray-600'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                  }
                `}
              >
                <ViewIcon type={viewType} />
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* View content */}
      <div className="flex-1 overflow-hidden">
        <ViewComponent
          projectId={projectId}
          bobbinId={currentNav.bobbinId}
          viewId="router"
          sdk={sdk}
          entityType={currentNav.entityType}
          entityId={currentNav.entityId}
          metadata={currentNav.metadata}
        />
      </div>
    </div>
  )
}

export default ViewRouter
