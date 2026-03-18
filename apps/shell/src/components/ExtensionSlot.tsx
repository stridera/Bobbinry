'use client'

import { useEffect, useState, useRef, ReactNode, useMemo, memo } from 'react'
import { extensionRegistry, RegisteredExtension } from '@/lib/extensions'
import { useExtensions } from './ExtensionProvider'
import { ResizablePanelStack } from './ResizablePanelStack'

interface ExtensionSlotProps {
  slotId: string
  context?: any
  className?: string
  fallback?: ReactNode
  layout?: 'stacked' | 'inline'
}

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
  layout = 'stacked'
}: ExtensionSlotProps) {
  const extensionContext = useExtensions()
  const registeredCount = extensionContext?.extensions?.length ?? 0
  const [extensions, setExtensions] = useState<RegisteredExtension[]>([])
  const [isHydrated, setIsHydrated] = useState(false)
  const contextRef = useRef(context)

  useEffect(() => {
    contextRef.current = context
  }, [context])

  useEffect(() => {
    if (!isHydrated) return

    const currentExtensions = extensionRegistry.getExtensionsForSlot(slotId, context)
    setExtensions(currentExtensions)
  }, [context, slotId, isHydrated, registeredCount])

  useEffect(() => {
    setIsHydrated(true)

    const updateExtensions = () => {
      const currentExtensions = extensionRegistry.getExtensionsForSlot(slotId, contextRef.current)
      setExtensions(currentExtensions)
    }

    updateExtensions()

    const unsubscribe = extensionRegistry.onSlotChange(slotId, () => {
      updateExtensions()
    })

    return unsubscribe
  }, [slotId])

  const panels = useMemo(() => {
    return extensions.map(extension => ({
      id: extension.id,
      title: extension.contribution.title || extension.id,
      content: (
        <PanelContent
          extension={extension}
          context={context}
        />
      )
    }))
  }, [extensions, context])

  const slot = useMemo(() => extensionRegistry.getSlot(slotId), [slotId])

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

  if (layout === 'inline') {
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

  // Use ResizablePanelStack for all extensions (single or multiple)
  return (
    <div className={className}>
      <ResizablePanelStack
        panels={panels}
        slotId={slotId}
        singlePanel={extensions.length === 1}
        contextKey={context?.bobbinId}
        {...(slot?.maxContributions !== undefined ? { defaultVisibleCount: slot.maxContributions } : {})}
      />
    </div>
  )
}

export default ExtensionSlot
