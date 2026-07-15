/**
 * Entity image gallery — the base image area on every entity.
 *
 * Renders the designated thumbnail (with its crop) or hero image plus a
 * strip of the full gallery. In edit mode the strip supports multi-file
 * upload, drag reorder, set-as-thumbnail, crop adjustment, and removal;
 * captions are edited inside the lightbox. Readonly mode (entity editor
 * view mode and the public reader) keeps the strip + lightbox so readers
 * can expand any image.
 *
 * Writes go through the plain `onFieldChange(field, value)` layout contract
 * as three field writes — `images`, `thumbnail`, and the derived legacy
 * `image_url` — so era-scoped override routing in the editor's
 * handleFieldChange applies to the gallery exactly like any other field.
 */

import { useCallback, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  cropToCssStyles,
  getEntityImages,
  getEntityThumbnail,
  imageAltText,
  normalizeGallery,
  type EntityGallery,
  type EntityImage,
  type ThumbnailCrop,
} from '../images'
import { useUpload } from './UploadContext'
import { ImageCredit } from './ImageCredit'
import { ImageLightbox } from './ImageLightbox'
import { ThumbnailCropModal } from './ThumbnailCropModal'

interface EntityImageGalleryProps {
  /** Variant-resolved entity data (what the layout is rendering). */
  entity: Record<string, any>
  readonly?: boolean
  onFieldChange?: ((fieldName: string, value: any) => void) | undefined
  /** Shape of the primary image: portrait card (3:4), square, or full-width hero. */
  variant: 'portrait' | 'square' | 'hero'
  /** Height class for the hero variant, e.g. 'h-64'. */
  heroHeightClass?: string
  /** Rendered inside the primary image container (e.g. hero name overlay). */
  overlay?: React.ReactNode
}

