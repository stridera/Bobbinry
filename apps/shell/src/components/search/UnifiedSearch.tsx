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

/**
 * Context-aware search input for the workspace top bar. The active view
 * (via shell context) picks a search provider — manuscript views get full
 * search & replace, entity views get live entity search — and the provider's
 * panel renders in a dropdown anchored under the input.
 *
 * Shortcuts: Ctrl/Cmd+F focuses the input (replacing browser find inside the
 * workspace); Ctrl/Cmd+Shift+H opens it with the replace row expanded.
 */
export function UnifiedSearch({ projectId, shellContext }: UnifiedSearchProps) {
  const apiToken = shellContext.apiToken as string | undefined
  const currentView = shellContext.currentView as string | undefined
  const bobbinId = shellContext.bobbinId as string | undefined
  const entityType = shellContext.entityType as string | undefined

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'find' | 'replace'>('find')
  const [submitCount, setSubmitCount] = useState(0)
  const [activeChapter, setActiveChapter] = useState<ActiveChapter | null>(null)
  const [isMac, setIsMac] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const queryRef = useRef('')
  const focusModeRef = useRef(false)

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
    setSubmitCount(0)
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
    if (nextMode === 'replace' || queryRef.current.trim()) setOpen(true)
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

  if (!apiToken) return null

  const handleInputChange = (value: string) => {
    setQuery(value)
    if (provider.searchTrigger === 'live' && value.trim()) setOpen(true)
  }

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim()) {
      e.preventDefault()
      setOpen(true)
      setSubmitCount(c => c + 1)
    }
  }

  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    if (open) {
      setOpen(false)
      inputRef.current?.focus()
    } else {
      inputRef.current?.blur()
    }
  }

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
            if (provider.searchTrigger === 'live' && query.trim()) setOpen(true)
          }}
          placeholder={provider.placeholder}
          aria-label={provider.placeholder}
          className="h-8 w-56 focus:w-80 transition-[width] duration-200 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 pl-8 pr-14 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 dark:focus:border-blue-400 focus:bg-white dark:focus:bg-gray-800"
        />
        <kbd className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-[10px] font-mono text-gray-400 dark:text-gray-500 pointer-events-none group-focus-within:hidden">
          {isMac ? '⌘F' : 'Ctrl F'}
        </kbd>
      </div>

      {open && (
        <div className="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 w-[28rem] max-w-[calc(100vw-2rem)] z-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl animate-fade-in-scale overflow-hidden flex flex-col">
          <Panel
            key={provider.id}
            ctx={ctx}
            query={query}
            submitCount={submitCount}
            initialMode={mode}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
