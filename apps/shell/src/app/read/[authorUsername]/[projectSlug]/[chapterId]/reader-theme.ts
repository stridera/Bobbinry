import type { ReaderTheme } from './types'

/**
 * Tailwind class bundles for one reader theme. The reader theme is independent
 * of the document's dark mode (a reader can pick sepia on a dark OS), so these
 * are computed from the pref rather than using `dark:` variants.
 */
export interface ReaderThemeClasses {
  theme: ReaderTheme
  isDark: boolean
  isSepia: boolean
  /** Page wrapper background + text. */
  wrapper: string
  borderColor: string
  mutedText: string
  linkColor: string
  hoverBg: string
  activeBg: string
  proseClass: string
  progressTrack: string
  /** Muted body text for comment bodies. */
  contentColor: string
  annotationCard: string
  reactionActive: string
  navTheme: {
    bg: string
    border: string
    text: string
    muted: string
    hover: string
  }
}

const WRAPPER: Record<ReaderTheme, string> = {
  light: 'bg-white text-gray-900',
  dark: 'bg-gray-950 text-gray-100',
  sepia: 'bg-amber-50 text-amber-950'
}

export function readerThemeClasses(theme: ReaderTheme): ReaderThemeClasses {
  const isDark = theme === 'dark'
  const isSepia = theme === 'sepia'
  const borderColor = isDark ? 'border-gray-800' : isSepia ? 'border-amber-200' : 'border-gray-200'
  const mutedText = isDark ? 'text-gray-400' : isSepia ? 'text-amber-700' : 'text-gray-500'
  return {
    theme,
    isDark,
    isSepia,
    wrapper: WRAPPER[theme],
    borderColor,
    mutedText,
    linkColor: isDark ? 'text-blue-400' : 'text-blue-600',
    hoverBg: isDark ? 'hover:bg-gray-800' : isSepia ? 'hover:bg-amber-100' : 'hover:bg-gray-100',
    activeBg: isDark ? 'bg-blue-900 text-blue-300' : 'bg-blue-100 text-blue-700',
    proseClass: isDark ? 'prose-invert' : isSepia ? 'prose-amber' : 'prose-gray',
    progressTrack: isDark ? 'bg-gray-800' : 'bg-gray-200',
    contentColor: isDark ? 'text-gray-300' : isSepia ? 'text-amber-900' : 'text-gray-700',
    annotationCard: isDark ? 'border-gray-700 bg-gray-800/50' : isSepia ? 'border-amber-200 bg-amber-100/50' : 'border-gray-200 bg-gray-50',
    reactionActive: isDark ? 'border-blue-800 bg-blue-950/30' : 'border-blue-200 bg-blue-50',
    navTheme: {
      bg: isDark ? 'bg-gray-950' : isSepia ? 'bg-amber-50' : 'bg-white/80 backdrop-blur-sm',
      border: borderColor,
      text: isDark ? 'text-gray-100' : isSepia ? 'text-amber-950' : 'text-gray-900',
      muted: mutedText,
      hover: isDark ? 'hover:text-gray-100' : isSepia ? 'hover:text-amber-950' : 'hover:text-gray-900'
    }
  }
}
