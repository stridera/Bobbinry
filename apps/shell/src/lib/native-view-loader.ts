/**
 * NativeViewLoader
 *
 * Dynamically imports and loads native view components from workspace packages.
 * Native views are first-party bobbins installed as local packages in the monorepo.
 *
 * Example package structure:
 *   bobbins/manuscript/
 *     package.json          # "name": "@bobbinry/manuscript"
 *     views/
 *       outline.tsx         # export default OutlineView
 *       editor.tsx          # export default EditorView
 */

import type { ComponentType } from 'react'

export interface NativeViewModule {
  default: ComponentType<any>
}

export interface LoadedNativeView {
  component: ComponentType<any>
  bobbinId: string
  viewId: string
  metadata: {
    packageName: string
    viewPath: string
    loadedAt: Date
  }
}

/**
 * Loads a native view component from a workspace package.
 *
 * @param bobbinId - The bobbin identifier (e.g., "manuscript", "corkboard")
 * @param viewPath - Relative path to the view within the bobbin's views/ directory (e.g., "outline", "editor")
 * @returns Promise resolving to the loaded component
 *
 * @example
 * ```typescript
 * const OutlineView = await loadNativeView('manuscript', 'outline')
 * // Imports from: @bobbinry/manuscript/views/outline
 * ```
 */
// Static import map generated from bobbin manifests.
// Run `bun run generate:views` to regenerate.
import { NATIVE_VIEW_MAP } from './native-view-map.generated'

export async function loadNativeView(
  bobbinId: string,
  viewPath: string
): Promise<ComponentType<any>> {
  const viewKey = `${bobbinId}.${viewPath}`
  
  try {
    // Try using the static import map first (for bundled views)
    if (NATIVE_VIEW_MAP[viewKey]) {
      const module = await NATIVE_VIEW_MAP[viewKey]()
      
      if (module.default === undefined || module.default === null) {
        throw new Error(
          `Native view ${viewKey} does not have a default export. ` +
          `Views must export a React component as default.`
        )
      }

      return module.default
    }
    
    // If not in map, throw error
    throw new Error(
      `Native view ${viewKey} not found in NATIVE_VIEW_MAP. ` +
      `Available views: ${Object.keys(NATIVE_VIEW_MAP).join(', ')}`
    )
  } catch (error) {
    // If the error is about missing default export, re-throw as-is
    if (error instanceof Error && error.message.includes('does not have a default export')) {
      throw error
    }

    // Otherwise wrap with additional context
    throw new Error(
      `Failed to load native view: ${viewKey}
` +
      `Bobbin: ${bobbinId}, View: ${viewPath}
` +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Loads a native view with full metadata tracking.
 *
 * @param bobbinId - The bobbin identifier
 * @param viewPath - Relative path to the view
 * @returns Promise resolving to loaded view with metadata
 */
export async function loadNativeViewWithMetadata(
  bobbinId: string,
  viewPath: string
): Promise<LoadedNativeView> {
  const component = await loadNativeView(bobbinId, viewPath)
  const packageName = `@bobbinry/${bobbinId}`

  return {
    component,
    bobbinId,
    viewId: `${bobbinId}.${viewPath}`,
    metadata: {
      packageName,
      viewPath: `views/${viewPath}`,
      loadedAt: new Date()
    }
  }
}

/**
 * Creates a component loader function suitable for ViewRegistry.
 *
 * @param bobbinId - The bobbin identifier
 * @param viewPath - Relative path to the view
 * @returns Function that loads the component when called
 *
 * @example
 * ```typescript
 * viewRegistry.register({
 *   viewId: 'manuscript.outline',
 *   bobbinId: 'manuscript',
 *   execution: 'native',
 *   componentLoader: createComponentLoader('manuscript', 'outline'),
 *   ssr: true,
 *   capabilities: ['read', 'write'],
 *   metadata: { name: 'Outline', type: 'tree', source: 'native' }
 * })
 * ```
 */
export function createComponentLoader(
  bobbinId: string,
  viewPath: string
): () => Promise<ComponentType<any>> {
  return () => loadNativeView(bobbinId, viewPath)
}

/**
 * Preloads a native view component into cache.
 * Useful for preloading frequently-used views during app initialization.
 *
 * @param bobbinId - The bobbin identifier
 * @param viewPath - Relative path to the view
 * @returns Promise resolving when preload is complete
 */
export async function preloadNativeView(
  bobbinId: string,
  viewPath: string
): Promise<void> {
  try {
    await loadNativeView(bobbinId, viewPath)
    console.log(`[NativeViewLoader] Preloaded: ${bobbinId}.${viewPath}`)
  } catch (error) {
    console.error(`[NativeViewLoader] Failed to preload: ${bobbinId}.${viewPath}`, error)
    // Don't throw - preload failures shouldn't break the app
  }
}

/**
 * Batch preloads multiple native views.
 *
 * @param views - Array of {bobbinId, viewPath} tuples
 * @returns Promise resolving when all preloads complete (or fail)
 */
export async function preloadNativeViews(
  views: Array<{ bobbinId: string; viewPath: string }>
): Promise<void> {
  await Promise.allSettled(
    views.map(({ bobbinId, viewPath }) => preloadNativeView(bobbinId, viewPath))
  )
}