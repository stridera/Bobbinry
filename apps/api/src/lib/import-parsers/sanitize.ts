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
  p: ['style'],
  h1: ['style'], h2: ['style'], h3: ['style'],
  h4: ['style'], h5: ['style'], h6: ['style'],
}

// `style` is allowed on block-level text containers but locked to a single
// property — text-align — with a fixed value set. This lets us carry
// centered chapter titles and other Word-side alignment through to the
// Tiptap text-align extension. Anything outside this allowlist (background,
// font-size, expression(), …) is stripped.
const ALLOWED_STYLES: sanitizeHtml.IOptions['allowedStyles'] = {
  p: { 'text-align': [/^(left|center|right|justify)$/] },
  h1: { 'text-align': [/^(left|center|right|justify)$/] },
  h2: { 'text-align': [/^(left|center|right|justify)$/] },
  h3: { 'text-align': [/^(left|center|right|justify)$/] },
  h4: { 'text-align': [/^(left|center|right|justify)$/] },
  h5: { 'text-align': [/^(left|center|right|justify)$/] },
  h6: { 'text-align': [/^(left|center|right|justify)$/] },
}

export function sanitizeImportedHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedStyles: ALLOWED_STYLES,
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
