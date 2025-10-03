'use client'

import { useEffect, useState, useRef, ReactNode, useCallback } from 'react'
import { extensionRegistry, RegisteredExtension } from '@/lib/extensions'
import { ResizablePanelStack } from './ResizablePanelStack'
import { useTheme } from '@/contexts/ThemeContext'

interface ExtensionSlotProps {
  slotId: string
  context?: any
  className?: string
  fallback?: ReactNode
}

export function ExtensionSlot({
  slotId,
  context,
  className,
  fallback
}: ExtensionSlotProps) {
  const { theme } = useTheme()
  const [extensions, setExtensions] = useState<RegisteredExtension[]>([])
  const [isHydrated, setIsHydrated] = useState(false)
  const contextRef = useRef(context)
  const iframeRefs = useRef<Map<string, HTMLIFrameElement>>(new Map())

  // Keep context ref up to date
  useEffect(() => {
    contextRef.current = context
  }, [context])

  // Message bus bridge - forward messages to sandboxed iframes
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Forward all bus messages to sandboxed iframes
      if (event.data && event.data.type === 'bus:event') {
        iframeRefs.current.forEach((iframe) => {
          iframe.contentWindow?.postMessage(event.data, '*')
        })
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Send theme information to iframes when they load or theme changes
  useEffect(() => {
    const sendThemeToIframes = () => {
      iframeRefs.current.forEach((iframe) => {
        iframe.contentWindow?.postMessage({
          type: 'shell:theme',
          theme
        }, '*')
      })
    }

    // Small delay to ensure iframes are loaded
    const timeout = setTimeout(sendThemeToIframes, 100)
    return () => clearTimeout(timeout)
  }, [theme, extensions])

  // Update extensions whenever context changes
  useEffect(() => {
    if (!isHydrated) return

    const currentExtensions = extensionRegistry.getExtensionsForSlot(slotId, context)
    console.log(`[ExtensionSlot] ${slotId} - Extensions updated due to context change:`, currentExtensions)
    setExtensions(currentExtensions)
  }, [context, slotId, isHydrated])

  // Hydration and subscription (only depends on slotId)
  useEffect(() => {
    setIsHydrated(true)

    // Get initial extensions
    const updateExtensions = () => {
      const currentExtensions = extensionRegistry.getExtensionsForSlot(slotId, contextRef.current)
      console.log(`[ExtensionSlot] ${slotId} - Extensions updated:`, currentExtensions.length, 'extensions')
      setExtensions(currentExtensions)
    }

    updateExtensions()
    console.log(`[ExtensionSlot] ${slotId} - All extensions in registry:`, extensionRegistry.getAllExtensions())

    // Listen for changes to this slot - use ref to get current context
    const unsubscribe = extensionRegistry.onSlotChange(slotId, () => {
      console.log(`[ExtensionSlot] ${slotId} - Slot change notification received`)
      updateExtensions()
    })

    return unsubscribe
  }, [slotId])

  // Show skeleton while hydrating
  if (!isHydrated) {
    return (
      <div className={className}>
        {fallback || (
          <div className="text-xs text-gray-400 animate-pulse">
            Loading {slotId}...
          </div>
        )}
      </div>
    )
  }

  // Show fallback if no extensions
  if (extensions.length === 0) {
    return <>{fallback || <div className="text-xs text-gray-400">No extensions for {slotId}</div>}</>
  }

  // Helper function to render extension content
  const renderExtensionContent = (extension: RegisteredExtension) => {
    const Component = extension.component
    const isValidComponent = typeof Component === 'function'
    const isSandboxed = extension.contribution.entry?.endsWith('.html')

    if (isValidComponent) {
      return <Component context={context} />
    } else if (isSandboxed) {
      return (
        <iframe
          ref={(el) => {
            if (el) {
              iframeRefs.current.set(extension.id, el)
            } else {
              iframeRefs.current.delete(extension.id)
            }
          }}
          src={`/bobbins/${extension.bobbinId}/${extension.contribution.entry}`}
          className="w-full h-full border-0"
          title={extension.contribution.title || extension.id}
          sandbox="allow-scripts allow-same-origin"
        />
      )
    } else {
      return (
        <div className="text-xs text-gray-400">
          Loading {extension.contribution.title || extension.id}...
        </div>
      )
    }
  }

  // Use ResizablePanelStack for multiple extensions
  if (extensions.length > 1) {
    const panels = extensions.map(extension => ({
      id: extension.id,
      title: extension.contribution.title || extension.id,
      content: renderExtensionContent(extension)
    }))

    return (
      <div className={className}>
        <ResizablePanelStack panels={panels} slotId={slotId} />
      </div>
    )
  }

  // Single extension - use original simple layout
  const extension = extensions[0]!
  return (
    <div className={className}>
      <div className="h-full">
        {renderExtensionContent(extension)}
      </div>
    </div>
  )
}

export default ExtensionSlot