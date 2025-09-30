'use client'

import { useEffect, useState, ReactNode } from 'react'
import { extensionRegistry, RegisteredExtension } from '@/lib/extensions'

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
  const [extensions, setExtensions] = useState<RegisteredExtension[]>([])
  const [isHydrated, setIsHydrated] = useState(false)

  // Hydration-safe initialization
  useEffect(() => {
    setIsHydrated(true)

    // Get initial extensions
    const currentExtensions = extensionRegistry.getExtensionsForSlot(slotId, context)
    setExtensions(currentExtensions)

    // Listen for changes to this slot
    const unsubscribe = extensionRegistry.onSlotChange(slotId, (updatedExtensions) => {
      setExtensions(updatedExtensions)
    })

    return unsubscribe
  }, [slotId, context])

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

  return (
    <div className={className}>
      {extensions.map((extension) => {
        const Component = extension.component
        return (
          <div key={extension.id}>
            {Component ? (
              <Component context={context} />
            ) : (
              <div className="text-xs text-red-400">
                Extension {extension.contribution.title || extension.id} has no component
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default ExtensionSlot