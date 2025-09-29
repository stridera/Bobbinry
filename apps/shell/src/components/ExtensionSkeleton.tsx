import { ReactNode } from 'react'

interface ExtensionSkeletonProps {
  slotId: string
  className?: string
  fallback?: ReactNode
}

export function ExtensionSkeleton({ slotId, className, fallback }: ExtensionSkeletonProps) {
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

export default ExtensionSkeleton