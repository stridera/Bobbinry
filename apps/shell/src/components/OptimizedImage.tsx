'use client'

import { useState, useEffect } from 'react'
import { getVariantUrl } from '@/lib/image-url'

interface OptimizedImageProps {
  src: string
  variant: 'thumb' | 'medium'
  alt: string
  className?: string
  onError?: () => void
}

export function OptimizedImage({ src, variant, alt, className, onError }: OptimizedImageProps) {
  const [currentSrc, setCurrentSrc] = useState(() => getVariantUrl(src, variant))
  const [failed, setFailed] = useState(false)

  // Reset when the source image changes (e.g. after a new upload)
  useEffect(() => {
    setCurrentSrc(getVariantUrl(src, variant))
    setFailed(false)
  }, [src, variant])

  if (failed) return null

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      onError={() => {
        if (currentSrc !== src) {
          // Variant failed, fall back to original
          setCurrentSrc(src)
        } else {
          // Original also failed
          setFailed(true)
          onError?.()
        }
      }}
    />
  )
}
