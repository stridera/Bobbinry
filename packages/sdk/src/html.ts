interface SanitizedHtmlProps {
  __html: string
}

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'formaction'])
const BLOCKED_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta']

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isSafeUrl(rawValue: string): boolean {
  if (!rawValue) return true
  if (rawValue.startsWith('#') || rawValue.startsWith('/') || rawValue.startsWith('./') || rawValue.startsWith('../')) {
    return true
  }

  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://bobbinry.local'
    const parsed = new URL(rawValue, base)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:' || parsed.protocol === 'tel:') {
      return true
    }

    return parsed.protocol === 'data:' && parsed.pathname.startsWith('image/')
  } catch {
    return false
  }
}

/**
 * No-DOM fallback for `sanitizeHtml`, used wherever `DOMParser` is absent —
 * Node (which has never shipped it), SSR and Server Components, route
 * handlers, Web Workers, and edge runtimes.
 *
 * This deliberately degrades to inert plain text rather than attempting to
 * sanitize markup, because sanitizing HTML with regexes does not work. The
 * previous implementation tried, and leaked in at least two ways: it only
 * stripped *quoted* handler values, so `<img src=x onerror=alert(1)>` passed
 * straight through, and its `<script>` pattern required a closing tag, so
 * `<script>alert(1)` survived intact.
 *
 * Nothing renders sanitized HTML outside the browser today, so this changes no
 * current output. It exists so that if something ever does, the result is
 * visibly stripped of formatting — and, under React, a loud hydration mismatch
 * — instead of silently unsafe. If server-side rich text is ever genuinely
 * needed, add a real sanitizer here; do not reintroduce regexes.
 */
function sanitizeHtmlFallback(input: string): string {
  // Strip tags to readable text, then escape so anything the strip missed is
  // rendered as literal characters rather than markup.
  return escapeHtml(htmlToPlainText(input))
}

export function sanitizeHtml(html: string | null | undefined): string {
  const input = typeof html === 'string' ? html : ''

  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return sanitizeHtmlFallback(input)
  }

  const parser = new DOMParser()
  const document = parser.parseFromString(input, 'text/html')

  BLOCKED_TAGS.forEach((tagName) => {
    document.querySelectorAll(tagName).forEach((node) => node.remove())
  })

  document.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()

      if (name.startsWith('on') || name === 'style') {
        element.removeAttribute(attribute.name)
        continue
      }

      if (URL_ATTRS.has(name) && !isSafeUrl(value)) {
        element.removeAttribute(attribute.name)
      }
    }
  })

  return document.body.innerHTML
}

export function getSanitizedHtmlProps(html: string | null | undefined): SanitizedHtmlProps {
  return { __html: sanitizeHtml(html) }
}

export function escapePlainText(text: string | null | undefined): string {
  return escapeHtml(typeof text === 'string' ? text : '')
}

/**
 * Strip all HTML tags and decode common entities so a rich-text field can be
 * rendered as a short text preview (card subtitles, line-clamped descriptions,
 * metadata slots). Whitespace is collapsed so `<p>A</p><p>B</p>` becomes
 * `"A B"` rather than `"A\nB"`. Use this for plain-text slots; use
 * `sanitizeHtml` / `getSanitizedHtmlProps` when you actually want formatting.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  if (typeof html !== 'string' || html.length === 0) return ''

  let text: string
  if (typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    text = doc.body.textContent ?? ''
  } else {
    text = html.replace(/<[^>]*>/g, ' ')
  }

  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
