'use client'

import { useEffect, useState, useRef, ReactNode, useMemo, memo, useSyncExternalStore } from 'react'
import { extensionRegistry, RegisteredExtension } from '@/lib/extensions'
import { useExtensions } from './ExtensionProvider'

interface ExtensionSlotProps {
  slotId: string
  context?: any
  className?: string
  fallback?: ReactNode
  /**
   * Kept for call-site compatibility; every slot now renders inline. The
   * right panel column has its own host (RightPanelRail).
   */
  layout?: 'inline'
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
      <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 flex items-center justify-center mb-3">
        <span className="text-sm font-semibold">!</span>
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300">
        Native component unavailable for {extension.contribution.title || extension.id}
      </p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
        Sandboxed bobbin entries are no longer supported by the shell runtime.
      </p>
    </div>
  )
}, (prevProps, nextProps) => {
  return prevProps.extension.id === nextProps.extension.id &&
         prevProps.extension.component === nextProps.extension.component &&
         prevProps.context === nextProps.context
})

export function ExtensionSlot({
  slotId,
  context,
  className,
  fallback,
}: ExtensionSlotProps) {
  const extensionContext = useExtensions()
  const registeredCount = extensionContext?.extensions?.length ?? 0
  const contextRef = useRef(context)
  const [slotChangeVersion, setSlotChangeVersion] = useState(0)

  // SSR-safe hydration detection without synchronous setState in effects
  const isHydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)

  useEffect(() => {
    contextRef.current = context
  }, [context])

  // Compute extensions as derived state — no setState in effect body
  const extensions = useMemo(() => {
    if (!isHydrated) return []
    return extensionRegistry.getExtensionsForSlot(slotId, context)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, slotId, isHydrated, registeredCount, slotChangeVersion])

  // Subscribe to slot changes
  useEffect(() => {
    const unsubscribe = extensionRegistry.onSlotChange(slotId, () => {
      setSlotChangeVersion(v => v + 1)
    })
    return unsubscribe
  }, [slotId])

  if (!isHydrated) {
    if (fallback === null) return null
    return (
      <div className={className}>
        {fallback !== undefined ? fallback : (
          <div className="text-xs text-gray-400 animate-pulse">
            Loading {slotId}...
          </div>
        )}
      </div>
    )
  }

  if (extensions.length === 0) {
    return <>{fallback !== undefined ? fallback : <div className="text-xs text-gray-400">No extensions for {slotId}</div>}</>
  }

  return (
    <div className={className}>
      {extensions.map(extension => {
        const Component = extension.component
        if (typeof Component === 'function') {
          return <Component key={extension.id} {...context} context={context} />
        }
        return (
          <PanelContent
            key={extension.id}
            extension={extension}
            context={context}
          />
        )
      })}
    </div>
  )
}

export default ExtensionSlot
