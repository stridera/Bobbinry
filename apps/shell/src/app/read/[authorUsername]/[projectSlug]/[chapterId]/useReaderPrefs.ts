import { useCallback, useState } from 'react'
import {
  READER_PREFS_KEY,
  WIDTHS,
  type EntityHighlightStyle,
  type EntityInfoDisplay,
  type FontSize,
  type ReaderPrefs,
  type ReaderTheme,
} from './types'

const FONT_SIZES = new Set<FontSize>(['small', 'medium', 'large', 'xlarge'])
const THEMES = new Set<ReaderTheme>(['light', 'dark', 'sepia'])
const HIGHLIGHT_STYLES = new Set<EntityHighlightStyle>(['highlight', 'underline', 'off'])
const INFO_DISPLAYS = new Set<EntityInfoDisplay>(['sidebar', 'popup'])

/** Reader theme when nothing is saved: follow the document / OS dark mode. */
function systemTheme(): ReaderTheme {
  if (typeof window === 'undefined') return 'light'
  if (document.documentElement.classList.contains('dark')) return 'dark'
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

/**
 * Parse whatever is in localStorage, ignoring anything malformed. The stored
 * shape is a flat object of strings (`entityPeekOnHover` is 'on' | 'off') —
 * kept as-is so readers' existing preferences survive this refactor.
 */
export function readStoredPrefs(): ReaderPrefs {
  const defaults: ReaderPrefs = {
    fontSize: 'medium',
    readerTheme: systemTheme(),
    readerWidth: 'standard',
    entityHighlightStyle: 'highlight',
    entityInfoDisplay: 'sidebar',
    entityPeekOnHover: true,
  }
  if (typeof window === 'undefined') return defaults
  try {
    const raw = localStorage.getItem(READER_PREFS_KEY)
    if (!raw) return defaults
    const saved = JSON.parse(raw) as Record<string, unknown>
    return {
      fontSize: FONT_SIZES.has(saved.fontSize as FontSize) ? (saved.fontSize as FontSize) : defaults.fontSize,
      readerTheme: THEMES.has(saved.readerTheme as ReaderTheme) ? (saved.readerTheme as ReaderTheme) : defaults.readerTheme,
      readerWidth: typeof saved.readerWidth === 'string' && saved.readerWidth in WIDTHS
        ? (saved.readerWidth as ReaderPrefs['readerWidth'])
        : defaults.readerWidth,
      entityHighlightStyle: HIGHLIGHT_STYLES.has(saved.entityHighlightStyle as EntityHighlightStyle)
        ? (saved.entityHighlightStyle as EntityHighlightStyle)
        : defaults.entityHighlightStyle,
      entityInfoDisplay: INFO_DISPLAYS.has(saved.entityInfoDisplay as EntityInfoDisplay)
        ? (saved.entityInfoDisplay as EntityInfoDisplay)
        : defaults.entityInfoDisplay,
      entityPeekOnHover: saved.entityPeekOnHover !== 'off',
    }
  } catch {
    return defaults
  }
}

/**
 * Reader display preferences, persisted per browser.
 *
 * Read synchronously in the initializer rather than in an effect: the page
 * shows a loading screen that does not depend on prefs until the chapter
 * arrives, so there is no hydration mismatch to bridge, and font size / width
 * no longer flash from defaults on load.
 */
export function useReaderPrefs() {
  const [prefs, setPrefs] = useState<ReaderPrefs>(readStoredPrefs)

  const setPref = useCallback(<K extends keyof ReaderPrefs>(key: K, value: ReaderPrefs[K]) => {
    setPrefs(prev => ({ ...prev, [key]: value }))
    try {
      const raw = localStorage.getItem(READER_PREFS_KEY)
      const saved = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      saved[key] = key === 'entityPeekOnHover' ? (value ? 'on' : 'off') : value
      localStorage.setItem(READER_PREFS_KEY, JSON.stringify(saved))
    } catch {
      // Storage full or disabled — the in-memory pref still applies.
    }
  }, [])

  return { prefs, setPref }
}
