'use client'

import { useEffect, useState, Suspense } from 'react'
import type { ComponentType } from 'react'
import { BobbinrySDK } from '@bobbinry/sdk'
import { loadNativeView } from '../lib/native-view-loader'

interface NativeViewRendererProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  componentLoader?: () => Promise<ComponentType<any>>
}

/**
 * Renders a native view component loaded directly from workspace packages.
 * Native views run in the same React context as the shell for maximum performance.
 */
export function NativeViewRenderer({
  projectId,
  bobbinId,
  viewId,
  sdk,
  componentLoader
}: NativeViewRendererProps) {
  const [ViewComponent, setViewComponent] = useState<ComponentType<any> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadComponent() {
      try {
        setLoading(true)
        setError(null)

        let component: ComponentType<any>

        if (componentLoader) {
          // Use provided loader (from ViewRegistry)
          component = await componentLoader()
        } else {
          // Extract view path from viewId (e.g., "manuscript.outline" -> "outline")
          const viewPath = viewId.split('.').slice(1).join('/')
          component = await loadNativeView(bobbinId, viewPath)
        }

        if (!cancelled) {
          setViewComponent(() => component)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[NativeViewRenderer] Failed to load component:', err)
          setError(err instanceof Error ? err.message : 'Failed to load native view')
          setLoading(false)
        }
      }
    }

    loadComponent()

    return () => {
      cancelled = true
    }
  }, [bobbinId, viewId, componentLoader])

  if (!projectId || !bobbinId || !viewId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <div>Invalid view configuration</div>
          <div className="text-sm mt-1">Missing projectId, bobbinId, or viewId</div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
          <div className="text-gray-600 text-sm">Loading native view...</div>
          <div className="text-xs text-gray-400 mt-1">
            {bobbinId}/{viewId}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="text-red-600 text-lg font-medium mb-2">Native View Error</div>
          <div className="text-gray-600 text-sm mb-4 break-words">{error}</div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }

  if (!ViewComponent) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <div>View component not loaded</div>
        </div>
      </div>
    )
  }

  // Render the native view component with SDK context
  return (
    <div className="flex-1 flex flex-col relative">
      {process.env.NODE_ENV === 'development' && (
        <div className="absolute top-2 right-2 bg-purple-100 text-purple-800 px-2 py-1 rounded text-xs z-10">
          Native View
        </div>
      )}
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
        }
      >
        <ViewComponent
          projectId={projectId}
          bobbinId={bobbinId}
          viewId={viewId}
          sdk={sdk}
        />
      </Suspense>
    </div>
  )
}