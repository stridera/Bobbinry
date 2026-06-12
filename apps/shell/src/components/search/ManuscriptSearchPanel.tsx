'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useSearchReplace,
  type SearchMatch,
  type SearchScope,
} from '@/hooks/useSearchReplace'
import { MatchPreviewList, type GroupedMatches } from './MatchPreviewList'
import type { SearchPanelProps } from './providers'

/**
 * Anchored search & replace panel for manuscript views. The top-bar input is
 * the Find field; preview runs on explicit Enter (tracked via `submitCount`)
 * because the preview snapshot anchors the optimistic-concurrency
 * `entityVersions` contract — live-searching the whole project per keystroke
 * would be wasteful and racy.
 */
export function ManuscriptSearchPanel({ ctx, query, submitCount, initialMode, onClose }: SearchPanelProps) {
  const [replacement, setReplacement] = useState('')
  const [showReplace, setShowReplace] = useState(initialMode === 'replace')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [scopeType, setScopeType] = useState<'project' | 'chapter'>(
    initialMode === 'replace' && ctx.activeChapter ? 'chapter' : 'project',
  )
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  const {
    preview,
    previewing,
    runPreview,
    apply,
    applying,
    error,
    lastApply,
  } = useSearchReplace({ projectId: ctx.projectId, apiToken: ctx.apiToken })

  // Ctrl+Shift+H while the panel is already open should still reveal the
  // replace row (render-time state adjustment, not an effect).
  const [prevInitialMode, setPrevInitialMode] = useState(initialMode)
  if (prevInitialMode !== initialMode) {
    setPrevInitialMode(initialMode)
    if (initialMode === 'replace') setShowReplace(true)
  }

  const scope: SearchScope = useMemo(
    () =>
      scopeType === 'chapter' && ctx.activeChapter
        ? { type: 'chapter', chapterId: ctx.activeChapter.id }
        : { type: 'project' },
    [scopeType, ctx.activeChapter],
  )

  const selectedIds = useMemo(() => {
    if (!preview) return [] as string[]
    return preview.matches.filter(m => !excluded.has(m.id)).map(m => m.id)
  }, [preview, excluded])

  const doPreview = useCallback(async (overrides?: {
    caseSensitive?: boolean
    wholeWord?: boolean
    scope?: SearchScope
  }) => {
    if (!query.trim()) return
    setExcluded(new Set())
    await runPreview({
      query,
      replacement,
      caseSensitive: overrides?.caseSensitive ?? caseSensitive,
      wholeWord: overrides?.wholeWord ?? wholeWord,
      scope: overrides?.scope ?? scope,
    })
  }, [query, replacement, caseSensitive, wholeWord, scope, runPreview])

  // Fire a preview exactly once per Enter press; the guard keeps option/query
  // changes from re-triggering a stale submit.
  const lastSubmitRef = useRef(0)
  useEffect(() => {
    if (submitCount === lastSubmitRef.current) return
    lastSubmitRef.current = submitCount
    void doPreview()
  }, [submitCount, doPreview])

  const handleApply = async () => {
    if (!preview || selectedIds.length === 0) return
    const res = await apply(
      { query, replacement, caseSensitive, wholeWord, scope },
      selectedIds,
      preview.entityVersions,
    )
    if (res && res.stale.length === 0 && res.applied.length > 0) {
      // Successful end-to-end — pop a fresh preview so the panel shows the
      // updated state (or nothing left to replace).
      await doPreview()
    }
  }

  const toggleMatch = (id: string) => {
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleGroup = (group: GroupedMatches) => {
    const allOff = group.matches.every(m => excluded.has(m.id))
    setExcluded(prev => {
      const next = new Set(prev)
      if (allOff) {
        for (const m of group.matches) next.delete(m.id)
      } else {
        for (const m of group.matches) next.add(m.id)
      }
      return next
    })
  }

  const toggleCase = () => {
    const next = !caseSensitive
    setCaseSensitive(next)
    if (preview) void doPreview({ caseSensitive: next })
  }

  const toggleWholeWord = () => {
    const next = !wholeWord
    setWholeWord(next)
    if (preview) void doPreview({ wholeWord: next })
  }

  const changeScope = (type: 'project' | 'chapter') => {
    if (type === 'chapter' && !ctx.activeChapter) return
    setScopeType(type)
    const nextScope: SearchScope =
      type === 'chapter' && ctx.activeChapter
        ? { type: 'chapter', chapterId: ctx.activeChapter.id }
        : { type: 'project' }
    if (preview) void doPreview({ scope: nextScope })
  }

  const handleMatchClick = (m: SearchMatch) => {
    const detail =
      m.collection === 'content'
        ? { entityType: 'content', entityId: m.entityId, bobbinId: 'manuscript' }
        : m.collection === 'containers'
          ? { entityType: 'container', entityId: m.entityId, bobbinId: 'manuscript' }
          : { entityType: m.collection, entityId: m.entityId, bobbinId: 'entities', metadata: { view: 'entity-editor', isNew: false } }
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', { detail }))
    // Hook for future in-editor scroll-to-match: no listener exists yet, but
    // the manuscript editor can pick this up to highlight/scroll via TipTap.
    window.dispatchEvent(new CustomEvent('bobbinry:search-highlight', {
      detail: { entityId: m.entityId, field: m.field, query, caseSensitive, wholeWord },
    }))
  }

  const chipClass = (active: boolean) =>
    `px-1.5 py-0.5 rounded border text-xs font-mono transition-colors ${
      active
        ? 'bg-blue-100 dark:bg-blue-900/50 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
    }`

  return (
    <div className="flex flex-col min-h-0">
      <div className="px-3 pt-2.5 pb-2 border-b border-gray-200 dark:border-gray-700 space-y-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowReplace(v => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            aria-expanded={showReplace}
          >
            <svg
              className={`w-3 h-3 transition-transform ${showReplace ? 'rotate-90' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Replace
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleCase}
              className={chipClass(caseSensitive)}
              title="Match case"
              aria-pressed={caseSensitive}
            >
              Aa
            </button>
            <button
              type="button"
              onClick={toggleWholeWord}
              className={chipClass(wholeWord)}
              title="Whole word"
              aria-pressed={wholeWord}
            >
              |ab|
            </button>
            <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-600 overflow-hidden text-xs ml-1">
              <button
                type="button"
                onClick={() => changeScope('project')}
                className={`px-2 py-0.5 transition-colors ${
                  scopeType === 'project'
                    ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                Project
              </button>
              <button
                type="button"
                onClick={() => changeScope('chapter')}
                disabled={!ctx.activeChapter}
                title={ctx.activeChapter ? `This chapter: ${ctx.activeChapter.title}` : 'Open a chapter to scope the search'}
                className={`px-2 py-0.5 border-l border-gray-200 dark:border-gray-600 transition-colors ${
                  scopeType === 'chapter'
                    ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                Chapter
              </button>
            </div>
          </div>
        </div>

        {showReplace && (
          <input
            type="text"
            value={replacement}
            onChange={e => setReplacement(e.target.value)}
            placeholder="Replace with…"
            aria-label="Replace with"
            className="w-full h-8 px-2.5 text-sm border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 dark:focus:border-blue-400"
          />
        )}

        <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
          {previewing ? (
            <span>Searching…</span>
          ) : preview ? (
            <span>
              {preview.matches.length === 0
                ? 'No matches'
                : `${selectedIds.length} of ${preview.matches.length} selected`}
              {preview.truncated && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">(results truncated)</span>
              )}
            </span>
          ) : (
            <span>Press Enter to search</span>
          )}
        </div>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {preview && preview.matches.length > 0 && (
        <div className="overflow-y-auto max-h-[50vh] px-3 py-2.5">
          <MatchPreviewList
            matches={preview.matches}
            entityTitles={preview.entityTitles}
            selectable
            compact
            excluded={excluded}
            onToggleMatch={toggleMatch}
            onToggleGroup={toggleGroup}
            onMatchClick={handleMatchClick}
          />
        </div>
      )}

      {lastApply && (
        <div className="mx-3 mb-2.5 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-100">
          Replaced in {lastApply.applied.length} {lastApply.applied.length === 1 ? 'item' : 'items'}.
          {lastApply.stale.length > 0 && (
            <span className="block mt-1 text-amber-800 dark:text-amber-200">
              {lastApply.stale.length} {lastApply.stale.length === 1 ? 'item was' : 'items were'} edited
              while you were previewing — re-run the search to see the latest state.
            </span>
          )}
        </div>
      )}

      {showReplace && (
        <footer className="px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!preview || selectedIds.length === 0 || applying}
            className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applying ? 'Replacing…' : `Replace ${selectedIds.length || ''} selected`.trim()}
          </button>
        </footer>
      )}
    </div>
  )
}
