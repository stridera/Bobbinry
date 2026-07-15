/**
 * Entity image-gallery helpers.
 *
 * Every entity's base image area is a small gallery: an ordered `images`
 * list plus one designated `thumbnail` (any gallery image, with an optional
 * crop rect so e.g. a full-body illustration can serve as its own portrait
 * thumbnail). The legacy `image_url` field is kept as a derived value —
 * always the resolved thumbnail URL — so older readers of entity data keep
 * working unchanged.
 *
 * NOTE: `deriveThumbnailUrl` in apps/api/src/routes/reader.ts mirrors the
 * read-side normalization here (the API can't import this package). Keep
 * them in lockstep.
 */

import type { CSSProperties } from 'react'
import type { EntityTypeDefinition } from './types'
import { setFieldOnEntity } from './variants'

/** Field name of the ordered gallery list inside entity data. */
export const GALLERY_FIELD = 'images'
/** Field name of the designated-thumbnail block inside entity data. */
export const THUMBNAIL_FIELD = 'thumbnail'

/**
 * Aspect ratio (width / height) that thumbnail crops are locked to. Card
 * grids render thumbnails in containers of this same aspect, so a crop
 * always fills its frame without distortion.
 */
export const THUMBNAIL_ASPECT = 3 / 4

export interface EntityImage {
  url: string
  caption?: string
  /** Accessibility text for the image; falls back to caption when unset. */
  alt?: string
  /** "Illustrated by" credit name. */
  artist?: string
  /** Optional link for the artist credit — render only via safeArtistUrl(). */
  artistUrl?: string
}

/** Crop rect normalized to [0..1] against the image's natural dimensions. */
export interface ThumbnailCrop {
  x: number
  y: number
  w: number
  h: number
}

export interface EntityThumbnail {
  /** Must match a gallery image's url — keyed by url so it survives reorders. */
  url: string
  crop?: ThumbnailCrop
}

export interface EntityGallery {
  images: EntityImage[]
  thumbnail: EntityThumbnail | null
}

function asImage(raw: unknown): EntityImage | null {
  if (typeof raw === 'string') return raw ? { url: raw } : null
  if (raw && typeof raw === 'object' && typeof (raw as any).url === 'string' && (raw as any).url) {
    const img: EntityImage = { url: (raw as any).url }
    for (const key of ['caption', 'alt', 'artist', 'artistUrl'] as const) {
      const value = (raw as any)[key]
      if (typeof value === 'string' && value) img[key] = value
    }
    return img
  }
  return null
}

/**
 * Artist-credit link safe to render as an anchor href. Entity data is
 * unvalidated jsonb that flows to the public reader, so only allow
 * http(s) URLs — anything else renders as plain text.
 */
export function safeArtistUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url
  } catch {
    // not a parseable absolute URL
  }
  return undefined
}

/** Alt text for an image: explicit alt, else caption, else the fallback. */
export function imageAltText(img: EntityImage | null | undefined, fallback?: string): string {
  return img?.alt || img?.caption || fallback || ''
}

function asCrop(raw: unknown): ThumbnailCrop | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { x, y, w, h } = raw as Record<string, unknown>
  if (
    typeof x !== 'number' || typeof y !== 'number' ||
    typeof w !== 'number' || typeof h !== 'number'
  ) return undefined
  if (!(w > 0 && w <= 1 && h > 0 && h <= 1)) return undefined
  if (x < 0 || y < 0 || x + w > 1.0001 || y + h > 1.0001) return undefined
  return { x, y, w, h }
}

/**
 * Normalized gallery for an entity's (variant-resolved) data.
 * Falls back to the legacy single `image_url` as a one-element gallery.
 */
export function getEntityImages(data: Record<string, any> | null | undefined): EntityImage[] {
  if (!data) return []
  const raw = data[GALLERY_FIELD]
  if (Array.isArray(raw)) {
    const images = raw.map(asImage).filter((img): img is EntityImage => img !== null)
    if (images.length > 0) return images
  }
  const legacy = data.image_url
  if (typeof legacy === 'string' && legacy) return [{ url: legacy }]
  return []
}

/**
 * Resolve the designated thumbnail: the stored `thumbnail` when its url is
 * still in the gallery, else the first gallery image, else null.
 */
export function getEntityThumbnail(data: Record<string, any> | null | undefined): EntityThumbnail | null {
  const images = getEntityImages(data)
  if (images.length === 0) return null
  const raw = data?.[THUMBNAIL_FIELD]
  if (raw && typeof raw === 'object' && typeof (raw as any).url === 'string') {
    const url = (raw as any).url as string
    if (images.some(img => img.url === url)) {
      const crop = asCrop((raw as any).crop)
      return crop ? { url, crop } : { url }
    }
  }
  return { url: images[0]!.url }
}

/**
 * Styles that render a crop of an image inside an `overflow-hidden`
 * container of THUMBNAIL_ASPECT: apply the wrapper styles to a
 * `position: relative` container and the image styles to the `<img>`.
 * Returns null when there's no crop — render the image `object-cover`.
 */
export function cropToCssStyles(crop: ThumbnailCrop | null | undefined): CSSProperties | null {
  if (!crop) return null
  return {
    position: 'absolute',
    width: `${100 / crop.w}%`,
    height: `${100 / crop.h}%`,
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${(-crop.y / crop.h) * 100}%`,
    maxWidth: 'none',
  }
}

/**
 * Drop empty entries and re-point the thumbnail at the first image when its
 * url no longer exists in the gallery (e.g. the thumbnail's image was removed).
 */
export function normalizeGallery(gallery: EntityGallery): EntityGallery {
  const images = gallery.images.filter(img => img.url)
  const thumbnail =
    gallery.thumbnail && images.some(img => img.url === gallery.thumbnail!.url)
      ? gallery.thumbnail
      : images.length > 0
        ? { url: images[0]!.url }
        : null
  return { images, thumbnail }
}

/**
 * Write a gallery (images + thumbnail) onto an entity, respecting the
 * active variant like any other versionable field, and keep the derived
 * legacy `image_url` in sync with the resolved thumbnail so pre-gallery
 * consumers of entity data keep working.
 */
export function setGalleryOnEntity(
  entity: Record<string, any>,
  typeConfig: Pick<EntityTypeDefinition, 'customFields' | 'versionableBaseFields'> | null | undefined,
  variantId: string | null | undefined,
  gallery: EntityGallery
): Record<string, any> {
  const { images, thumbnail } = normalizeGallery(gallery)

  let next = setFieldOnEntity(entity, typeConfig, variantId, GALLERY_FIELD, images)
  next = setFieldOnEntity(next, typeConfig, variantId, THUMBNAIL_FIELD, thumbnail)
  next = setFieldOnEntity(next, typeConfig, variantId, 'image_url', thumbnail?.url ?? null)
  return next
}
