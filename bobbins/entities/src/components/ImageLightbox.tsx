/**
 * Full-screen image lightbox with prev/next navigation for entity galleries.
 * Grew out of the single-image lightbox that lived in CompactCardLayout.
 */

import { useCallback, useEffect, useState } from 'react'
import type { EntityImage } from '../images'

interface ImageLightboxProps {
  images: EntityImage[]
  startIndex: number
  onClose: () => void
  /** When set, captions render as editable inputs and changes commit here. */
  onCaptionChange?: ((index: number, caption: string) => void) | undefined
}

export function ImageLightbox({ images, startIndex, onClose, onCaptionChange }: ImageLightboxProps) {
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
          alt={current.caption || ''}
          className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl cursor-default"
        />

        {onCaptionChange ? (
          <input
            type="text"
            value={current.caption ?? ''}
            onChange={e => onCaptionChange(index, e.target.value)}
            placeholder="Add a caption…"
            className="w-full max-w-md rounded-md border border-white/20 bg-black/40 px-3 py-1.5 text-center text-sm text-white placeholder:text-gray-400 focus:border-white/50 focus:outline-none"
          />
        ) : current.caption ? (
          <div className="max-w-md text-center text-sm text-gray-200">{current.caption}</div>
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
