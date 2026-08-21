'use client'

/**
 * RightPanelRail — the manuscript's right-hand spine.
 *
 * Mirrors LeftPanelRail: a 44px icon rail on the outer edge and one panel
 * filling the column. Unlike the left, a second panel can be *pinned* below
 * the active one (reference above, scratchpad below) with a draggable split.
 * Never more than two panels share the column, so none is ever squashed.
 *
 * Every contribution stays mounted; inactive ones are hidden. Two things rely
 * on that: a Bookworm Siege session or an unsaved chapter note must survive a
 * glance at another panel, and a panel that is off screen must still be able
 * to raise a rail badge (usePanelBadge).
 */

import {
  memo,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { PanelActionsProvider, PanelBadgeProvider, type PanelBadge } from '@bobbinry/sdk'
import { extensionRegistry, RegisteredExtension } from '@/lib/extensions'
import { useExtensions } from './ExtensionProvider'
import { PanelIcon } from './icons/PanelIcon'
import { RAIL_WIDTH } from './LeftPanelRail'

const SLOT_ID = 'shell.rightPanel'
const ACTIVE_STORAGE_KEY = 'shellRightRail:active'
const PINNED_STORAGE_KEY = 'shellRightRail:pinned'
const SPLIT_STORAGE_KEY = 'shellRightRail:split'

const DEFAULT_SPLIT = 0.55
const MIN_PANE_HEIGHT = 140
const PANE_HEADER_HEIGHT = 40
const DIVIDER_HEIGHT = 4

interface RightPanelRailProps {
  context?: any
  collapsed: boolean
  columnWidth: number
  animate: boolean
  onToggleCollapse: () => void
  onOpenMarketplace?: (() => void) | undefined
  emptyFallback?: ReactNode
  /**
   * Show exactly this panel, chromeless — focus mode floats a single
   * reference over the manuscript. The other panels stay mounted, and the
   * saved arrangement is never written from this mode.
   */
  soloPanelId?: string | undefined
}

const noopSubscribe = () => () => {}

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // best-effort persistence
  }
}

function clampSplit(value: number, containerHeight: number): number {
  const available = containerHeight - 2 * PANE_HEADER_HEIGHT - DIVIDER_HEIGHT
  if (available <= 2 * MIN_PANE_HEIGHT) return 0.5
  const minShare = MIN_PANE_HEIGHT / available
  return Math.min(1 - minShare, Math.max(minShare, value))
}

const PanelContent = memo(function PanelContent({
  extension,
  context,
}: {
  extension: RegisteredExtension
  context: any
}) {
  const Component = extension.component
  if (typeof Component === 'function') {
    return <Component {...context} context={context} />
  }
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 text-center">
      <p className="text-sm text-gray-700 dark:text-gray-300">
        Native component unavailable for {extension.contribution.title || extension.id}
      </p>
    </div>
  )
}, (prev, next) => (
  prev.extension.id === next.extension.id &&
  prev.extension.component === next.extension.component &&
  prev.context === next.context
))

function PinIcon({ filled }: { filled?: boolean }) {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 4h6l-1 6 3 3v1H7v-1l3-3z" />
      <path d="M12 14v6" />
    </svg>
  )
}

function RailBadge({ badge }: { badge: PanelBadge }) {
  const tone = badge.tone === 'attention'
    ? 'bg-orange-500 text-white dark:bg-orange-400 dark:text-gray-900'
    : 'bg-gray-400 text-white dark:bg-gray-500'
  if (badge.count && badge.count > 0) {
    const label = badge.count > 99 ? '99+' : String(badge.count)
    return (
      <span
        className={`pointer-events-none absolute -top-0.5 -right-0.5 min-w-[16px] rounded-full px-1 text-center text-[10px] font-semibold leading-4 ${tone}`}
        aria-hidden
      >
        {label}
      </span>
    )
  }
  return <span className={`pointer-events-none absolute top-0.5 right-0.5 h-2 w-2 rounded-full ${tone}`} aria-hidden />
}