export function EntityImageGallery({
  entity,
  readonly = false,
  onFieldChange,
  variant,
  heroHeightClass = 'h-64',
  overlay,
}: EntityImageGalleryProps) {
  const uploadCtx = useUpload()
  const images = getEntityImages(entity)
  const thumbnail = getEntityThumbnail(entity)

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [cropOpen, setCropOpen] = useState(false)
  const [uploadState, setUploadState] = useState<{ done: number; total: number } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canEdit = !readonly && !!onFieldChange

  const commit = useCallback((gallery: EntityGallery) => {
    if (!onFieldChange) return
    const { images: nextImages, thumbnail: nextThumbnail } = normalizeGallery(gallery)
    onFieldChange('images', nextImages)
    onFieldChange('thumbnail', nextThumbnail)
    onFieldChange('image_url', nextThumbnail?.url ?? null)
  }, [onFieldChange])

  const handleFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return
    if (!uploadCtx) {
      setUploadError('Upload not available in this context')
      return
    }
    setUploadError(null)
    setUploadState({ done: 0, total: imageFiles.length })
    const added: EntityImage[] = []
    try {
      for (const file of imageFiles) {
        const result = await uploadCtx.sdk.uploads.upload({
          file,
          projectId: uploadCtx.projectId,
          context: 'entity',
        })
        added.push({ url: result.url })
        setUploadState(s => (s ? { ...s, done: s.done + 1 } : s))
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadState(null)
    }
    if (added.length > 0) {
      commit({ images: [...images, ...added], thumbnail })
    }
  }, [uploadCtx, images, thumbnail, commit])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) void handleFiles(files)
    e.target.value = ''
  }, [handleFiles])

  const handleRemove = useCallback((url: string) => {
    commit({ images: images.filter(img => img.url !== url), thumbnail })
  }, [images, thumbnail, commit])

  const handleSetThumbnail = useCallback((url: string) => {
    commit({ images, thumbnail: { url } })
  }, [images, commit])

  const handleCropSave = useCallback((crop: ThumbnailCrop) => {
    if (!thumbnail) return
    setCropOpen(false)
    commit({ images, thumbnail: { url: thumbnail.url, crop } })
  }, [images, thumbnail, commit])

  const handleImageChange = useCallback((index: number, patch: Partial<EntityImage>) => {
    const next = images.map((img, i) => {
      if (i !== index) return img
      const merged: EntityImage = { ...img, ...patch }
      // Empty strings mean "cleared" — drop the key entirely.
      for (const key of Object.keys(patch) as (keyof EntityImage)[]) {
        if (key !== 'url' && !merged[key]) delete merged[key]
      }
      return merged
    })
    commit({ images: next, thumbnail })
  }, [images, thumbnail, commit])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = images.findIndex(img => img.url === active.id)
    const to = images.findIndex(img => img.url === over.id)
    if (from < 0 || to < 0) return
    commit({ images: arrayMove(images, from, to), thumbnail })
  }, [images, thumbnail, commit])

  const thumbnailIndex = thumbnail ? images.findIndex(img => img.url === thumbnail.url) : -1
  const heroIndex = 0
  // Image whose credit shows under the primary: the hero for hero layouts,
  // else the designated thumbnail (falling back to the first image).
  const primaryImage =
    variant === 'hero'
      ? images[heroIndex] ?? null
      : images[thumbnailIndex >= 0 ? thumbnailIndex : 0] ?? null

  if (images.length === 0 && !canEdit) return null

  // --- Primary image -------------------------------------------------------

  let primary: React.ReactNode = null
  if (images.length === 0) {
    // Edit-mode empty state: dropzone.
    primary = (
      <div
        onDrop={e => {
          e.preventDefault()
          setDragOver(false)
          void handleFiles(Array.from(e.dataTransfer.files))
        }}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
        className={`w-full ${variant === 'hero' ? 'min-h-[120px]' : 'aspect-[3/4]'} border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all ${
          dragOver
            ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-900/20 scale-[1.01]'
            : 'border-gray-300/60 dark:border-gray-600/60 hover:border-gray-400 dark:hover:border-gray-500 bg-gray-50/50 dark:bg-gray-800/30'
        }`}
      >
        {uploadState ? (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Uploading {uploadState.done + 1}/{uploadState.total}…
          </span>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-gray-400 dark:text-gray-500 px-4 py-6">
            <svg className="w-9 h-9 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-sm text-center">Drop images or click to browse</span>
          </div>
        )}
      </div>
    )
  } else if (variant === 'hero') {
    const hero = images[heroIndex]!
    primary = (
      <div className={`w-full ${heroHeightClass} relative overflow-hidden`}>
        <img
          src={hero.url}
          alt={imageAltText(hero, entity.name || 'Entity')}
          className="w-full h-full object-cover cursor-pointer"
          onClick={() => setLightboxIndex(heroIndex)}
        />
        {overlay}
      </div>
    )
  } else {
    const aspectClass = variant === 'square' ? 'aspect-square' : 'aspect-[3/4]'
    const cropStyles = cropToCssStyles(thumbnail?.crop)
    const primaryIndex = thumbnailIndex >= 0 ? thumbnailIndex : 0
    const primaryAlt = imageAltText(images[primaryIndex], entity.name || 'Entity')
    primary = (
      <div
        className={`relative w-full ${aspectClass} overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 shadow-md bg-gray-100 dark:bg-gray-800 cursor-pointer group/primary`}
        onClick={() => setLightboxIndex(primaryIndex)}
      >
        {cropStyles ? (
          <img src={thumbnail!.url} alt={primaryAlt} style={cropStyles} draggable={false} />
        ) : (
          <img
            src={thumbnail?.url ?? images[0]!.url}
            alt={primaryAlt}
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
        )}
        {overlay}
        {canEdit && (
          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1.5 bg-gradient-to-t from-black/50 to-transparent pb-2 pt-6 opacity-0 transition-opacity group-hover/primary:opacity-100">
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setCropOpen(true) }}
              className="px-2.5 py-1 bg-white/90 text-gray-800 rounded text-xs font-medium hover:bg-white cursor-pointer"
            >
              Adjust crop
            </button>
          </div>
        )}
      </div>
    )
  }

  // --- Thumbnail strip ------------------------------------------------------

  const showStrip = images.length > 1 || (canEdit && images.length > 0)
  const strip = showStrip ? (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={images.map(img => img.url)} strategy={horizontalListSortingStrategy}>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {images.map((img, i) => (
            <StripTile
              key={img.url}
              image={img}
              isThumbnail={i === thumbnailIndex}
              canEdit={canEdit}
              onOpen={() => setLightboxIndex(i)}
              onSetThumbnail={() => handleSetThumbnail(img.url)}
              onAdjustCrop={() => setCropOpen(true)}
              onRemove={() => handleRemove(img.url)}
            />
          ))}
          {canEdit && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!!uploadState}
              title="Add images"
              className="flex h-14 w-14 items-center justify-center rounded-md border-2 border-dashed border-gray-300/70 text-xl text-gray-400 transition-colors hover:border-gray-400 hover:text-gray-500 dark:border-gray-600/70 dark:text-gray-500 dark:hover:border-gray-500 disabled:opacity-50"
            >
              {uploadState ? (
                <span className="text-[10px] tabular-nums">{uploadState.done + 1}/{uploadState.total}</span>
              ) : (
                '+'
              )}
            </button>
          )}
        </div>
      </SortableContext>
    </DndContext>
  ) : null

  return (
    <div>
      {primary}
      <ImageCredit image={primaryImage} className={variant === 'hero' ? 'px-4 pt-1.5' : 'pt-1'} />
      {strip}

      {canEdit && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={handleFileInput}
          className="hidden"
        />
      )}
      {uploadError && <p className="mt-1 text-xs text-red-500">{uploadError}</p>}

      {lightboxIndex !== null && (
        <ImageLightbox
          images={images}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onImageChange={canEdit ? handleImageChange : undefined}
        />
      )}
      {cropOpen && thumbnail && (
        <ThumbnailCropModal
          imageUrl={thumbnail.url}
          initialCrop={thumbnail.crop}
          onSave={handleCropSave}
          onClose={() => setCropOpen(false)}
        />
      )}
    </div>
  )
}

