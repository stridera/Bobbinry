/**
 * View Registry - Centralized management of bobbin views with execution mode tracking
 * 
 * Manages how views are loaded and rendered:
 * - Native views: React components imported directly from workspace
 * - Sandboxed views: iframes with postMessage communication
 */

import { ComponentType } from 'react'

export type ExecutionMode = 'native' | 'sandboxed'

export interface ViewRegistryEntry {
  viewId: string
  bobbinId: string
  execution: ExecutionMode
  
  // Native-specific configuration
  componentLoader?: () => Promise<ComponentType<any>>
  ssr?: boolean
  
  // Sandboxed-specific configuration
  iframeSrc?: string
  
  // Common metadata
  capabilities: string[]
  metadata: {
    name: string
    type: string
    source: string
  }

  // View routing - NEW
  handlers?: string[]  // Entity types this view can handle (e.g., ['scene', 'chapter'])
  priority?: number    // Higher = preferred default (optional)
}

export interface ViewRegistryStats {
  totalViews: number
  nativeViews: number
  sandboxedViews: number
  viewsByBobbin: Record<string, number>
}

/**
 * ViewRegistry manages all registered views across bobbins
 * Singleton pattern with HMR support
 */
export class ViewRegistry {
  private views = new Map<string, ViewRegistryEntry>()
  private viewsByBobbin = new Map<string, Set<string>>()

  /**
   * Register a new view
   */
  register(entry: ViewRegistryEntry): void {
    const { viewId, bobbinId, execution } = entry

    // Validate entry based on execution mode
    if (execution === 'native') {
      if (!entry.componentLoader) {
        throw new Error(`Native view ${viewId} must have componentLoader`)
      }
    } else if (execution === 'sandboxed') {
      if (!entry.iframeSrc) {
        throw new Error(`Sandboxed view ${viewId} must have iframeSrc`)
      }
    }

    // Check for duplicates
    if (this.views.has(viewId)) {
      console.warn(`View ${viewId} already registered, overwriting`)
    }

    // Register the view
    this.views.set(viewId, entry)

    // Track by bobbin
    if (!this.viewsByBobbin.has(bobbinId)) {
      this.viewsByBobbin.set(bobbinId, new Set())
    }
    this.viewsByBobbin.get(bobbinId)!.add(viewId)

    console.log(`[ViewRegistry] Registered ${execution} view: ${viewId}`)
  }

  /**
   * Get a view entry by ID
   */
  get(viewId: string): ViewRegistryEntry | undefined {
    return this.views.get(viewId)
  }

  /**
   * Get all views for a specific bobbin
   */
  getByBobbin(bobbinId: string): ViewRegistryEntry[] {
    const viewIds = this.viewsByBobbin.get(bobbinId)
    if (!viewIds) return []

    return Array.from(viewIds)
      .map(id => this.views.get(id))
      .filter((entry): entry is ViewRegistryEntry => entry !== undefined)
  }

  /**
   * Get all registered views
   */
  getAll(): ViewRegistryEntry[] {
    return Array.from(this.views.values())
  }

  /**
   * Unregister a specific view
   */
  unregister(viewId: string): void {
    const entry = this.views.get(viewId)
    if (!entry) {
      console.warn(`View ${viewId} not found, cannot unregister`)
      return
    }

    // Remove from main registry
    this.views.delete(viewId)

    // Remove from bobbin tracking
    const bobbinViews = this.viewsByBobbin.get(entry.bobbinId)
    if (bobbinViews) {
      bobbinViews.delete(viewId)
      if (bobbinViews.size === 0) {
        this.viewsByBobbin.delete(entry.bobbinId)
      }
    }

    console.log(`[ViewRegistry] Unregistered view: ${viewId}`)
  }

  /**
   * Unregister all views for a bobbin
   */
  unregisterBobbin(bobbinId: string): void {
    const viewIds = this.viewsByBobbin.get(bobbinId)
    if (!viewIds) {
      console.warn(`No views found for bobbin ${bobbinId}`)
      return
    }

    // Unregister each view
    Array.from(viewIds).forEach(viewId => {
      this.views.delete(viewId)
    })

    // Remove bobbin tracking
    this.viewsByBobbin.delete(bobbinId)

    console.log(`[ViewRegistry] Unregistered all views for bobbin: ${bobbinId}`)
  }

  /**
   * Check if a view is registered
   */
  has(viewId: string): boolean {
    return this.views.has(viewId)
  }

  /**
   * Get registry statistics
   */
  /**
   * Get all views that can handle a specific entity type
   * Results are sorted by priority (higher first)
   */
  getViewsByHandler(entityType: string): ViewRegistryEntry[] {
    const allViews = Array.from(this.views.values())
    const matchingViews = allViews.filter(view => 
      view.handlers?.includes(entityType)
    )

    // Sort by priority (higher first), then by viewId for stability
    return matchingViews.sort((a, b) => {
      const priorityA = a.priority ?? 0
      const priorityB = b.priority ?? 0
      if (priorityA !== priorityB) {
        return priorityB - priorityA  // Higher priority first
      }
      return a.viewId.localeCompare(b.viewId)
    })
  }

  getStats(): ViewRegistryStats {
    const allViews = Array.from(this.views.values())
    const nativeViews = allViews.filter(v => v.execution === 'native')
    const sandboxedViews = allViews.filter(v => v.execution === 'sandboxed')

    const viewsByBobbin: Record<string, number> = {}
    for (const [bobbinId, viewIds] of this.viewsByBobbin) {
      viewsByBobbin[bobbinId] = viewIds.size
    }

    return {
      totalViews: this.views.size,
      nativeViews: nativeViews.length,
      sandboxedViews: sandboxedViews.length,
      viewsByBobbin
    }
  }

  /**
   * Clear all registered views (for testing/debugging)
   */
  clear(): void {
    console.log('[ViewRegistry] Clearing all views')
    this.views.clear()
    this.viewsByBobbin.clear()
  }

  /**
   * Get all native views (for preloading, SSR, etc.)
   */
  getNativeViews(): ViewRegistryEntry[] {
    return Array.from(this.views.values()).filter(
      entry => entry.execution === 'native'
    )
  }

  /**
   * Get all sandboxed views
   */
  getSandboxedViews(): ViewRegistryEntry[] {
    return Array.from(this.views.values()).filter(
      entry => entry.execution === 'sandboxed'
    )
  }
}

// Singleton instance with HMR persistence
// Store on globalThis to survive hot module reloads
declare global {
  var __viewRegistry: ViewRegistry | undefined
}

export const viewRegistry = globalThis.__viewRegistry ?? (globalThis.__viewRegistry = new ViewRegistry())

// Export for testing
export function createViewRegistry(): ViewRegistry {
  return new ViewRegistry()
}