function PaneHeader({
  title,
  actionsRef,
  pinned,
  onPin,
  canPin,
}: {
  title: string
  actionsRef: (el: HTMLDivElement | null) => void
  pinned: boolean
  onPin: () => void
  canPin: boolean
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-1.5 border-b border-gray-200 bg-gray-50 px-3 select-none dark:border-gray-600 dark:bg-gray-700"
      style={{ height: PANE_HEADER_HEIGHT }}
    >
      <span className="truncate text-sm font-medium text-gray-700 dark:text-gray-200">{title}</span>
      <div ref={actionsRef} className="flex flex-1 items-center justify-end gap-1" />
      {canPin ? (
        <button
          type="button"
          onClick={onPin}
          title={pinned ? 'Unpin' : 'Pin below'}
          aria-label={pinned ? `Unpin ${title}` : `Pin ${title} below`}
          aria-pressed={pinned}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            pinned
              ? 'text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/30'
              : 'text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-600 dark:hover:text-gray-200'
          }`}
        >
          <PinIcon filled={pinned} />
        </button>
      ) : null}
    </div>
  )
}

export function RightPanelRail({
  context,
  collapsed,
  columnWidth,
  animate,
  onToggleCollapse,
  onOpenMarketplace,
  emptyFallback,
  soloPanelId,
}: RightPanelRailProps) {
  const extensionContext = useExtensions()
  const registeredCount = extensionContext?.extensions?.length ?? 0
  const [slotChangeVersion, setSlotChangeVersion] = useState(0)
  const isHydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)

  const [activeId, setActiveId] = useState<string | null>(() => readStorage(ACTIVE_STORAGE_KEY))
  const [pinnedId, setPinnedId] = useState<string | null>(() => readStorage(PINNED_STORAGE_KEY))
  const [split, setSplit] = useState<number>(() => {
    const saved = Number(readStorage(SPLIT_STORAGE_KEY))
    return saved > 0 && saved < 1 ? saved : DEFAULT_SPLIT
  })
  const [badges, setBadges] = useState<Map<string, PanelBadge>>(() => new Map())
  const [upperActionsEl, setUpperActionsEl] = useState<HTMLDivElement | null>(null)
  const [lowerActionsEl, setLowerActionsEl] = useState<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement>(null)

  const extensions = useMemo(() => {
    if (!isHydrated) return []
    return extensionRegistry.getExtensionsForSlot(SLOT_ID, context)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, isHydrated, registeredCount, slotChangeVersion])

  useEffect(() => {
    return extensionRegistry.onSlotChange(SLOT_ID, () => setSlotChangeVersion(v => v + 1))
  }, [])

  // One-time cleanup of the retired stacked-layout state for this slot.
  useEffect(() => {
    try {
      Object.keys(localStorage)
        .filter(key => key.startsWith(`panelLayout:${SLOT_ID}`))
        .forEach(key => localStorage.removeItem(key))
    } catch {
      // localStorage unavailable — nothing to clean
    }
  }, [])

  // A saved id may point at an uninstalled bobbin or a panel whose `when`
  // is false on this view. Fall back without overwriting the preference.
  const pinnedExtension = useMemo(() => {
    if (!pinnedId || extensions.length < 2) return null
    return extensions.find(ext => ext.id === pinnedId) ?? null
  }, [extensions, pinnedId])

  const activeExtension = useMemo(() => {
    const candidate = extensions.find(ext => ext.id === activeId)
    if (candidate && candidate.id !== pinnedExtension?.id) return candidate
    return extensions.find(ext => ext.id !== pinnedExtension?.id) ?? null
  }, [extensions, activeId, pinnedExtension])

  const soloExtension = useMemo(
    () => (soloPanelId ? extensions.find(ext => ext.id === soloPanelId) ?? null : null),
    [extensions, soloPanelId]
  )

  const activate = useCallback((id: string) => {
    setActiveId(id)
    writeStorage(ACTIVE_STORAGE_KEY, id)
  }, [])

  const pin = useCallback((id: string | null) => {
    setPinnedId(id)
    writeStorage(PINNED_STORAGE_KEY, id)
  }, [])

  // Reveal requests (e.g. an entity click wants Entity Preview on screen).
  useEffect(() => {
    const handleReveal = (event: Event) => {
      const detail = (event as CustomEvent).detail as { slotId?: string; panelId?: string } | undefined
      if (!detail?.panelId || detail.slotId !== SLOT_ID) return
      if (detail.panelId === pinnedId) return
      activate(detail.panelId)
    }
    window.addEventListener('bobbinry:reveal-panel', handleReveal)
    return () => window.removeEventListener('bobbinry:reveal-panel', handleReveal)
  }, [activate, pinnedId])

  const handleIconClick = (ext: RegisteredExtension) => {
    if (ext.id === pinnedExtension?.id) {
      if (collapsed) onToggleCollapse()
      return
    }
    if (ext.id === activeExtension?.id && !collapsed) {
      onToggleCollapse()
      return
    }
    activate(ext.id)
    if (collapsed) onToggleCollapse()
  }

  const handlePinActive = () => {
    if (!activeExtension) return
    pin(activeExtension.id)
    const next = extensions.find(ext => ext.id !== activeExtension.id)
    if (next) activate(next.id)
  }

  const handleUnpin = () => {
    if (!pinnedExtension) return
    // You were looking at it — bring it back up rather than dropping it.
    pin(null)
    activate(pinnedExtension.id)
  }

  // Split divider drag
  const dragRef = useRef<{ startY: number; startSplit: number; height: number } | null>(null)
  const handleDividerMouseDown = (event: React.MouseEvent) => {
    event.preventDefault()
    const height = columnRef.current?.getBoundingClientRect().height ?? 0
    dragRef.current = { startY: event.clientY, startSplit: split, height }

    const handleMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const available = drag.height - 2 * PANE_HEADER_HEIGHT - DIVIDER_HEIGHT
      if (available <= 0) return
      setSplit(clampSplit(drag.startSplit + (e.clientY - drag.startY) / available, drag.height))
    }
    const handleUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      setSplit(current => {
        writeStorage(SPLIT_STORAGE_KEY, String(current))
        return current
      })
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }

  // Badge setters: one stable function per extension id, so the provider
  // value only changes when the set of panels does.
  const extensionIds = extensions.map(ext => ext.id).join('\n')
  const badgeSetters = useMemo(() => {
    const map = new Map<string, (badge: PanelBadge | null) => void>()
    for (const id of extensionIds ? extensionIds.split('\n') : []) {
      map.set(id, (badge: PanelBadge | null) => {
        setBadges(prev => {
          const current = prev.get(id)
          if (!badge && !current) return prev
          const next = new Map(prev)
          if (badge) next.set(id, badge)
          else next.delete(id)
          return next
        })
      })
    }
    return map
  }, [extensionIds])

  const isSolo = soloExtension != null
  const showLower = !isSolo && pinnedExtension != null && activeExtension != null

  return (
    <div className="flex h-full">
      {/* Panel column */}
      <div
        className={`overflow-hidden ${animate ? 'transition-all duration-300' : ''}`}
        style={{ width: isSolo ? '100%' : collapsed ? 0 : columnWidth }}
      >
        <div
          ref={columnRef}
          className="flex h-full flex-col"
          style={isSolo ? undefined : { width: columnWidth }}
        >
          {extensions.length === 0 ? (
            emptyFallback ?? null
          ) : (
            <>
              {!isSolo && activeExtension ? (
                <div style={{ order: 0 }} className="shrink-0">
                  <PaneHeader
                    title={activeExtension.contribution.title || activeExtension.id}
                    actionsRef={setUpperActionsEl}
                    pinned={false}
                    onPin={handlePinActive}
                    canPin={extensions.length > 1}
                  />
                </div>
              ) : null}

              {/* Every panel is a sibling here so pinning, unpinning and solo
                  mode reorder the same nodes rather than remounting them. */}
              {extensions.map(ext => {
                const isActive = isSolo ? ext.id === soloExtension?.id : ext.id === activeExtension?.id
                const isPinned = showLower && ext.id === pinnedExtension?.id
                const visible = isActive || isPinned
                const order = isPinned ? 4 : 1
                const grow = !showLower ? 1 : isPinned ? 1 - split : split
                const actionsTarget = isActive && !isSolo ? upperActionsEl : isPinned ? lowerActionsEl : null
                return (
                  <div
                    key={ext.id}
                    className={visible ? 'min-h-0 overflow-hidden' : 'hidden'}
                    style={visible ? { order, flexGrow: grow, flexBasis: 0 } : undefined}
                    data-panel-id={ext.id}
                    data-panel-state={isPinned ? 'pinned' : isActive ? 'active' : 'hidden'}
                  >
                    <PanelBadgeProvider value={badgeSetters.get(ext.id) ?? null}>
                      <PanelActionsProvider value={actionsTarget}>
                        <PanelContent extension={ext} context={context} />
                      </PanelActionsProvider>
                    </PanelBadgeProvider>
                  </div>
                )
              })}

              {showLower ? (
                <>
                  <div
                    style={{ order: 2, height: DIVIDER_HEIGHT }}
                    className="shrink-0 cursor-row-resize bg-gray-200 transition-colors hover:bg-blue-400 active:bg-blue-500 dark:bg-gray-600 dark:hover:bg-blue-500"
                    onMouseDown={handleDividerMouseDown}
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label="Resize panes"
                  />
                  <div style={{ order: 3 }} className="shrink-0">
                    <PaneHeader
                      title={pinnedExtension.contribution.title || pinnedExtension.id}
                      actionsRef={setLowerActionsEl}
                      pinned
                      onPin={handleUnpin}
                      canPin
                    />
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Icon rail — outer edge. The active tab shares the column's surface
          and cancels the border between them, like a folder tab. */}
      {!isSolo ? (
        <div
          className={`relative flex shrink-0 flex-col items-center border-l bg-gray-50 py-1 dark:bg-gray-800 ${
            collapsed ? 'border-transparent' : 'border-gray-200 dark:border-gray-700'
          }`}
          style={{ width: RAIL_WIDTH }}
          role="tablist"
          aria-orientation="vertical"
          aria-label="Reference panels"
        >
          {extensions.map(ext => {
            const isActive = ext.id === activeExtension?.id && !collapsed
            const isPinned = ext.id === pinnedExtension?.id && !collapsed
            const badge = badges.get(ext.id)
            const title = ext.contribution.title || ext.id
            const badgeLabel = badge?.count ? `, ${badge.count} pending` : badge?.dot ? ', updated' : ''
            return (
              <button
                key={ext.id}
                type="button"
                role="tab"
                aria-selected={isActive || isPinned}
                title={isPinned ? `${title} (pinned)` : title}
                aria-label={`${title}${isPinned ? ' (pinned)' : ''}${badgeLabel}`}
                onClick={() => handleIconClick(ext)}
                className="relative flex h-11 w-full items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
              >
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute -left-px top-1 bottom-1 right-1.5 rounded-r-md border border-l-0 border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-800"
                  />
                ) : null}
                <span
                  className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                    isActive
                      ? 'text-blue-700 dark:text-blue-300'
                      : isPinned
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                        : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300'
                  }`}
                >
                  <PanelIcon
                    name={(ext.contribution as { icon?: string }).icon}
                    fallbackLabel={title}
                  />
                  {isPinned ? (
                    <span className="absolute -bottom-0.5 -right-0.5 text-blue-600 dark:text-blue-300" aria-hidden>
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M9 4h6l-1 6 3 3v1H7v-1l3-3z" />
                        <path d="M11 14h2v6h-2z" />
                      </svg>
                    </span>
                  ) : null}
                  {badge ? <RailBadge badge={badge} /> : null}
                </span>
              </button>
            )
          })}
          <div className="flex-1" />
          {onOpenMarketplace && (
            <button
              type="button"
              title="Browse bobbins"
              onClick={onOpenMarketplace}
              className="flex h-11 w-full items-center justify-center text-gray-400 transition-colors hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default RightPanelRail
