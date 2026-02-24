'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { BobbinrySDK } from '@bobbinry/sdk'
import { BobbinBridge } from '../services/BobbinBridge'
import { Theme } from '../types/bobbin-messages'
import { config } from '@/lib/config'

interface SandboxedViewRendererProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
}

/**
 * Renders a sandboxed view in an iframe for third-party bobbins.
 * Provides security isolation through iframe sandbox and postMessage communication.
 */
export function SandboxedViewRenderer({
  projectId,
  bobbinId,
  viewId,
  sdk
}: SandboxedViewRendererProps) {
  const mountId = useRef(Math.random().toString(36).substr(2, 9))
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<BobbinBridge | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewReady, setViewReady] = useState(false)

  // Use hardcoded API URL for testing - memoize to prevent re-calculation
  const apiBaseUrl = config.apiUrl

  // Memoize viewSrc to prevent unnecessary re-renders
  const viewSrc = useMemo(() => {
    // FORCE absolute URL to fix port issue
    const baseUrl = config.apiUrl
    const url = bobbinId && viewId && projectId
      ? `${baseUrl}/api/views/${bobbinId}/${viewId}?projectId=${projectId}`
      : ''

    return url
  }, [bobbinId, viewId, projectId])

  useEffect(() => {
    // Don't proceed if no valid viewSrc
    if (!viewSrc) {
      setLoading(false)
      setError('Missing required parameters')
      return
    }

    setLoading(true)
    setError(null)
    setViewReady(false)

    // Cleanup any existing bridge first
    if (bridgeRef.current) {
      bridgeRef.current.destroy()
      bridgeRef.current = null
    }

    // Create bridge immediately to set up message handler BEFORE iframe loads
    // This ensures we don't miss the VIEW_SCRIPT_LOADED message
    if (iframeRef.current) {
      try {
        bridgeRef.current = new BobbinBridge(
          iframeRef.current,
          sdk,
          projectId,
          bobbinId,
          viewId
        )

        // Set up view lifecycle handlers
        const originalHandleMessage = bridgeRef.current['handleMessage'].bind(bridgeRef.current)
        bridgeRef.current['handleMessage'] = async (message: any) => {
          if (message.type === 'VIEW_READY') {
            setLoading(false)
            setViewReady(true)
          } else if (message.type === 'VIEW_ERROR') {
            setLoading(false)
            setError(message.payload?.error || 'View failed to load')
            console.error('View error:', message.payload)
          }

          return originalHandleMessage(message)
        }
      } catch (err) {
        console.error('Failed to create bridge:', err)
      }

      // Now set iframe src to trigger load
      iframeRef.current.src = viewSrc
    }

    // Cleanup function
    return () => {
      if (bridgeRef.current) {
        bridgeRef.current.destroy()
        bridgeRef.current = null
      }
    }
  }, [projectId, bobbinId, viewId, viewSrc, sdk])

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
    setError(null)
    setLoading(true)
    setViewReady(false)

    // Clean up existing bridge first
    if (bridgeRef.current) {
      bridgeRef.current.destroy()
      bridgeRef.current = null
    }

    if (iframeRef.current && viewSrc) {
      // Create new bridge immediately
      try {
        bridgeRef.current = new BobbinBridge(
          iframeRef.current,
          sdk,
          projectId,
          bobbinId,
          viewId
        )

        // Set up view lifecycle handlers
        const originalHandleMessage = bridgeRef.current['handleMessage'].bind(bridgeRef.current)
        bridgeRef.current['handleMessage'] = async (message: any) => {
          if (message.type === 'VIEW_READY') {
            setLoading(false)
            setViewReady(true)
          } else if (message.type === 'VIEW_ERROR') {
            setLoading(false)
            setError(message.payload?.error || 'View failed to load')
          }
          return originalHandleMessage(message)
        }
      } catch (err) {
        console.error('Failed to create bridge:', err)
      }

      // Force iframe reload
      iframeRef.current.src = ''
      setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.src = viewSrc
        }
      }, 100)
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (bridgeRef.current) {
        bridgeRef.current.destroy()
      }
    }
  }, [])

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
      {/* Enhanced loading state */}
      {loading && (
        <div className="absolute inset-0 bg-white bg-opacity-90 flex items-center justify-center z-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
            <div className="text-gray-600 text-sm">
              {viewReady ? 'Initializing view...' : 'Loading sandboxed view...'}
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
          Sandboxed (Bridge Active)
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
          console.log('[SandboxedViewRenderer] Iframe loaded, initializing context', mountId.current)
          // Iframe loaded, now initialize the context
          if (bridgeRef.current) {
            bridgeRef.current.initializeContext().catch(err => {
              console.error('Failed to initialize context:', err)
              setLoading(false)
              setError(err instanceof Error ? err.message : 'Failed to initialize view')
            })
          }
        }}
        onError={(e) => {
          console.error('[SandboxedViewRenderer] Iframe error:', e)
          setLoading(false)
          setError('Failed to load view iframe')
        }}
        title={`${bobbinId} ${viewId} view`}
      />
    </div>
  )
}