'use client'

/**
 * Crop-aware image for entity thumbnails: renders the author's chosen crop
 * rect inside an aspect-fixed frame (the caller supplies the aspect via
 * className, e.g. `aspect-[3/4]`). Tries the resized webp variant first and
 * falls back to the original on 404 (older uploads predate entity variants).
 */

import { useEffect, useState } from 'react'
import { cropToCssStyles, type ThumbnailCrop } from '@bobbinry/entities'
import { getVariantUrl } from '@/lib/image-url'

interface CroppedImageProps {
  src: string
  crop?: ThumbnailCrop | undefined
  variant: 'thumb' | 'medium'
  alt: string
  /** Classes for the clipping frame — must fix the aspect (e.g. `aspect-[3/4] w-full`). */
  className?: string
  imgClassName?: string
}

export function CroppedImage({ src, crop, variant, alt, className, imgClassName }: CroppedImageProps) {
  const [currentSrc, setCurrentSrc] = useState(() => getVariantUrl(src, variant))

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync derived state from props
    setCurrentSrc(getVariantUrl(src, variant))
  }, [src, variant])

  const cropStyles = cropToCssStyles(crop)

  return (
    <div className={`relative overflow-hidden ${className ?? ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={currentSrc}
        alt={alt}
        loading="lazy"
        draggable={false}
        style={cropStyles ?? undefined}
        className={cropStyles ? imgClassName : `absolute inset-0 h-full w-full object-cover ${imgClassName ?? ''}`}
        onError={() => {
          if (currentSrc !== src) setCurrentSrc(src)
        }}
      />
    </div>
  )
}
