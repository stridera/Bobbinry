'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  resolveSearchProvider,
  type ActiveChapter,
  type ShellSearchContext,
} from './providers'

interface UnifiedSearchProps {
  projectId: string
  shellContext: Record<string, unknown>
}

/** In-chapter match state announced by the manuscript editor (find-state). */
interface FindState {
  total: number
  activeIndex: number
  capped?: boolean
  query: string
  entityId: string | null
}

function dispatchFindClear() {
  window.dispatchEvent(new CustomEvent('bobbinry:find-clear'))
}

function dispatchFindStep(dir: 1 | -1) {
  window.dispatchEvent(new CustomEvent('bobbinry:find-step', { detail: { dir } }))
}

/**
 * Context-aware search input for the workspace top bar. The active view
 * (via shell context) picks a search provider — manuscript views get full
 * search & replace, entity views get live entity search — and the provider's
 * panel renders in a dropdown anchored under the input.
 *
 * Shortcuts: Ctrl/Cmd+F focuses the input (replacing browser find inside the
 * workspace); Ctrl/Cmd+Shift+H opens it with the replace row expanded. In a
 * manuscript editor the input behaves like browser find: matches highlight as
 * you type, Enter / Shift+Enter cycle through them, Esc clears.
 */
export function UnifiedSearch({ projectId, shellContext }: UnifiedSearchProps) {
  const apiToken = shellContext.apiToken as string | undefined
  const currentView = shellContext.currentView as string | undefined
  const bobbinId = shellContext.bobbinId as string | undefined
  const entityType = shellContext.entityType as string | undefined

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'find' | 'replace'>('find')
  const [activeChapter, setActiveChapter] = useState<ActiveChapter | null>(null)
  const [findState, setFindState] = useState<FindState | null>(null)
  const [isMac, setIsMac] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const queryRef = useRef('')
  const focusModeRef = useRef(false)
  // Mirrors `inChapterFind` (defined below) for the stable openSearch callback.
  const inChapterFindRef = useRef(false)

  const provider = useMemo(
    () => resolveSearchProvider({ currentView, bobbinId }),
    [currentView, bobbinId],
  )

  // Close the panel when the view flips to a different provider (manuscript ↔
  // entities) so stale results don't linger; the query text survives. This is
  // the render-time state-adjustment pattern, not an effect, to avoid a flash
  // of the old panel.
  const [prevProviderId, setPrevProviderId] = useState(provider.id)
  if (prevProviderId !== provider.id) {
    setPrevProviderId(provider.id)
    setOpen(false)
    setMode('find')
    setFindState(null)
    dispatchFindClear()
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration bridge for the kbd hint
    setIsMac(typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform))
  }, [])

  useEffect(() => {
    queryRef.current = query
  }, [query])

  // The manuscript editor announces the open chapter so search can scope to it.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ActiveChapter | null>).detail
      setActiveChapter(detail ?? null)
    }
    window.addEventListener('bobbinry:active-chapter', handler)
    return () => window.removeEventListener('bobbinry:active-chapter', handler)
  }, [])

  // In-chapter match counts from the editor, for the "n / m" indicator.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FindState>).detail
      if (!detail || typeof detail.total !== 'number') return
      setFindState(detail)
    }
    window.addEventListener('bobbinry:find-state', handler)
    return () => window.removeEventListener('bobbinry:find-state', handler)
  }, [])

  // Entering focus mode hides the top bar — drop the panel with it.
  useEffect(() => {
    const handler = (e: Event) => {
      const active = Boolean((e as CustomEvent<{ active?: boolean }>).detail?.active)
      focusModeRef.current = active
      if (active) {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('bobbinry:focus-mode-change', handler)
    return () => window.removeEventListener('bobbinry:focus-mode-change', handler)
  }, [])

  const openSearch = useCallback((nextMode: 'find' | 'replace') => {
    setMode(nextMode)
    const hasQuery = Boolean(queryRef.current.trim())
    // Replace needs the dropdown; plain find opens it only outside a chapter
    // (in a chapter, Ctrl+F is the compact highlight-and-cycle experience).
    if (nextMode === 'replace' || (hasQuery && !inChapterFindRef.current)) setOpen(true)
    if (nextMode === 'find' && hasQuery && inChapterFindRef.current) {
      // Re-pressing Ctrl+F with a retained query re-lights the highlights
      // (a prior Esc cleared them) so Enter cycling works immediately —
      // browser-find parity. The mounted panel answers with a find-update.
      window.dispatchEvent(new CustomEvent('bobbinry:find-reactivate'))
    }
    const focusInput = () => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    if (focusModeRef.current) {
      // The bar is collapsed — exit focus mode first, then grab focus once
      // the header is interactable again.
      window.dispatchEvent(new CustomEvent('bobbinry:request-focus-mode', { detail: { active: false } }))
      setTimeout(focusInput, 80)
    } else {
      focusInput()
    }
  }, [])

  // Capture phase so the shortcut wins over TipTap and other inputs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return
      const mod = e.ctrlKey || e.metaKey
      if (!mod || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'f' && !e.shiftKey) {
        e.preventDefault()
        openSearch('find')
      } else if (key === 'h' && e.shiftKey) {
        e.preventDefault()
        openSearch('replace')
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [openSearch])

  // Click-outside dismissal.
  useEffect(() => {
    if (!open) return
    const handler = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [open])

  const ctx: ShellSearchContext = useMemo(() => ({
    projectId,
    apiToken: apiToken ?? '',
    currentView,
    bobbinId,
    entityType,
    activeChapter,
  }), [projectId, apiToken, currentView, bobbinId, entityType, activeChapter])

  // With a chapter open, Ctrl+F is a compact browser-style find: highlights +
  // counter only. The project-results dropdown is opt-in (button / Alt+Enter)
  // so it doesn't cover the text. Without a chapter (outline, dashboard),
  // the dropdown is the whole search UI, so it opens as you type.
  const inChapterFind = Boolean(provider.supportsInChapterFind && activeChapter)

  useEffect(() => {
    inChapterFindRef.current = inChapterFind
  }, [inChapterFind])

  if (!apiToken) return null

  const handleInputChange = (value: string) => {
    setQuery(value)
    if (provider.searchTrigger === 'live' && value.trim()) {
      if (!inChapterFind) setOpen(true)
    } else if (!value.trim()) {
      // The panel (the find-update dispatcher) may already be closed when the
      // input empties — clear the editor highlights from here.
      setFindState(null)
      dispatchFindClear()
    }
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !query.trim()) return
    e.preventDefault()
    if (e.altKey) {
      setOpen(v => !v)
      return
    }
    if (inChapterFind) {
      // Browser-find behavior: Enter / Shift+Enter walk the in-chapter
      // matches; works even after the dropdown was dismissed. On zero
      // matches this is a no-op — the query may be a typo, or the user may
      // just be confirming the word isn't here; project results stay behind
      // the toggle (Alt+Enter).
      dispatchFindStep(e.shiftKey ? -1 : 1)
    } else {
      setOpen(true)
    }
  }

  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    // Esc ladder: first close the results dropdown (find session stays live),
    // then end the find session (highlights drop, query text stays).
    if (open) {
      setOpen(false)
      inputRef.current?.focus()
      return
    }
    setFindState(null)
    if (inChapterFind) {
      // Hand the caret to the editor at the active match — cycle with Enter,
      // Esc, and you're editing right where you landed.
      window.dispatchEvent(new CustomEvent('bobbinry:find-commit'))
    } else {
      dispatchFindClear()
      inputRef.current?.blur()
    }
  }

  // Show "n / m" only while it describes the current input in the open chapter.
  const trimmedQuery = query.trim()
  const showFindCounter = Boolean(
    provider.supportsInChapterFind &&
    activeChapter &&
    trimmedQuery &&
    findState &&
    findState.query === trimmedQuery,
  )

  const Panel = provider.Panel

  return (
    <div
      ref={containerRef}
      className="relative hidden sm:block"
      onKeyDown={handleContainerKeyDown}
    >
      <div className="relative group">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none"
          fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onFocus={() => {
            if (provider.searchTrigger === 'live' && query.trim() && !inChapterFind) setOpen(true)
          }}
          placeholder={provider.placeholder}
          aria-label={provider.placeholder}
          className={`h-8 w-56 focus:w-80 transition-[width] duration-200 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 pl-8 ${showFindCounter ? 'pr-28' : 'pr-14'} text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 dark:focus:border-blue-400 focus:bg-white dark:focus:bg-gray-800`}
        />
        {showFindCounter && findState ? (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            <span
              className={`px-1 text-[11px] font-mono tabular-nums ${
                findState.total === 0
                  ? 'text-red-500 dark:text-red-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
              aria-live="polite"
              aria-label={`Match ${findState.total === 0 ? 0 : findState.activeIndex + 1} of ${findState.total} in this chapter`}
            >
              {findState.total === 0
                ? '0 / 0'
                : `${findState.activeIndex + 1} / ${findState.capped ? `${findState.total}+` : findState.total}`}
            </span>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => dispatchFindStep(-1)}
              disabled={findState.total === 0}
              title="Previous match (Shift+Enter)"
              aria-label="Previous match"
              className="p-0.5 rounded text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => dispatchFindStep(1)}
              disabled={findState.total === 0}
              title="Next match (Enter)"
              aria-label="Next match"
              className="p-0.5 rounded text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setOpen(v => !v)}
              title={open ? 'Hide project results (Alt+Enter)' : 'Show project results (Alt+Enter)'}
              aria-label={open ? 'Hide project results' : 'Show project results'}
              aria-pressed={open}
              className={`ml-0.5 p-0.5 rounded transition-colors ${
                open
                  ? 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50'
                  : 'text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
              </svg>
            </button>
          </div>
        ) : (
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-[10px] font-mono text-gray-400 dark:text-gray-500 pointer-events-none group-focus-within:hidden">
          {isMac ? '⌘F' : 'Ctrl F'}
        </kbd>
        )}
      </div>

      {/* With a chapter open, the panel stays mounted (it drives the in-editor
          find session and keeps project results warm) but hidden until the
          user asks for it — the dropdown covering the text was the reason
          Ctrl+F felt worse than browser find. */}
      {(open || (inChapterFind && Boolean(query.trim()))) && (
        <div className={`absolute top-full mt-1.5 left-1/2 -translate-x-1/2 w-[28rem] max-w-[calc(100vw-2rem)] z-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl animate-fade-in-scale overflow-hidden flex-col ${open ? 'flex' : 'hidden'}`}>
          <Panel
            key={provider.id}
            ctx={ctx}
            query={query}
            initialMode={mode}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
