/**
 * Shared types and constants for the public chapter reader page and the
 * hooks/components it is composed from.
 */

export interface ChapterData {
  id: string
  slug: string | null
  title: string
  content: string
  publishedAt: string | null
  viewCount: number
}

export interface NavTarget {
  id: string
  slug: string | null
}

export interface Navigation {
  previous: NavTarget | null
  next: NavTarget | null
}

export interface ReactionCount {
  reactionType: string
  count: number
}

export interface Comment {
  id: string
  content: string
  parentId: string | null
  authorId: string
  authorName: string
  likeCount: number
  createdAt: string
  replies: Comment[]
}

export interface Annotation {
  id: string
  anchorParagraphIndex: number | null
  anchorQuote: string
  anchorCharOffset: number | null
  anchorCharLength: number | null
  annotationType: string
  errorCategory: string | null
  content: string
  suggestedText: string | null
  status: string
  authorResponse: string | null
  chapterVersion: number
  createdAt: string
}

export interface PublishedEntityName {
  id: string
  slug: string | null
  name: string
  typeId: string
  typeIcon: string
  typeLabel: string
}

export type FontSize = 'small' | 'medium' | 'large' | 'xlarge'
export type ReaderTheme = 'light' | 'dark' | 'sepia'
export type ReaderWidth = 'narrow' | 'standard' | 'wide' | 'fit'
export type EntityHighlightStyle = 'highlight' | 'underline' | 'off'
export type EntityInfoDisplay = 'sidebar' | 'popup'

/** Everything the reader can tune in the settings panel; persisted per browser. */
export interface ReaderPrefs {
  fontSize: FontSize
  readerTheme: ReaderTheme
  readerWidth: ReaderWidth
  entityHighlightStyle: EntityHighlightStyle
  entityInfoDisplay: EntityInfoDisplay
  entityPeekOnHover: boolean
}

/** Stable id on the chapter body so reader bobbins (read-aloud, etc.) can find the text. */
export const READER_CONTENT_ID = 'reader-chapter-content'

/** localStorage key the prefs live under. Other reader pages read the same key. */
export const READER_PREFS_KEY = 'bobbinry-reader-prefs'

export const FONT_SIZES: Record<FontSize, string> = {
  small: 'text-sm leading-6',
  medium: 'text-base leading-7',
  large: 'text-lg leading-8',
  xlarge: 'text-xl leading-9'
}

export const WIDTHS: Record<ReaderWidth, string> = {
  narrow: 'max-w-lg',
  standard: 'max-w-2xl',
  wide: 'max-w-4xl',
  fit: 'max-w-none'
}

export const REACTION_EMOJIS: Record<string, string> = {
  heart: '❤️',
  laugh: '😂',
  wow: '😮',
  sad: '😢',
  fire: '🔥',
  clap: '👏'
}

export const MAX_REPLY_DEPTH = 3

export function deviceType(): 'mobile' | 'tablet' | 'desktop' {
  return window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop'
}
