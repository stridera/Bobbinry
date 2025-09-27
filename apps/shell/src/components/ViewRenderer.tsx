'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { BobbinrySDK } from '@bobbinry/sdk'
import { BobbinBridge, BobbinError } from '../services/BobbinBridge'
import { Theme } from '../types/bobbin-messages'

interface ViewRendererProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
}

export function ViewRenderer({ projectId, bobbinId, viewId, sdk }: ViewRendererProps) {
  const mountId = useRef(Math.random().toString(36).substr(2, 9))
  console.log('🚀 VIEWRENDERER MOUNTING!', { projectId, bobbinId, viewId, mountId: mountId.current })
  console.log('🚀 VIEWRENDERER: Component started mounting')

  // Add immediate state logging
  console.log('🔍 VIEWRENDERER: Initial render')

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<BobbinBridge | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewReady, setViewReady] = useState(false)

  // Use hardcoded API URL for testing - memoize to prevent re-calculation
  const apiBaseUrl = 'http://localhost:4000'

  // Memoize viewSrc to prevent unnecessary re-renders
  const viewSrc = useMemo(() => {
    // FORCE absolute URL to fix port issue
    const baseUrl = 'http://localhost:4000'
    const url = bobbinId && viewId && projectId
      ? `${baseUrl}/api/views/${bobbinId}/${viewId}?projectId=${projectId}`
      : ''
    console.log('🔧 viewSrc calculated (FIXED):', url, { bobbinId, viewId, projectId, baseUrl })
    return url
  }, [bobbinId, viewId, projectId])

  console.log('🚀 VIEWRENDERER viewSrc calculated:', viewSrc, 'mountId:', mountId.current)

  // Create bridge setup function with retry logic - useCallback to allow reuse
  const setupBridge = useCallback(async (attempt = 1, maxAttempts = 3) => {
    if (!iframeRef.current) {
      console.warn('⚠️ Iframe not ready for bridge setup')
      if (attempt < maxAttempts) {
        console.log(`🔄 Retrying bridge setup (attempt ${attempt + 1}/${maxAttempts})...`)
        setTimeout(() => setupBridge(attempt + 1, maxAttempts), 200 * attempt)
      }
      return
    }

    try {
      console.log(`🔧 Setting up bridge (attempt ${attempt}/${maxAttempts})`, mountId.current)

      // Create new bridge
      bridgeRef.current = new BobbinBridge(
        iframeRef.current,
        sdk,
        projectId,
        bobbinId,
        viewId
      )

      console.log('✅ BobbinBridge created successfully', mountId.current)

      // Set up view lifecycle handlers
      const originalHandleMessage = bridgeRef.current['handleMessage'].bind(bridgeRef.current)
      bridgeRef.current['handleMessage'] = async (message: any) => {
        if (message.type === 'VIEW_READY') {
          console.log('🎉 View ready! Setting loading=false, viewReady=true', mountId.current)
          setLoading(false)
          setViewReady(true)
          console.log('🎉 View ready - state updated!', mountId.current)
        } else if (message.type === 'VIEW_ERROR') {
          console.log('❌ View error! Setting loading=false', mountId.current)
          setLoading(false)
          setError(message.payload?.error || 'View failed to load')
          console.error('❌ View error:', message.payload)
        }

        return originalHandleMessage(message)
      }

      // Test the bridge immediately by trying to initialize context
      try {
        console.log('🔄 Testing bridge connection...', mountId.current)
        await bridgeRef.current.initializeContext()
        console.log('✅ Bridge connection test successful', mountId.current)
      } catch (contextError) {
        console.warn('⚠️ Bridge connection test failed:', contextError)
        throw contextError
      }

    } catch (err) {
      console.error(`❌ Failed to create BobbinBridge (attempt ${attempt}):`, err)

      if (attempt < maxAttempts) {
        console.log(`🔄 Retrying bridge setup (attempt ${attempt + 1}/${maxAttempts})...`)
        // Exponential backoff: 400ms, 800ms, 1200ms
        setTimeout(() => setupBridge(attempt + 1, maxAttempts), 400 * attempt)
      } else {
        setError(err instanceof Error ? err.message : 'Failed to initialize view communication after multiple attempts')
        setLoading(false)
      }
    }
  }, [sdk, projectId, bobbinId, viewId])

  useEffect(() => {
    console.log('🔄 Effect running for:', { projectId, bobbinId, viewId, mountId: mountId.current, loading, viewReady })

    // Don't proceed if no valid viewSrc
    if (!viewSrc) {
      console.log('❌ No valid viewSrc, setting loading=false, error=Missing required parameters')
      setLoading(false)
      setError('Missing required parameters')
      return
    }

    console.log('🔄 Setting loading=true, error=null, viewReady=false')
    setLoading(true)
    setError(null)
    setViewReady(false)

    // Cleanup any existing bridge first
    if (bridgeRef.current) {
      console.log('🧹 Cleaning up existing bridge')
      bridgeRef.current.destroy()
      bridgeRef.current = null
    }

    // Force iframe to reload with new URL
    if (iframeRef.current) {
      console.log('🔄 Forcing iframe reload for new view:', viewSrc)
      iframeRef.current.src = viewSrc
    }

    // Setup bridge with initial delay, then retry logic will handle failures
    const timer = setTimeout(() => setupBridge(), 300)

    // Cleanup function
    return () => {
      console.log('🧹 Cleaning up ViewRenderer effect', mountId.current)
      clearTimeout(timer)
      if (bridgeRef.current) {
        bridgeRef.current.destroy()
        bridgeRef.current = null
      }
    }
  }, [projectId, bobbinId, viewId, viewSrc])

  // Public methods for external control
  const updateTheme = async (theme: Theme) => {
    if (bridgeRef.current) {
      try {
        await bridgeRef.current.updateTheme(theme)
      } catch (error) {
        console.error('Failed to update theme:', error)
      }
    }
  }

  const retryConnection = () => {
    console.log('🔄 Manual retry triggered', mountId.current)
    setError(null)
    setLoading(true)
    setViewReady(false)

    // Clean up existing bridge first
    if (bridgeRef.current) {
      console.log('🧹 Cleaning up existing bridge for retry')
      bridgeRef.current.destroy()
      bridgeRef.current = null
    }

    if (iframeRef.current && viewSrc) {
      // Force iframe reload with proper URL
      iframeRef.current.src = ''
      setTimeout(() => {
        if (iframeRef.current) {
          console.log('🔄 Reloading iframe with URL:', viewSrc)
          iframeRef.current.src = viewSrc
          // Give iframe time to load, then setup bridge with retry logic
          setTimeout(() => setupBridge(), 500)
        }
      }, 100)
    }
  }

  // Expose methods for parent components if needed
  useEffect(() => {
    // Could expose methods via ref or context if needed
    return () => {
      if (bridgeRef.current) {
        bridgeRef.current.destroy()
      }
    }
  }, [])

  console.log('ViewRenderer debug:', {
    projectId,
    bobbinId,
    viewId,
    apiBaseUrl,
    viewSrc
  })

  // If we don't have required props, show error
  if (!viewSrc) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-500">
          <div>Invalid view configuration</div>
          <div className="text-sm mt-1">Missing projectId, bobbinId, or viewId</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col relative">
      {/* TEST DEBUG DIV - VERY OBVIOUS */}
      <div style={{ background: 'red', color: 'white', padding: '10px', fontSize: '16px', fontWeight: 'bold' }}>
        🔥 VIEWRENDERER IS ACTIVE 🔥 bobbinId={bobbinId} viewId={viewId} projectId={projectId}
      </div>

      {/* Enhanced loading state */}
      {loading && (
        <div className="absolute inset-0 bg-white bg-opacity-90 flex items-center justify-center z-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
            <div className="text-gray-600 text-sm">
              {viewReady ? 'Initializing view...' : 'Loading view...'}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {bobbinId}/{viewId}
            </div>
          </div>
        </div>
      )}

      {/* Enhanced error state */}
      {error && (
        <div className="absolute inset-0 bg-white flex items-center justify-center z-20">
          <div className="text-center max-w-md mx-auto p-6">
            <div className="text-red-600 text-lg font-medium mb-2">View Error</div>
            <div className="text-gray-600 text-sm mb-4 break-words">{error}</div>
            <div className="space-x-3">
              <button
                onClick={retryConnection}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Retry
              </button>
              <button
                onClick={() => {
                  setError(null)
                  // Don't reload, just hide error to show what we have
                }}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debug info in development */}
      {process.env.NODE_ENV === 'development' && viewReady && (
        <div className="absolute top-2 right-2 bg-green-100 text-green-800 px-2 py-1 rounded text-xs z-10">
          Bridge Active
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={viewSrc}
        className="flex-1 border-0 w-full h-full"
        // Security: allow-same-origin + allow-scripts is needed for postMessage communication
        // This is acceptable since views are served from same trusted domain with message validation
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        allow="clipboard-read; clipboard-write"
        onLoad={() => {
          console.log('📄 Iframe loaded, bridge will handle initialization', mountId.current)
          // Bridge setup and context initialization now handled in setupBridge function
          // This prevents race conditions and duplicate initialization attempts
        }}
        onError={(e) => {
          console.error('📄 Iframe error:', e)
          setLoading(false)
          setError('Failed to load view iframe')
        }}
        title={`${bobbinId} ${viewId} view`}
      />
    </div>
  )
}