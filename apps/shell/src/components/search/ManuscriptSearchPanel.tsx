'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  useSearchReplace,
  expandMatchIds,
  type SearchMatch,
  type SearchScope,
} from '@/hooks/useSearchReplace'
import { MatchPreviewList, type GroupedMatches } from './MatchPreviewList'
import { requestSearchHighlight } from './pendingFind'
import type { SearchPanelProps } from './providers'

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 300

/**
 * Anchored search & replace panel for manuscript views. The top-bar input is
 * the Find field. Search is live: every keystroke drives the in-editor find
 * session (instant, client-side) and a debounced project-wide preview. Each
 * preview response carries its own `entityVersions` snapshot, so the
 * optimistic-concurrency contract for replace still holds — apply always uses
 * the versions of the preview it was invoked on.
 */
export function ManuscriptSearchPanel({ ctx, query, initialMode, onClose }: SearchPanelProps) {
  const [replacement, setReplacement] = useState('')
  const [showReplace, setShowReplace] = useState(initialMode === 'replace')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [scopeType, setScopeType] = useState<'project' | 'chapter'>(
    initialMode === 'replace' && ctx.activeChapter ? 'chapter' : 'project',
  )
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  // Bumped after a successful apply so the effect re-fetches a fresh preview.
  const [refreshNonce, setRefreshNonce] = useState(0)

  const {
    preview,
    previewing,
    runPreview,
    apply,
    applying,
    error,
    lastApply,
    reset,
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

  const selectedMatches = useMemo(
    () => (preview ? preview.matches.filter(m => !excluded.has(m.id)) : []),
    [preview, excluded],
  )

  const trimmed = query.trim()

  // Live project-wide preview, debounced per keystroke; option/scope changes
  // re-fire it immediately via the deps. The hook aborts superseded requests.
  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) {
      reset()
      return
    }
    const timer = setTimeout(() => {
      setExcluded(new Set())
      void runPreview({
        query: trimmed,
        replacement: '',
        caseSensitive,
        wholeWord,
        scope,
      })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [trimmed, caseSensitive, wholeWord, scope, refreshNonce, runPreview, reset])

  // Drive the in-editor find session (highlight-all + Enter cycling) — no
  // debounce, it's client-side and instant. Deliberately NOT cleared on
  // unmount: dismissing the dropdown keeps the browser-like find session
  // alive; Esc in the top bar is the explicit clear.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('bobbinry:find-update', {
      detail: { query: trimmed, caseSensitive, wholeWord },
    }))
  }, [trimmed, caseSensitive, wholeWord])

  // Ctrl+F with a retained query asks for the session back (an earlier Esc
  // cleared the highlights but the query/options are still here).
  useEffect(() => {
    const handler = () => {
      if (!trimmed) return
      window.dispatchEvent(new CustomEvent('bobbinry:find-update', {
        detail: { query: trimmed, caseSensitive, wholeWord },
      }))
    }
    window.addEventListener('bobbinry:find-reactivate', handler)
    return () => window.removeEventListener('bobbinry:find-reactivate', handler)
  }, [trimmed, caseSensitive, wholeWord])

  const handleApply = async () => {
    if (!preview || selectedMatches.length === 0) return
    const res = await apply(
      { query: trimmed, replacement, caseSensitive, wholeWord, scope },
      expandMatchIds(selectedMatches),
      preview.entityVersions,
    )
    if (res && res.stale.length === 0 && res.applied.length > 0) {
      // Successful end-to-end — pop a fresh preview so the panel shows the
      // updated state (or nothing left to replace).
      setRefreshNonce(n => n + 1)
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

  // Option/scope changes feed the live-preview effect via its deps.
  const toggleCase = () => setCaseSensitive(v => !v)
  const toggleWholeWord = () => setWholeWord(v => !v)
  const changeScope = (type: 'project' | 'chapter') => {
    if (type === 'chapter' && !ctx.activeChapter) return
    setScopeType(type)
  }

  // The chapter being edited reads first in the list — that's the match the
  // user usually wants. Rows keep their internal (API) order.
  const orderedMatches = useMemo(() => {
    if (!preview) return []
    const activeId = ctx.activeChapter?.id
    if (!activeId) return preview.matches
    const current = preview.matches.filter(m => m.entityId === activeId)
    if (current.length === 0) return preview.matches
    return [...current, ...preview.matches.filter(m => m.entityId !== activeId)]
  }, [preview, ctx.activeChapter])

  const handleMatchClick = (m: SearchMatch) => {
    // Clicking a match in the chapter that's already open just scrolls to it;
    // re-navigating would pointlessly remount the editor.
    const isOpenChapter = m.collection === 'content' && m.entityId === ctx.activeChapter?.id
    if (!isOpenChapter) {
      const detail =
        m.collection === 'content'
          ? { entityType: 'content', entityId: m.entityId, bobbinId: 'manuscript' }
          : m.collection === 'containers'
            ? { entityType: 'container', entityId: m.entityId, bobbinId: 'manuscript' }
            : { entityType: m.collection, entityId: m.entityId, bobbinId: 'entities', metadata: { view: 'entity-editor', isNew: false } }
      window.dispatchEvent(new CustomEvent('bobbinry:navigate', { detail }))
    }
    // Ask the manuscript editor to select & scroll to this occurrence. `index`
    // is the first occurrence this (possibly merged) row covers; the editor
    // counts occurrences with the same regex options to land on the right one.
    // Dispatched via the pending-highlight helper so the request survives the
    // destination editor not being mounted yet.
    requestSearchHighlight({
      entityId: m.entityId,
      field: m.field,
      index: m.indices[0] ?? 0,
      query: trimmed,
      caseSensitive,
      wholeWord,
    })
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

        <div className="flex items-center justify-between gap-2 text-xs text-gray-600 dark:text-gray-400">
          {trimmed.length < MIN_QUERY_LENGTH ? (
            <span>Type at least {MIN_QUERY_LENGTH} characters to search the project</span>
          ) : previewing ? (
            <span>Searching…</span>
          ) : preview ? (
            <span>
              {preview.matches.length === 0
                ? 'No matches'
                : showReplace
                  ? `${selectedMatches.length} of ${preview.matches.length} selected`
                  : `${preview.matches.length} ${preview.matches.length === 1 ? 'match' : 'matches'}`}
              {preview.truncated && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">(results truncated)</span>
              )}
            </span>
          ) : (
            <span>Searching…</span>
          )}
          {ctx.activeChapter && (
            <span className="shrink-0 text-gray-400 dark:text-gray-500">
              Enter cycles matches · Esc edits at match
            </span>
          )}
        </div>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {preview && preview.matches.length > 0 && (
        <div className="overflow-y-auto max-h-[50vh] px-3 py-2.5">
          <MatchPreviewList
            matches={orderedMatches}
            entityTitles={preview.entityTitles}
            selectable={showReplace}
            compact
            excluded={excluded}
            onToggleMatch={toggleMatch}
            onToggleGroup={toggleGroup}
            onMatchClick={handleMatchClick}
            activeEntityId={ctx.activeChapter?.id}
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
            disabled={!preview || selectedMatches.length === 0 || applying}
            className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applying ? 'Replacing…' : `Replace ${selectedMatches.length || ''} selected`.trim()}
          </button>
        </footer>
      )}
    </div>
  )
}
