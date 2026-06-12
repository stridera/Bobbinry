'use client'

import { useEffect } from 'react'
import { useSearchReplace, type SearchMatch } from '@/hooks/useSearchReplace'
import { MatchPreviewList } from './MatchPreviewList'
import type { SearchPanelProps } from './providers'

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 300

/**
 * Find-only entity search panel: live debounced search across the entities
 * bobbin (characters, places, lore, custom types). Clicking a result opens
 * that entity in its editor.
 */
export function EntitySearchPanel({ ctx, query, onClose }: SearchPanelProps) {
  const { preview, previewing, runPreview, error, reset } = useSearchReplace({
    projectId: ctx.projectId,
    apiToken: ctx.apiToken,
  })

  const trimmed = query.trim()

  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) {
      reset()
      return
    }
    const timer = setTimeout(() => {
      void runPreview({
        query: trimmed,
        replacement: '',
        caseSensitive: false,
        wholeWord: false,
        scope: { type: 'project' },
        bobbinIds: ['entities'],
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [trimmed, runPreview, reset])

  const handleMatchClick = (m: SearchMatch) => {
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: m.collection,
        entityId: m.entityId,
        bobbinId: 'entities',
        metadata: { view: 'entity-editor', isNew: false },
      },
    }))
    onClose()
  }

  return (
    <div className="flex flex-col min-h-0">
      <div className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
        {trimmed.length < MIN_QUERY_LENGTH ? (
          <span>Type at least {MIN_QUERY_LENGTH} characters to search entities</span>
        ) : previewing ? (
          <span>Searching…</span>
        ) : preview ? (
          <span>
            {preview.matches.length === 0
              ? 'No matches'
              : `${preview.matches.length} ${preview.matches.length === 1 ? 'match' : 'matches'}`}
            {preview.truncated && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">(results truncated)</span>
            )}
          </span>
        ) : (
          <span>Searching…</span>
        )}
        {error && <p className="mt-1 text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {preview && preview.matches.length > 0 && (
        <div className="overflow-y-auto max-h-[50vh] px-3 py-2.5">
          <MatchPreviewList
            matches={preview.matches}
            entityTitles={preview.entityTitles}
            compact
            onMatchClick={handleMatchClick}
          />
        </div>
      )}
    </div>
  )
}
