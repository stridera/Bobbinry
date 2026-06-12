'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BobbinryAPI, EntityAPI, fuzzyMatch } from '@bobbinry/sdk'
import { ModalFrame } from '@bobbinry/ui-components'

type ItemKind = 'manuscript' | 'entity' | 'note'

interface QuickOpenItem {
  id: string
  title: string
  kind: ItemKind
  subtitle: string
  navDetail: {
    entityType: string
    entityId: string
    bobbinId: string
    metadata?: Record<string, any>
  }
}

interface ScoredItem {
  item: QuickOpenItem
  score: number
  indices: number[]
}

const CACHE_TTL_MS = 60_000
const MAX_RESULTS = 50

// Module-level cache so reopening the palette is instant; refreshed in the
// background when stale.
let itemsCache: { projectId: string; at: number; items: QuickOpenItem[] } | null = null

const KIND_LABEL: Record<ItemKind, string> = {
  manuscript: 'Manuscript',
  entity: 'Entities',
  note: 'Notes',
}

const KIND_ORDER: ItemKind[] = ['manuscript', 'entity', 'note']

async function fetchItems(entityApi: EntityAPI): Promise<QuickOpenItem[]> {
  const safeQuery = (collection: string) =>
    entityApi.query({ collection, limit: 1000 }).catch(() => ({ data: [], total: 0 }))

  const [containers, content, typeDefs, notes] = await Promise.all([
    safeQuery('containers'),
    safeQuery('content'),
    safeQuery('entity_type_definitions'),
    safeQuery('notes'),
  ])

  const containerMap = new Map<string, { title: string; parentId: string | null }>()
  for (const c of (containers.data as any[]) ?? []) {
    if (!c?.id) continue
    containerMap.set(c.id, {
      title: c.title || 'Untitled',
      parentId: c.parent_id || c.parentId || null,
    })
  }

  const pathTo = (startId: string | null): string => {
    const parts: string[] = []
    let cursor = startId
    for (let i = 0; cursor && i < 32; i++) {
      const record = containerMap.get(cursor)
      if (!record) break
      parts.unshift(record.title)
      cursor = record.parentId
    }
    return parts.join(' › ')
  }

  const items: QuickOpenItem[] = []

  for (const [id, c] of containerMap) {
    items.push({
      id,
      title: c.title,
      kind: 'manuscript',
      subtitle: pathTo(c.parentId),
      navDetail: {
        entityType: 'container',
        entityId: id,
        bobbinId: 'manuscript',
        metadata: { type: 'container' },
      },
    })
  }

  for (const record of (content.data as any[]) ?? []) {
    if (!record?.id) continue
    const containerId = record.containerId || record.container_id || null
    items.push({
      id: record.id,
      title: record.title || 'Untitled',
      kind: 'manuscript',
      subtitle: pathTo(containerId),
      navDetail: {
        entityType: 'content',
        entityId: record.id,
        bobbinId: 'manuscript',
        metadata: { type: 'content', parentId: containerId },
      },
    })
  }

  const types = ((typeDefs.data as any[]) ?? [])
    .map(t => ({ typeId: t.type_id || t.typeId, label: t.label || t.type_id || t.typeId }))
    .filter(t => t.typeId)

  const perType = await Promise.all(
    types.map(async type => {
      const result = await safeQuery(type.typeId)
      return { type, records: (result.data as any[]) ?? [] }
    })
  )

  for (const { type, records } of perType) {
    for (const record of records) {
      if (!record?.id) continue
      items.push({
        id: record.id,
        title: record.name || record.title || 'Untitled',
        kind: 'entity',
        subtitle: type.label,
        navDetail: {
          entityType: type.typeId,
          entityId: record.id,
          bobbinId: 'entities',
          metadata: { view: 'entity-editor', typeId: type.typeId, typeLabel: type.label },
        },
      })
    }
  }

  for (const record of (notes.data as any[]) ?? []) {
    if (!record?.id) continue
    items.push({
      id: record.id,
      title: record.title || 'Untitled',
      kind: 'note',
      subtitle: 'Notes',
      navDetail: {
        entityType: 'notes',
        entityId: record.id,
        bobbinId: 'notes',
        metadata: { view: 'note-editor' },
      },
    })
  }

  return items
}

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

function KindIcon({ kind }: { kind: ItemKind }) {
  const paths = {
    manuscript: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
    entity: <><circle cx="12" cy="8" r="4" /><path d="M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2" /></>,
    note: <><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z" /><path d="M15 3v6h6" /></>,
  }
  return (
    <svg className="w-4 h-4 shrink-0 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[kind]}
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
  const [loading, setLoading] = useState(false)
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

    /* eslint-disable react-hooks/set-state-in-effect -- hydrate from module cache on open */
    if (itemsCache && itemsCache.projectId === projectId) {
      setItems(itemsCache.items)
      if (Date.now() - itemsCache.at < CACHE_TTL_MS) return
    } else {
      setLoading(true)
    }
    /* eslint-enable react-hooks/set-state-in-effect */

    fetchItems(entityApi)
      .then(fetched => {
        itemsCache = { projectId, at: Date.now(), items: fetched }
        if (!cancelled) {
          setItems(fetched)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, entityApi, projectId])

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

  // Stable flat order grouped by kind — keyboard selection follows this order
  const grouped: { kind: ItemKind; entries: ScoredItem[] }[] = useMemo(() => {
    return KIND_ORDER
      .map(kind => ({ kind, entries: results.filter(r => r.item.kind === kind) }))
      .filter(group => group.entries.length > 0)
  }, [results])

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
            grouped.map(group => (
              <div key={group.kind}>
                <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                  {KIND_LABEL[group.kind]}
                </div>
                {group.entries.map(entry => {
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
                      <KindIcon kind={entry.item.kind} />
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
