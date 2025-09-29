'use client'

import { useEffect, useState, ReactNode } from 'react'
import { extensionRegistry, RegisteredExtension } from '@/lib/extensions'

interface ExtensionSlotClientProps {
  slotId: string
  context?: any
  className?: string
  fallback?: ReactNode
}

export function ExtensionSlotClient({
  slotId,
  context,
  className,
  fallback
}: ExtensionSlotClientProps) {
  const [extensions, setExtensions] = useState<RegisteredExtension[]>([])

  // Get extensions for this slot
  useEffect(() => {
    // Get initial extensions
    const currentExtensions = extensionRegistry.getExtensionsForSlot(slotId, context)
    setExtensions(currentExtensions)

    // Listen for changes to this slot
    const unsubscribe = extensionRegistry.onSlotChange(slotId, (updatedExtensions) => {
      setExtensions(updatedExtensions)
    })

    return unsubscribe
  }, [slotId, context])

  if (extensions.length === 0) {
    return <>{fallback || <div className="text-xs text-gray-400">No extensions for {slotId}</div>}</>
  }

  return (
    <div className={className}>
      {extensions.map((extension) => (
        <div key={extension.id}>
          {extension.component ? (
            <extension.component {...(extension.contribution.props || {})} context={context} />
          ) : (
            <div className="text-xs text-red-400">
              Extension {extension.contribution.title || extension.id} has no component
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default ExtensionSlotClient