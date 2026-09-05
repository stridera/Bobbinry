import { CONTENT_TYPES, CONTENT_TYPE_LABELS, countsTowardWordCount, type ContentType } from '@bobbinry/types'

interface ContentTypeMenuProps {
  contentType: ContentType
  open: boolean
  saving: boolean
  onToggle: () => void
  onClose: () => void
  onChange: (next: ContentType) => void
}

/**
 * Content type — author intent for this piece. Switching to a non-narrative
 * type (outline / supporting doc) excludes the piece from project word totals.
 */
export function ContentTypeMenu({ contentType, open, saving, onToggle, onClose, onChange }: ContentTypeMenuProps) {
  const countsForWords = countsTowardWordCount(contentType)
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={onToggle}
        disabled={saving}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset transition-colors disabled:opacity-50 ${
          countsForWords
            ? 'bg-blue-50 text-blue-700 ring-blue-200 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-800 dark:hover:bg-blue-900/50'
            : 'bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800 dark:hover:bg-amber-900/50'
        }`}
        title="Change content type"
      >
        <span>{CONTENT_TYPE_LABELS[contentType]}</span>
        {!countsForWords && (
          <span className="opacity-70">· not counted</span>
        )}
        <svg className="w-3 h-3 opacity-60" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <path d="M2 4l4 4 4-4z" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={onClose} aria-hidden="true" />
          <div className="absolute left-0 top-full mt-1 z-20 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg py-1">
            {CONTENT_TYPES.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => onChange(t)}
                disabled={t === contentType || saving}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 disabled:cursor-default ${
                  t === contentType
                    ? 'font-semibold text-gray-900 dark:text-gray-100'
                    : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                <span>{CONTENT_TYPE_LABELS[t]}</span>
                {t === contentType && <span className="text-blue-500">✓</span>}
                {!countsTowardWordCount(t) && t !== contentType && (
                  <span className="text-[10px] text-gray-400">not counted</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
