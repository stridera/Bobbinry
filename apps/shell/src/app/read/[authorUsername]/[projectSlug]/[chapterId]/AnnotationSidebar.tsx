import type { ReaderThemeClasses } from './reader-theme'
import type { Annotation } from './types'

interface AnnotationSidebarProps {
  theme: ReaderThemeClasses
  annotations: Annotation[]
  onDelete: (annotationId: string) => void
}

const TYPE_BADGE: Record<string, string> = {
  error: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
  suggestion: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
}
const DEFAULT_BADGE = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'

/** The reader's own feedback on this chapter, docked beside the prose on large screens. */
export function AnnotationSidebar({ theme, annotations, onDelete }: AnnotationSidebarProps) {
  const { borderColor, mutedText, isDark, annotationCard } = theme
  return (
    <div className={`w-72 flex-shrink-0 border-l ${borderColor} overflow-y-auto max-h-screen sticky top-8 hidden lg:block`}>
      <div className="p-3">
        <h3 className="text-sm font-semibold mb-3">Your Feedback ({annotations.length})</h3>
        {annotations.length === 0 ? (
          <p className={`text-xs ${mutedText}`}>Select text in the chapter to add feedback.</p>
        ) : (
          <div className="space-y-2">
            {annotations.map(ann => (
              <div key={ann.id} className={`p-2 rounded border text-xs ${annotationCard}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`font-medium px-1.5 py-0.5 rounded text-[10px] ${TYPE_BADGE[ann.annotationType] ?? DEFAULT_BADGE}`}>
                    {ann.annotationType}{ann.errorCategory ? `: ${ann.errorCategory}` : ''}
                  </span>
                  <span className={`text-[10px] ${mutedText}`}>
                    {ann.status}
                  </span>
                </div>
                <div className={`italic ${mutedText} line-clamp-2 mb-1`}>
                  &ldquo;{ann.anchorQuote}&rdquo;
                </div>
                <div className="mb-1.5">{ann.content}</div>
                {ann.authorResponse && (
                  <div className={`pl-2 border-l-2 ${isDark ? 'border-blue-700' : 'border-blue-300'} ${mutedText} mt-1`}>
                    <span className="font-medium">Author:</span> {ann.authorResponse}
                  </div>
                )}
                {ann.status === 'open' && (
                  <button
                    onClick={() => onDelete(ann.id)}
                    className={`text-[10px] ${mutedText} hover:text-red-500 mt-1`}
                  >
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