function StripTile({
  image,
  isThumbnail,
  canEdit,
  onOpen,
  onSetThumbnail,
  onAdjustCrop,
  onRemove,
}: {
  image: EntityImage
  isThumbnail: boolean
  canEdit: boolean
  onOpen: () => void
  onSetThumbnail: () => void
  onAdjustCrop: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: image.url,
    disabled: !canEdit,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`group/tile relative h-14 w-14 overflow-hidden rounded-md border ${
        isThumbnail
          ? 'border-blue-500 ring-1 ring-blue-500'
          : 'border-gray-200 dark:border-gray-700'
      } ${isDragging ? 'z-10 opacity-70' : ''} cursor-pointer bg-gray-100 dark:bg-gray-800`}
      onClick={onOpen}
      title={image.caption || undefined}
    >
      <img src={image.url} alt={imageAltText(image)} className="h-full w-full object-cover" draggable={false} />
      {isThumbnail && (
        <span
          className="absolute left-0.5 top-0.5 rounded bg-blue-600 px-1 text-[9px] font-semibold uppercase leading-3 text-white"
          title="Shown as the card thumbnail"
        >
          thumb
        </span>
      )}
      {canEdit && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center gap-0.5 bg-black/45 py-0.5 opacity-0 transition-opacity group-hover/tile:opacity-100">
          {isThumbnail ? (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onAdjustCrop() }}
              title="Adjust thumbnail crop"
              className="flex h-4 w-4 items-center justify-center rounded text-[10px] text-white hover:bg-white/25"
            >
              ✂
            </button>
          ) : (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onSetThumbnail() }}
              title="Use as thumbnail"
              className="flex h-4 w-4 items-center justify-center rounded text-[10px] text-white hover:bg-white/25"
            >
              ★
            </button>
          )}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onRemove() }}
            title="Remove image"
            className="flex h-4 w-4 items-center justify-center rounded text-[10px] text-white hover:bg-white/25"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
