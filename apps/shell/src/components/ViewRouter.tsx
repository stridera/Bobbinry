'use client'

import { useState, useEffect, useRef } from 'react'
import { BobbinrySDK } from '@bobbinry/sdk'
import { viewRegistry } from '@/lib/view-registry'

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

/**
 * ViewRouter - Routes navigation events to appropriate views
 *
 * Listens for bobbinry:navigate events and renders the appropriate view
 * based on entity type and installed views.
 */
export function ViewRouter({ projectId, sdk }: ViewRouterProps) {
  const [currentNav, setCurrentNav] = useState<NavigationState | null>(null)
  const [ViewComponent, setViewComponent] = useState<React.ComponentType<any> | null>(null)
  const isNavigatingRef = useRef(false)
  const lastDispatchedViewRef = useRef<string | null>(null)

  // Check for initial state from history on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && window.history.state) {
      const state = window.history.state as NavigationState
      // Only restore if the state has required fields (filter out stale/invalid states)
      if (state.entityType && state.entityId && state.bobbinId) {
        console.log('[ViewRouter] Restoring state from history:', state)
        setCurrentNav(state)
      } else {
        console.log('[ViewRouter] Ignoring invalid history state:', state)
      }
    }
  }, [])

  // Listen for navigation events
  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const customEvent = event as CustomEvent<NavigationState>
      const navState = customEvent.detail

      console.log('[ViewRouter] Navigation event received:', navState)
      
      // Push to browser history
      if (!isNavigatingRef.current) {
        const url = `/projects/${projectId}/${navState.bobbinId}/${navState.entityType}/${navState.entityId}`
        window.history.pushState(navState, '', url)
        console.log('[ViewRouter] Pushed to history:', url)
      }
      
      setCurrentNav(navState)
    }

    const handlePopState = (event: PopStateEvent) => {
      console.log('[ViewRouter] Pop state event:', event.state)
      
      if (event.state) {
        isNavigatingRef.current = true
        setCurrentNav(event.state as NavigationState)
        
        // Reset flag after state update
        setTimeout(() => {
          isNavigatingRef.current = false
        }, 0)
      } else {
        // No state means we're back to project view
        setCurrentNav(null)
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('bobbinry:navigate', handleNavigate)
      window.addEventListener('popstate', handlePopState)
      console.log('[ViewRouter] Registered listeners for navigation and popstate')
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('bobbinry:navigate', handleNavigate)
        window.removeEventListener('popstate', handlePopState)
      }
    }
  }, [projectId])

  // Load appropriate view when navigation state changes
  useEffect(() => {
    if (!currentNav) {
      setViewComponent(null)
      lastDispatchedViewRef.current = null
      // Clear current view context
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('bobbinry:view-context-change', {
          detail: { currentView: 'project' }
        }))
      }
      return
    }

    const loadView = async () => {
      const { entityType } = currentNav

      // Find all views that can handle this entity type
      const compatibleViews = viewRegistry.getViewsByHandler(entityType)
      console.log(`[ViewRouter] Found ${compatibleViews.length} views for entity type "${entityType}":`, compatibleViews)

      if (compatibleViews.length === 0) {
        console.warn(`[ViewRouter] No views found for entity type: ${entityType}`)
        setViewComponent(null)
        return
      }

      // Check if a specific view was requested in metadata
      let selectedView = compatibleViews[0]!
      if (currentNav.metadata?.view) {
        const requestedViewId = `${currentNav.bobbinId}.${currentNav.metadata.view}`
        const matchingView = compatibleViews.find(v => v.viewId === requestedViewId)
        if (matchingView) {
          selectedView = matchingView
          console.log('[ViewRouter] Using requested view from metadata:', requestedViewId)
        } else {
          console.warn(`[ViewRouter] Requested view ${requestedViewId} not found, using default`)
        }
      } else {
        console.log('[ViewRouter] No view preference, using first (highest priority) view')
      }
      console.log('[ViewRouter] Selected view:', selectedView.viewId)

      // Dispatch view context change event for extension slots (only if changed)
      const viewKey = `${selectedView.viewId}:${entityType}:${currentNav.entityId}`
      if (typeof window !== 'undefined' && lastDispatchedViewRef.current !== viewKey) {
        lastDispatchedViewRef.current = viewKey
        window.dispatchEvent(new CustomEvent('bobbinry:view-context-change', {
          detail: {
            currentView: selectedView.viewId,
            inView: 'project', // Keep base context for navigation panels
            entityType,
            entityId: currentNav.entityId,
            bobbinId: currentNav.bobbinId
          }
        }))
        console.log('[ViewRouter] Dispatched view-context-change:', selectedView.viewId)
      } else {
        console.log('[ViewRouter] Skipping duplicate view-context-change dispatch')
      }

      // Load the component
      if (selectedView.execution === 'native' && selectedView.componentLoader) {
        try {
          const component = await selectedView.componentLoader()
          console.log('[ViewRouter] Loaded component for view:', selectedView.viewId)
          setViewComponent(() => component)
        } catch (error) {
          console.error('[ViewRouter] Failed to load component:', error)
          setViewComponent(null)
        }
      } else if (selectedView.execution === 'sandboxed') {
        // TODO: Handle sandboxed views with iframe
        console.warn('[ViewRouter] Sandboxed views not yet supported in ViewRouter')
        setViewComponent(null)
      }
    }

    loadView()
  }, [currentNav])

  // Show placeholder when no navigation state
  if (!currentNav || !ViewComponent) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <p>Select an item from the navigation panel</p>
        </div>
      </div>
    )
  }

  // Render the selected view with entity context
  return (
    <ViewComponent
      projectId={projectId}
      bobbinId={currentNav.bobbinId}
      viewId="router" // Not used by new views
      sdk={sdk}
      entityType={currentNav.entityType}
      entityId={currentNav.entityId}
      metadata={currentNav.metadata}
    />
  )
}

export default ViewRouter
