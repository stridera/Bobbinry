/**
 * Inline, theme-aware highlight for the paragraph being read.
 *
 * Inline styles (not a class) because the reader page already styles marks
 * inline per theme and no bobbin ships CSS. Previous inline values are stashed
 * on a data attribute so clearing restores exactly what was there.
 */

export type ReaderTheme = 'light' | 'dark' | 'sepia'

const PREV_ATTR = 'data-reader-tts-prev'

const HIGHLIGHT_COLORS: Record<ReaderTheme, string> = {
  light: 'rgba(59, 130, 246, 0.12)',
  dark: 'rgba(96, 165, 250, 0.18)',
  sepia: 'rgba(180, 83, 9, 0.14)',
}

interface SavedStyle {
  backgroundColor: string
  borderRadius: string
  transition: string
}

export function highlightSegment(
  el: HTMLElement,
  theme: ReaderTheme = 'light',
  options: { scroll?: boolean } = {}
): void {
  if (!el.hasAttribute(PREV_ATTR)) {
    const saved: SavedStyle = {
      backgroundColor: el.style.backgroundColor,
      borderRadius: el.style.borderRadius,
      transition: el.style.transition,
    }
    el.setAttribute(PREV_ATTR, JSON.stringify(saved))
  }
  el.style.transition = 'background-color 200ms ease'
  el.style.borderRadius = '0.25rem'
  el.style.backgroundColor = HIGHLIGHT_COLORS[theme] ?? HIGHLIGHT_COLORS.light

  if (options.scroll !== false && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

export function clearHighlight(el: HTMLElement | null | undefined): void {
  if (!el) return
  const raw = el.getAttribute(PREV_ATTR)
  if (raw === null) return
  let saved: SavedStyle = { backgroundColor: '', borderRadius: '', transition: '' }
  try {
    saved = { ...saved, ...(JSON.parse(raw) as Partial<SavedStyle>) }
  } catch {
    // fall through with empty values
  }
  el.style.backgroundColor = saved.backgroundColor
  el.style.borderRadius = saved.borderRadius
  el.style.transition = saved.transition
  el.removeAttribute(PREV_ATTR)
}
