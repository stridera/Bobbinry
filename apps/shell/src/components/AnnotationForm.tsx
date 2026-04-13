'use client'

import { useState } from 'react'
import { ModalFrame } from '@bobbinry/ui-components'
import type { TextAnchor } from './AnnotationSelectionPopover'

type AnnotationType = 'error' | 'suggestion' | 'feedback'
type ErrorCategory = 'typo' | 'formatting' | 'continuity' | 'grammar' | 'other'

interface Props {
  anchor: TextAnchor
  onSubmit: (data: {
    anchor: TextAnchor
    annotationType: AnnotationType
    errorCategory?: ErrorCategory
    content: string
    suggestedText?: string
  }) => Promise<void>
  onClose: () => void
  isDark: boolean
  isSepia: boolean
}

const TYPE_OPTIONS: { value: AnnotationType; label: string; icon: string; color: string }[] = [
  { value: 'error', label: 'Error', icon: '\u26A0\uFE0F', color: 'red' },
  { value: 'suggestion', label: 'Suggestion', icon: '\uD83D\uDCA1', color: 'blue' },
  { value: 'feedback', label: 'Feedback', icon: '\uD83D\uDCAC', color: 'yellow' }
]

const ERROR_CATEGORIES: { value: ErrorCategory; label: string }[] = [
  { value: 'typo', label: 'Typo' },
  { value: 'grammar', label: 'Grammar' },
  { value: 'formatting', label: 'Formatting' },
  { value: 'continuity', label: 'Continuity' },
  { value: 'other', label: 'Other' }
]

export function AnnotationForm({ anchor, onSubmit, onClose, isDark, isSepia }: Props) {
  const [annotationType, setAnnotationType] = useState<AnnotationType>('error')
  const [errorCategory, setErrorCategory] = useState<ErrorCategory>('typo')
  const [content, setContent] = useState('')
  const [suggestedText, setSuggestedText] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Need either content or a suggested replacement
    if (!content.trim() && !suggestedText.trim()) return

    setSubmitting(true)
    try {
      const payload: Parameters<typeof onSubmit>[0] = {
        anchor,
        annotationType,
        content: content.trim() || suggestedText.trim(),
      }
      if (annotationType === 'error') payload.errorCategory = errorCategory
      if (suggestedText.trim()) payload.suggestedText = suggestedText.trim()
      await onSubmit(payload)
    } finally {
      setSubmitting(false)
    }
  }

  // Theme classes
  const modalBg = isDark ? 'bg-gray-900 border-gray-700' : isSepia ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200'
  const textClass = isDark ? 'text-gray-100' : isSepia ? 'text-amber-950' : 'text-gray-900'
  const mutedText = isDark ? 'text-gray-400' : isSepia ? 'text-amber-700' : 'text-gray-500'
  const inputBg = isDark ? 'bg-gray-800 border-gray-600 text-gray-100' : isSepia ? 'bg-amber-100 border-amber-300 text-amber-950' : 'bg-white border-gray-300 text-gray-900'
  const hoverBg = isDark ? 'hover:bg-gray-800' : isSepia ? 'hover:bg-amber-100' : 'hover:bg-gray-50'

  return (
    <ModalFrame onClose={onClose} ariaLabel="Add Feedback">
      <div className={`w-full max-w-md border rounded-lg shadow-xl ${modalBg}`}>
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className={`flex items-center justify-between px-4 py-3 border-b ${isDark ? 'border-gray-700' : isSepia ? 'border-amber-200' : 'border-gray-200'}`}>
            <h3 className={`font-semibold ${textClass}`}>Add Feedback</h3>
            <button type="button" onClick={onClose} className={`p-1 rounded ${hoverBg}`}>
              <svg className={`w-4 h-4 ${mutedText}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-4 py-3 space-y-3">
            {/* Selected text */}
            <div>
              <div className={`text-xs ${mutedText} mb-1`}>Selected text</div>
              <div className={`text-sm ${textClass} italic px-2 py-1.5 rounded ${isDark ? 'bg-gray-800' : isSepia ? 'bg-amber-100' : 'bg-gray-50'} line-clamp-3`}>
                &ldquo;{anchor.quote}&rdquo;
              </div>
            </div>

            {/* Type selector */}
            <div>
              <div className={`text-xs ${mutedText} mb-1`}>Type</div>
              <div className="flex gap-1">
                {TYPE_OPTIONS.map(opt => {
                  const selected = annotationType === opt.value
                  const selectedClass = selected
                    ? (isDark ? 'bg-blue-900 text-blue-300 border-blue-700' : 'bg-blue-100 text-blue-700 border-blue-300')
                    : `${isDark ? 'border-gray-600' : isSepia ? 'border-amber-300' : 'border-gray-300'} ${hoverBg}`
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setAnnotationType(opt.value)}
                      className={`flex-1 px-2 py-1.5 text-xs font-medium border rounded transition-colors ${selectedClass}`}
                    >
                      {opt.icon} {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Error category */}
            {annotationType === 'error' && (
              <div>
                <div className={`text-xs ${mutedText} mb-1`}>Category</div>
                <select
                  value={errorCategory}
                  onChange={e => setErrorCategory(e.target.value as ErrorCategory)}
                  className={`w-full text-sm px-2 py-1.5 rounded border ${inputBg}`}
                >
                  {ERROR_CATEGORIES.map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Suggested replacement — shown for suggestions and error types that have fixes */}
            {(annotationType === 'suggestion' || annotationType === 'error') && (
              <div>
                <div className={`text-xs ${mutedText} mb-1`}>
                  {annotationType === 'error' ? 'Correction (optional)' : 'Suggested replacement'}
                </div>
                <textarea
                  value={suggestedText}
                  onChange={e => setSuggestedText(e.target.value)}
                  placeholder="What should it say instead?"
                  rows={2}
                  className={`w-full text-sm px-2 py-1.5 rounded border resize-none ${inputBg}`}
                />
              </div>
            )}

            {/* Note / comment */}
            <div>
              <div className={`text-xs ${mutedText} mb-1`}>
                {annotationType === 'feedback' ? 'Your feedback' : 'Details (optional)'}
              </div>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder={
                  annotationType === 'error' ? 'Additional context...'
                    : annotationType === 'suggestion' ? 'Why this change?'
                      : 'Share your thoughts...'
                }
                rows={annotationType === 'feedback' ? 3 : 2}
                className={`w-full text-sm px-2 py-1.5 rounded border resize-none ${inputBg}`}
              />
            </div>
          </div>

          {/* Footer */}
          <div className={`flex items-center justify-end gap-2 px-4 py-3 border-t ${isDark ? 'border-gray-700' : isSepia ? 'border-amber-200' : 'border-gray-200'}`}>
            <button
              type="button"
              onClick={onClose}
              className={`px-3 py-1.5 text-sm rounded ${hoverBg} ${textClass}`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || (!content.trim() && !suggestedText.trim())}
              className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </ModalFrame>
  )
}
