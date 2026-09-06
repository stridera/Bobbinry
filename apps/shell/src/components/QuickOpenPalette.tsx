'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BobbinryAPI, EntityAPI, fuzzyMatch } from '@bobbinry/sdk'
import { ModalFrame } from '@bobbinry/ui-components'

import { extensionRegistry, quickOpenDeclarations } from '@/lib/extensions'
import { buildQuickOpenItems, type QuickOpenGroup, type QuickOpenItem } from '@/lib/quick-open-sources'

interface ScoredItem {
  item: QuickOpenItem
  score: number
  indices: number[]
}

const CACHE_TTL_MS = 60_000
const MAX_RESULTS = 50

// Module-level cache so reopening the palette is instant; refreshed in the
// background when stale. Keyed by project and by which bobbins declared
// quickOpen sources, so an install/uninstall invalidates it.
let itemsCache: { key: string; at: number; items: QuickOpenItem[]; groups: QuickOpenGroup[] } | null = null

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>
  const indexSet = new Set(indices)
  return (
    <>
      {text.split('').map((ch, i) =>
        indexSet.has(i) ? (
          <span key={i} className="text-blue-600 dark:text-blue-400 font-semibold">{ch}</span>
        ) : (
          <span key={i}>{ch}</span>
        )
      )}
    </>
  )
}

function KindIcon({ icon }: { icon: QuickOpenGroup['icon'] }) {
  const paths = {
    document: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
    person: <><circle cx="12" cy="8" r="4" /><path d="M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2" /></>,
    note: <><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z" /><path d="M15 3v6h6" /></>,
  }
  return (
    <svg className="w-4 h-4 shrink-0 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[icon]}
    </svg>
  )
}

interface QuickOpenPaletteProps {
  projectId: string
  apiToken?: string | undefined
}

export function QuickOpenPalette({ projectId, apiToken }: QuickOpenPaletteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<QuickOpenItem[]>([])
  const [groups, setGroups] = useState<QuickOpenGroup[]>([])
  const [loading, setLoading] = useState(false)
  // Bobbins register their panels asynchronously; re-index when the set changes.
  const [registryVersion, setRegistryVersion] = useState(0)
  useEffect(() => extensionRegistry.onSlotChange('shell.leftPanel', () => setRegistryVersion(v => v + 1)), [])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const entityApi = useMemo(() => {
    if (!projectId) return null
    const api = new BobbinryAPI()
    if (apiToken) api.setAuthToken(apiToken)
    return new EntityAPI(api, projectId)
  }, [projectId, apiToken])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setSelectedIndex(0)
  }, [])

  // Cmd/Ctrl+K toggles — capture phase so it wins over TipTap
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [])

  // While open: Esc closes the palette only (capture + stopPropagation keeps
  // ShellLayout's focus-mode Esc handler and ModalFrame's duplicate out of it)
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [open, close])

  // Load items on open (stale cache renders immediately, refresh in background)
  useEffect(() => {
    if (!open || !entityApi) return
    let cancelled = false
    const declarations = quickOpenDeclarations()
    const cacheKey = `${projectId}|${declarations.map(d => d.bobbinId).join(',')}`

    /* eslint-disable react-hooks/set-state-in-effect -- hydrate from module cache on open */
    if (itemsCache && itemsCache.key === cacheKey) {
      setItems(itemsCache.items)
      setGroups(itemsCache.groups)
      if (Date.now() - itemsCache.at < CACHE_TTL_MS) return
    } else {
      setLoading(true)
    }
    /* eslint-enable react-hooks/set-state-in-effect */

    buildQuickOpenItems(entityApi, declarations)
      .then(fetched => {
        itemsCache = { key: cacheKey, at: Date.now(), ...fetched }
        if (!cancelled) {
          setItems(fetched.items)
          setGroups(fetched.groups)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, entityApi, projectId, registryVersion])

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
    return undefined
  }, [open])

  const results: ScoredItem[] = useMemo(() => {
    if (!query.trim()) {
      return items.slice(0, MAX_RESULTS).map(item => ({ item, score: 0, indices: [] }))
    }
    const scored: ScoredItem[] = []
    for (const item of items) {
      const match = fuzzyMatch(query.trim(), item.title)
      if (match) scored.push({ item, score: match.score, indices: match.indices })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, MAX_RESULTS)
  }, [items, query])

  // Stable flat order grouped by declaring bobbin — keyboard selection follows this order
  const grouped: { group: QuickOpenGroup; entries: ScoredItem[] }[] = useMemo(() => {
    return groups
      .map(group => ({ group, entries: results.filter(r => r.item.kind === group.kind) }))
      .filter(g => g.entries.length > 0)
  }, [results, groups])

  const flatResults = useMemo(() => grouped.flatMap(g => g.entries), [grouped])

  const navigateTo = useCallback((item: QuickOpenItem) => {
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', { detail: item.navDetail }))
    close()
  }, [close])

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, flatResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const selected = flatResults[selectedIndex]
      if (selected) navigateTo(selected.item)
    }
  }

  // Keep the selected row in view
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (!open) return null

  let flatIndex = -1

  return (
    <ModalFrame onClose={close} ariaLabel="Quick open">
      <div
        className="w-full max-w-xl self-start mt-[12vh] rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <svg className="w-4 h-4 shrink-0 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.4-4.4" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Jump to chapter, entity, or note…"
            className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none dark:text-gray-100 dark:placeholder-gray-500"
            aria-label="Quick open search"
          />
          <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-mono text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400">esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
          {loading && items.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-gray-400 dark:text-gray-500">Loading project items…</div>
          ) : flatResults.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
              {query ? <>No matches for &ldquo;{query}&rdquo;</> : 'Nothing to show yet'}
            </div>
          ) : (
            grouped.map(({ group, entries }) => (
              <div key={group.kind}>
                <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                  {group.label}
                </div>
                {entries.map(entry => {
                  flatIndex++
                  const isSelected = flatIndex === selectedIndex
                  const myIndex = flatIndex
                  return (
                    <button
                      key={`${entry.item.kind}:${entry.item.id}`}
                      data-selected={isSelected}
                      onClick={() => navigateTo(entry.item)}
                      onMouseMove={() => setSelectedIndex(myIndex)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                        isSelected ? 'bg-gray-100 dark:bg-gray-700' : ''
                      }`}
                    >
                      <KindIcon icon={group.icon} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-gray-800 dark:text-gray-100">
                          <Highlighted text={entry.item.title} indices={entry.indices} />
                        </span>
                        {entry.item.subtitle && (
                          <span className="block truncate text-xs text-gray-400 dark:text-gray-500">
                            {entry.item.subtitle}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-gray-200 bg-gray-50 px-4 py-2 text-[11px] text-gray-400 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-500">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </ModalFrame>
  )
}

export default QuickOpenPalette
