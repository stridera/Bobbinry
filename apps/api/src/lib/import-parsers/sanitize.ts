/**
 * HTML sanitizer for imported manuscripts. Whitelist matches what Tiptap's
 * starter-kit can parse — anything outside the list (script, iframe, on*
 * handlers, javascript: URLs, style with expression()) is stripped.
 *
 * Data URIs are tolerated on <img src> because later-phase parsers may
 * inline embedded images before the image-rewrite pass uploads them to S3.
 * Plain text/markdown imports never produce data URIs, so this is a no-op
 * for the current Phase-3 formats.
 */

import sanitizeHtml from 'sanitize-html'

const ALLOWED_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'em', 'u', 's',
  'blockquote', 'ul', 'ol', 'li',
  'a', 'img', 'hr', 'br',
  'code', 'pre',
]

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height', 'data-external-src', 'data-import-error'],
  hr: ['class'],
}

export function sanitizeImportedHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
    },
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
    },
  })
}
