/**
 * Full-screen image lightbox with prev/next navigation for entity galleries.
 * Grew out of the single-image lightbox that lived in CompactCardLayout.
 */

import { useCallback, useEffect, useState } from 'react'
import { imageAltText, type EntityImage } from '../images'
import { ImageCredit } from './ImageCredit'

interface ImageLightboxProps {
  images: EntityImage[]
  startIndex: number
  onClose: () => void
  /**
   * When set, image details (caption, alt text, artist credit) render as
   * editable inputs and changes commit here as a partial image patch.
   */
  onImageChange?: ((index: number, patch: Partial<EntityImage>) => void) | undefined
}

export function ImageLightbox({ images, startIndex, onClose, onImageChange }: ImageLightboxProps) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(startIndex, 0), Math.max(images.length - 1, 0))
  )

  const prev = useCallback(() => {
    setIndex(i => (i - 1 + images.length) % images.length)
  }, [images.length])
  const next = useCallback(() => {
    setIndex(i => (i + 1) % images.length)
  }, [images.length])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowLeft' && images.length > 1) {
        e.preventDefault()
        prev()
      } else if (e.key === 'ArrowRight' && images.length > 1) {
        e.preventDefault()
        next()
      }
    }
    // Capture phase so Escape closes the lightbox before any enclosing
    // modal's own Escape handler closes the whole dialog.
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [onClose, prev, next, images.length])

  const current = images[index]
  if (!current) return null

  const navButtonClass =
    'absolute top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/15 hover:bg-white/30 text-white text-xl flex items-center justify-center cursor-pointer transition-colors'
  const detailInputClass =
    'rounded-md border border-white/20 bg-black/40 px-3 py-1.5 text-white placeholder:text-gray-400 focus:border-white/50 focus:outline-none'

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-8 cursor-pointer"
      onClick={onClose}
      role="dialog"
      aria-label="Image viewer"
    >
      <div
        className="relative flex max-h-[90vh] max-w-5xl flex-col items-center gap-3"
        onClick={e => e.stopPropagation()}
      >
        <img
          src={current.url}
          alt={imageAltText(current)}
          className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl cursor-default"
        />

        {onImageChange ? (
          <div className="flex w-full max-w-md flex-col gap-1.5">
            <input
              type="text"
              value={current.caption ?? ''}
              onChange={e => onImageChange(index, { caption: e.target.value })}
              placeholder="Add a caption…"
              className={`${detailInputClass} text-center text-sm`}
            />
            <input
              type="text"
              value={current.alt ?? ''}
              onChange={e => onImageChange(index, { alt: e.target.value })}
              placeholder="Alt text (for screen readers)…"
              className={`${detailInputClass} text-xs`}
            />
            <div className="flex gap-1.5">
              <input
                type="text"
                value={current.artist ?? ''}
                onChange={e => onImageChange(index, { artist: e.target.value })}
                placeholder="Illustrated by…"
                className={`${detailInputClass} flex-1 text-xs`}
              />
              <input
                type="url"
                value={current.artistUrl ?? ''}
                onChange={e => onImageChange(index, { artistUrl: e.target.value })}
                placeholder="https://artist-link…"
                className={`${detailInputClass} flex-1 text-xs`}
              />
            </div>
          </div>
        ) : current.caption || current.artist ? (
          <div className="flex max-w-md flex-col items-center gap-0.5 text-center">
            {current.caption && <div className="text-sm text-gray-200">{current.caption}</div>}
            <ImageCredit image={current} className="!text-gray-400" />
          </div>
        ) : null}

        {images.length > 1 && (
          <div className="text-xs tabular-nums text-gray-400">
            {index + 1} / {images.length}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close image viewer"
          className="absolute -top-3 -right-3 w-8 h-8 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full shadow-lg flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-lg"
        >
          &times;
        </button>

        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label="Previous image"
              className={`${navButtonClass} -left-14`}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Next image"
              className={`${navButtonClass} -right-14`}
            >
              ›
            </button>
          </>
        )}
      </div>
    </div>
  )
}
