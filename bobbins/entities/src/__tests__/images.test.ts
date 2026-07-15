import {
  cropToCssStyles,
  getEntityImages,
  getEntityThumbnail,
  setGalleryOnEntity,
} from '../images'
import { versionableFieldNames } from '../variants'

const typeConfig = {
  customFields: [],
  versionableBaseFields: ['description', 'image_url'],
}

describe('getEntityImages', () => {
  it('returns empty for no image data', () => {
    expect(getEntityImages({})).toEqual([])
    expect(getEntityImages(null)).toEqual([])
  })

  it('falls back to legacy image_url as a one-element gallery', () => {
    expect(getEntityImages({ image_url: 'a.png' })).toEqual([{ url: 'a.png' }])
  })

  it('prefers a non-empty images array over image_url', () => {
    const data = { image_url: 'stale.png', images: [{ url: 'a.png', caption: 'A' }, { url: 'b.png' }] }
    expect(getEntityImages(data)).toEqual([{ url: 'a.png', caption: 'A' }, { url: 'b.png' }])
  })

  it('falls back to image_url when images is empty or malformed', () => {
    expect(getEntityImages({ image_url: 'a.png', images: [] })).toEqual([{ url: 'a.png' }])
    expect(getEntityImages({ image_url: 'a.png', images: [{ nope: true }] })).toEqual([{ url: 'a.png' }])
  })

  it('tolerates string entries in the images array', () => {
    expect(getEntityImages({ images: ['a.png', { url: 'b.png' }] })).toEqual([{ url: 'a.png' }, { url: 'b.png' }])
  })
})

describe('getEntityThumbnail', () => {
  const images = [{ url: 'a.png' }, { url: 'b.png' }]

  it('returns null when there are no images at all', () => {
    expect(getEntityThumbnail({})).toBeNull()
  })

  it('uses the designated thumbnail when its url is in the gallery', () => {
    const crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }
    expect(getEntityThumbnail({ images, thumbnail: { url: 'b.png', crop } })).toEqual({ url: 'b.png', crop })
  })

  it('falls back to the first image on a dangling thumbnail url (crop dropped)', () => {
    const crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }
    expect(getEntityThumbnail({ images, thumbnail: { url: 'gone.png', crop } })).toEqual({ url: 'a.png' })
  })

  it('drops an invalid crop but keeps the thumbnail url', () => {
    expect(getEntityThumbnail({ images, thumbnail: { url: 'b.png', crop: { x: 0.9, y: 0, w: 0.5, h: 0.5 } } }))
      .toEqual({ url: 'b.png' })
    expect(getEntityThumbnail({ images, thumbnail: { url: 'b.png', crop: { x: 0, y: 0, w: 0, h: 0.5 } } }))
      .toEqual({ url: 'b.png' })
  })

  it('resolves for legacy image_url-only entities', () => {
    expect(getEntityThumbnail({ image_url: 'a.png' })).toEqual({ url: 'a.png' })
  })
})

describe('cropToCssStyles', () => {
  it('returns null without a crop', () => {
    expect(cropToCssStyles(null)).toBeNull()
    expect(cropToCssStyles(undefined)).toBeNull()
  })

  it('scales and offsets so the rect fills the container', () => {
    const styles = cropToCssStyles({ x: 0.25, y: 0.1, w: 0.5, h: 0.5 })!
    expect(styles.width).toBe('200%')
    expect(styles.height).toBe('200%')
    expect(styles.left).toBe('-50%')
    expect(styles.top).toBe('-20%')
  })
})

describe('setGalleryOnEntity', () => {
  it('writes images, thumbnail, and derived image_url to the base', () => {
    const next = setGalleryOnEntity({ name: 'Clint' }, typeConfig, null, {
      images: [{ url: 'full.png' }, { url: 'action.png' }],
      thumbnail: { url: 'full.png', crop: { x: 0.2, y: 0, w: 0.4, h: 0.4 } },
    })
    expect(next.images).toEqual([{ url: 'full.png' }, { url: 'action.png' }])
    expect(next.thumbnail).toEqual({ url: 'full.png', crop: { x: 0.2, y: 0, w: 0.4, h: 0.4 } })
    expect(next.image_url).toBe('full.png')
  })

  it('defaults the thumbnail to the first image when unset or dangling', () => {
    const next = setGalleryOnEntity({}, typeConfig, null, {
      images: [{ url: 'a.png' }],
      thumbnail: { url: 'removed.png' },
    })
    expect(next.thumbnail).toEqual({ url: 'a.png' })
    expect(next.image_url).toBe('a.png')
  })

  it('clears everything when the gallery is emptied', () => {
    const next = setGalleryOnEntity({ images: [{ url: 'a.png' }], image_url: 'a.png' }, typeConfig, null, {
      images: [],
      thumbnail: null,
    })
    expect(next.images).toEqual([])
    expect(next.thumbnail).toBeNull()
    expect(next.image_url).toBeNull()
  })

  it('writes to the active variant overrides when the fields are versionable', () => {
    const entity = {
      name: 'Clint',
      image_url: 'base.png',
      _variants: {
        axis_id: 'era',
        active: null,
        order: ['book2'],
        items: { book2: { label: 'Book 2', overrides: {} } },
      },
    }
    const next = setGalleryOnEntity(entity, typeConfig, 'book2', {
      images: [{ url: 'older.png' }],
      thumbnail: { url: 'older.png' },
    })
    // Base untouched
    expect(next.image_url).toBe('base.png')
    expect(next.images).toBeUndefined()
    // Overrides carry the era's gallery + derived image_url
    const overrides = next._variants.items.book2.overrides
    expect(overrides.images).toEqual([{ url: 'older.png' }])
    expect(overrides.thumbnail).toEqual({ url: 'older.png' })
    expect(overrides.image_url).toBe('older.png')
  })
})

describe('versionableFieldNames companion rule', () => {
  it('adds images/thumbnail when image_url is versionable', () => {
    const names = versionableFieldNames(typeConfig)
    expect(names.has('images')).toBe(true)
    expect(names.has('thumbnail')).toBe(true)
  })

  it('does not add them when image_url is not versionable', () => {
    const names = versionableFieldNames({ customFields: [], versionableBaseFields: ['description'] })
    expect(names.has('images')).toBe(false)
    expect(names.has('thumbnail')).toBe(false)
  })
})
