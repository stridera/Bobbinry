/**
 * Thumbnail crop picker: draw a rect over the image to choose which part
 * shows as the entity's card thumbnail. The rect is locked to
 * THUMBNAIL_ASPECT (3:4) in pixel space so it always fills the portrait
 * card frame without distortion; it's stored normalized to [0..1] against
 * the image's natural dimensions.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { THUMBNAIL_ASPECT, type ThumbnailCrop } from '../images'

interface ThumbnailCropModalProps {
  imageUrl: string
  initialCrop?: ThumbnailCrop | undefined
  onSave: (crop: ThumbnailCrop) => void
  onClose: () => void
}

/** Largest centered rect of THUMBNAIL_ASPECT (in displayed-pixel space), normalized. */
function defaultCrop(displayW: number, displayH: number): ThumbnailCrop {
  if (displayW <= 0 || displayH <= 0) return { x: 0, y: 0, w: 1, h: 1 }
  const rectW = Math.min(displayW, displayH * THUMBNAIL_ASPECT)
  const rectH = rectW / THUMBNAIL_ASPECT
  return {
    x: (displayW - rectW) / 2 / displayW,
    y: (displayH - rectH) / 2 / displayH,
    w: rectW / displayW,
    h: rectH / displayH,
  }
}

const round = (n: number) => Math.round(n * 10000) / 10000

export function ThumbnailCropModal({ imageUrl, initialCrop, onSave, onClose }: ThumbnailCropModalProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [crop, setCrop] = useState<ThumbnailCrop | null>(initialCrop ?? null)
  // Drag state lives in a ref — pointer moves shouldn't re-render anything
  // except through setCrop.
  const dragRef = useRef<{
    mode: 'move' | 'resize'
    startX: number
    startY: number
    startCrop: ThumbnailCrop
    imgW: number
    imgH: number
  } | null>(null)

  const handleImageLoad = useCallback(() => {
    if (crop) return
    const img = imgRef.current
    if (!img) return
    const rect = img.getBoundingClientRect()
    setCrop(defaultCrop(rect.width, rect.height))
  }, [crop])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [onClose])

  const startDrag = useCallback((e: React.PointerEvent, mode: 'move' | 'resize') => {
    e.preventDefault()
    e.stopPropagation()
    const img = imgRef.current
    if (!img || !crop) return
    const rect = img.getBoundingClientRect()
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: crop,
      imgW: rect.width,
      imgH: rect.height,
    }
  }, [crop])

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current
      if (!drag) return
      const { mode, startX, startY, startCrop, imgW, imgH } = drag
      const dx = (e.clientX - startX) / imgW
      const dy = (e.clientY - startY) / imgH

      if (mode === 'move') {
        setCrop({
          ...startCrop,
          x: Math.min(Math.max(startCrop.x + dx, 0), 1 - startCrop.w),
          y: Math.min(Math.max(startCrop.y + dy, 0), 1 - startCrop.h),
        })
        return
      }

      // Resize from the bottom-right handle, anchored at the top-left corner
      // and locked to THUMBNAIL_ASPECT in pixel space.
      const desiredPxW = Math.max((startCrop.w + dx) * imgW, 40)
      const maxPxW = Math.min(
        (1 - startCrop.x) * imgW,
        (1 - startCrop.y) * imgH * THUMBNAIL_ASPECT
      )
      const pxW = Math.min(desiredPxW, maxPxW)
      const pxH = pxW / THUMBNAIL_ASPECT
      setCrop({ ...startCrop, w: pxW / imgW, h: pxH / imgH })
    }
    function onUp() {
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const handleReset = useCallback(() => {
    const img = imgRef.current
    if (!img) return
    const rect = img.getBoundingClientRect()
    setCrop(defaultCrop(rect.width, rect.height))
  }, [])

  const handleSave = useCallback(() => {
    if (!crop) return
    onSave({ x: round(crop.x), y: round(crop.y), w: round(crop.w), h: round(crop.h) })
  }, [crop, onSave])

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-6"
      onClick={onClose}
      role="dialog"
      aria-label="Choose thumbnail crop"
    >
      <div
        className="flex max-h-[92vh] flex-col gap-3 rounded-xl bg-white p-4 shadow-2xl dark:bg-gray-900"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
            Thumbnail crop
            <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
              Drag to position, corner to resize
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            &times;
          </button>
        </div>

        <div className="relative select-none overflow-hidden rounded-lg bg-gray-950/40">
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            draggable={false}
            onLoad={handleImageLoad}
            className="block max-h-[70vh] max-w-[80vw] object-contain"
          />
          {crop && (
            <div
              onPointerDown={e => startDrag(e, 'move')}
              className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.w * 100}%`,
                height: `${crop.h * 100}%`,
              }}
            >
              <div
                onPointerDown={e => startDrag(e, 'resize')}
                className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-blue-500"
                aria-label="Resize crop"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Reset
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!crop}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save crop
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
