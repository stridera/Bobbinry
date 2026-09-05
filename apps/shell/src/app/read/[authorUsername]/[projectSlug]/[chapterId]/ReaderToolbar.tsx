import { ExtensionSlot } from '@/components/ExtensionSlot'
import type { ReaderThemeClasses } from './reader-theme'
import { WIDTHS, type ReaderWidth } from './types'

interface ReaderToolbarProps {
  theme: ReaderThemeClasses
  width: ReaderWidth
  /** Context handed to the reader.toolbar extension slot. */
  slotContext: Record<string, unknown>
  isBookmarked: boolean
  onSaveBookmark: () => void
  onRemoveBookmark: () => void
  onRestoreBookmark: () => void
  canAnnotate: boolean
  annotationCount: number
  showAnnotationSidebar: boolean
  onToggleAnnotationSidebar: () => void
  onToggleSettings: () => void
}

/** Settings bar above the prose: reader-bobbin toolbar actions on the left, page controls on the right. */
export function ReaderToolbar({
  theme,
  width,
  slotContext,
  isBookmarked,
  onSaveBookmark,
  onRemoveBookmark,
  onRestoreBookmark,
  canAnnotate,
  annotationCount,
  showAnnotationSidebar,
  onToggleAnnotationSidebar,
  onToggleSettings,
}: ReaderToolbarProps) {
  const { hoverBg, mutedText } = theme
  return (
    <div className={`${WIDTHS[width]} mx-auto px-4 py-1.5 flex items-center justify-between`}>
      <ExtensionSlot
        slotId="reader.toolbar"
        context={slotContext}
        className="flex items-center gap-2"
        fallback={<span />}
      />
      <div className="flex items-center gap-1">
        <button
          onClick={isBookmarked ? onRemoveBookmark : onSaveBookmark}
          className={`p-1.5 rounded ${hoverBg} transition-colors`}
          title={isBookmarked ? 'Remove bookmark' : 'Bookmark this position'}
        >
          <svg className={`w-4 h-4 ${isBookmarked ? 'text-blue-500 fill-current' : mutedText}`} fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        </button>
        {isBookmarked && (
          <button
            onClick={onRestoreBookmark}
            className={`p-1.5 rounded ${hoverBg} transition-colors`}
            title="Jump to bookmark"
          >
            <svg className={`w-4 h-4 ${mutedText}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        )}
        {canAnnotate && (
          <button
            onClick={onToggleAnnotationSidebar}
            className={`p-1.5 rounded ${hoverBg} transition-colors relative`}
            title={showAnnotationSidebar ? 'Hide feedback panel' : 'Show feedback panel'}
          >
            <svg className={`w-4 h-4 ${showAnnotationSidebar ? 'text-blue-500' : mutedText}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            {annotationCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 text-[9px] font-bold rounded-full bg-blue-600 text-white flex items-center justify-center">
                {annotationCount}
              </span>
            )}
          </button>
        )}
        <button
          onClick={onToggleSettings}
          className={`p-1.5 rounded ${hoverBg} transition-colors`}
          title="Reading settings"
        >
          <svg className={`w-4 h-4 ${mutedText}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        </button>
      </div>
    </div>
  )
}
