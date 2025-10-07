'use client'

// Fixed: Moved hooks to correct order and added memoization to prevent iframe reload loop
import { useEffect, useState, useRef, ReactNode, useCallback, useMemo, memo } from 'react'
import { extensionRegistry, RegisteredExtension } from '@/lib/extensions'
import { ResizablePanelStack } from './ResizablePanelStack'
import { useTheme } from '@/contexts/ThemeContext'
import { MessageBuilder, sendToIframe, messageRouter, setupMessageListener, iframeBroadcaster } from '@/lib/message-router'
import { SHELL_MESSAGES, ShellConfig } from '@/types/shell-messages'

interface ExtensionSlotProps {
  slotId: string
  context?: any
  className?: string
  fallback?: ReactNode
}

// Memoized component for panel content to prevent unnecessary iframe reloads
const PanelContent = memo(function PanelContent({ 
  extension, 
  context, 
  theme,
  iframeRefs,
  buildShellConfig 
}: { 
  extension: RegisteredExtension
  context: any
  theme: string
  iframeRefs: React.MutableRefObject<Map<string, HTMLIFrameElement>>
  buildShellConfig: () => ShellConfig
}) {
  const Component = extension.component
  const isValidComponent = typeof Component === 'function'
  const isSandboxed = extension.contribution.entry?.endsWith('.html')

  if (isValidComponent) {
    return <Component {...context} context={context} />
  } else if (isSandboxed) {
    return (
      <iframe
        key={extension.id}
        ref={(el) => {
          if (el) {
            iframeRefs.current.set(extension.id, el)
            iframeBroadcaster.register(extension.id, el)
          } else {
            iframeRefs.current.delete(extension.id)
            iframeBroadcaster.unregister(extension.id)
          }
        }}
        onLoad={(e) => {
          const iframe = e.currentTarget
          setTimeout(() => {
            const config = buildShellConfig()
            const initMessage = MessageBuilder.shellInit(config, extension.bobbinId, extension.id)
            sendToIframe(iframe, initMessage)
            console.log(`[ExtensionSlot] Sent init config to iframe ${extension.id}`)
          }, 50)
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
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if extension ID, theme, or component changes
  return prevProps.extension.id === nextProps.extension.id &&
         prevProps.theme === nextProps.theme &&
         prevProps.extension.component === nextProps.extension.component
})

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

  // Helper to build shell config - memoized to prevent breaking PanelContent memo
  const buildShellConfig = useCallback((): ShellConfig => {
    return {
      theme: theme as 'light' | 'dark',
      projectId: context?.projectId || '',
      user: {
        id: 'user-1', // TODO: Get from auth context
        name: 'User',
      },
      locale: 'en',
      capabilities: ['read', 'write', 'create', 'delete'],
      api: {
        baseUrl: process.env.NODE_ENV === 'development' ? 'http://localhost:4000' : '',
      },
    }
  }, [theme, context])

  // Keep context ref up to date
  useEffect(() => {
    contextRef.current = context
  }, [context])

  // Message router setup - handle config requests and forward bus events
  useEffect(() => {
    // Handle config requests from iframes
    const unsubscribeConfigRequest = messageRouter.on(SHELL_MESSAGES.CONFIG_REQUEST, async (envelope) => {
      // Find which iframe sent the request
      iframeRefs.current.forEach((iframe) => {
        const config = buildShellConfig()
        const response = MessageBuilder.shellConfigResponse(config, envelope.metadata.requestId || '')
        sendToIframe(iframe, response)
      })
    })

    // Setup window message listener
    const cleanup = setupMessageListener(messageRouter, (event) => {
      // Only accept messages from our iframes or same origin
      const isFromIframe = Array.from(iframeRefs.current.values()).some(
        iframe => event.source === iframe.contentWindow
      )
      const isFromSameOrigin = event.origin === window.location.origin
      return isFromIframe || isFromSameOrigin
    })

    return () => {
      unsubscribeConfigRequest()
      cleanup()
    }
  }, [theme, context, buildShellConfig])

  // Send theme updates to iframes when theme changes
  useEffect(() => {
    const sendThemeToIframes = () => {
      const themeMessage = MessageBuilder.shellThemeUpdate(theme as 'light' | 'dark')
      iframeRefs.current.forEach((iframe) => {
        sendToIframe(iframe, themeMessage)
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

  // Memoize panels to prevent recreating iframes on every render
  const panels = useMemo(() => {
    return extensions.map(extension => ({
      id: extension.id,
      title: extension.contribution.title || extension.id,
      content: (
        <PanelContent
          extension={extension}
          context={context}
          theme={theme}
          iframeRefs={iframeRefs}
          buildShellConfig={buildShellConfig}
        />
      )
    }))
  }, [extensions, context, theme])

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

  // Use ResizablePanelStack for multiple extensions
  if (extensions.length > 1) {
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
        <PanelContent
          extension={extension}
          context={context}
          theme={theme}
          iframeRefs={iframeRefs}
          buildShellConfig={buildShellConfig}
        />
      </div>
    </div>
  )
}

export default ExtensionSlot