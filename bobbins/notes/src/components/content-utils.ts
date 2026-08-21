/**
 * Helpers for note `content`, which is stored as HTML.
 *
 * Notes created before the rich-text editor stored plain text. These helpers
 * let the editor and previews handle both shapes.
 */

const HTML_START = /^\s*</

export function looksLikeHtml(value: string): boolean {
  return HTML_START.test(value)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Convert legacy plain-text content into HTML paragraphs, preserving
 * blank-line paragraph breaks and single line breaks.
 */
export function plainTextToHtml(text: string): string {
  const trimmed = text.replace(/\r\n/g, '\n').trim()
  if (!trimmed) return ''
  return trimmed
    .split(/\n{2,}/)
    .map(para => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** Accept either legacy plain text or HTML and return HTML for the editor. */
export function normalizeNoteContent(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  return looksLikeHtml(value) ? value : plainTextToHtml(value)
}

/** Plain-text rendering of note content, for previews and search. */
export function noteContentToText(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  if (!looksLikeHtml(value)) return value
  return value
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
