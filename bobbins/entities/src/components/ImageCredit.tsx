/**
 * "Illustrated by" artist-credit line for a gallery image. Renders nothing
 * when the image has no artist; the link only renders when the artist URL
 * passes safeArtistUrl (untrusted entity data reaches the public reader).
 */

import { safeArtistUrl, type EntityImage } from '../images'

export function ImageCredit({
  image,
  className = '',
}: {
  image: EntityImage | null | undefined
  className?: string
}) {
  if (!image?.artist) return null
  const href = safeArtistUrl(image.artistUrl)

  return (
    <div className={`text-xs text-gray-500 dark:text-gray-400 ${className}`}>
      Illustrated by{' '}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-gray-400/60 underline-offset-2 hover:text-gray-700 dark:hover:text-gray-200"
          onClick={e => e.stopPropagation()}
        >
          {image.artist}
        </a>
      ) : (
        <span>{image.artist}</span>
      )}
    </div>
  )
}
