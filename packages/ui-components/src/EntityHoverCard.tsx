/**
 * Entity Hover Card
 *
 * The first rung of the entity ladder: hover peeks, click opens the panel, the
 * panel links to the full entity page. This card is deliberately inert —
 * `pointer-events: none`, no controls, nothing to aim at. Clicking "through" it
 * hits the word underneath, which is what opens the panel.
 *
 * Shared by the manuscript editor and the public reader, which feed it very
 * differently. The editor already holds every entity record in memory, so its
 * card is instant. The reader must fetch — entity data there is tier-gated and
 * spoiler-sensitive, and the bulk name list deliberately carries no
 * descriptions — so it opens the card with the little it knows and enriches it
 * when the gated fetch lands. Hence `pending` and `locked`.
 *
 * Timing policy lives here rather than in the callers: a card that fires while
 * you are typing or drag-selecting is worse than no card at all.
 */

import { useEffect, useRef, useState } from 'react'

export interface EntityPeekEntry {
  id: string
  name: string
  typeId: string
  typeIcon: string
  typeLabel: string
  description?: string | undefined
  imageUrl?: string | undefined
}

/** Payload of `bobbinry:entity-hover`. `rect` is viewport-relative. */
export interface EntityHoverDetail {
  key: string
  name: string
  entries: EntityPeekEntry[]
  rect: { top: number; bottom: number; left: number; right: number }
  /** Detail is still being fetched; the card shows a placeholder line. */
  pending?: boolean | undefined
  /** The reader can't see this entity yet. Never render a gated description. */
  locked?: { tierLevel: number } | undefined
}

/** Pointer must rest this long before the card appears. */
const OPEN_DELAY_MS = 400
/** Grace period on leave, so crossing between adjacent names doesn't flicker. */
const CLOSE_DELAY_MS = 120
/** Hovering is browsing, not writing — stay out of the way just after a keystroke. */
const TYPING_QUIET_MS = 1000
/** Below this much room above the word, the card flips underneath it. */
const FLIP_THRESHOLD_PX = 200
const CARD_WIDTH_PX = 288
const VIEWPORT_MARGIN_PX = 8

/**
 * Entity descriptions may hold rich text. Reduce to a single plain line —
 * exported for tests.
 */
export function toPlainSummary(raw: string | undefined, maxLength = 180): string {
  if (!raw) return ''
  const text = raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length <= maxLength) return text
  const clipped = text.slice(0, maxLength)
  const lastSpace = clipped.lastIndexOf(' ')
  return `${(lastSpace > maxLength * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`
}

export function EntityHoverCard() {
  const [hover, setHover] = useState<EntityHoverDetail | null>(null)

  // Timers and suppression flags stay in refs — window listeners must see the
  // latest values without re-subscribing on every hover.
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draggingRef = useRef(false)
  const lastKeyAtRef = useRef(0)
  const shownKeyRef = useRef<string | null>(null)
  // Latest detail for the hovered name. The open timer reads this when it
  // fires, so an enrichment arriving mid-delay updates the content in place
  // instead of restarting the wait the reader has already served.
  const pendingRef = useRef<EntityHoverDetail | null>(null)

  useEffect(() => {
    const clearOpen = () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
    const clearClose = () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    const dismiss = () => {
      clearOpen()
      clearClose()
      shownKeyRef.current = null
      pendingRef.current = null
      setHover(null)
    }

    const handleHover = (event: Event) => {
      const detail = (event as CustomEvent<EntityHoverDetail>).detail
      if (!detail?.entries?.length) return
      if (draggingRef.current) return
      if (Date.now() - lastKeyAtRef.current < TYPING_QUIET_MS) return

      // Re-entering the name that's already shown, or an enrichment landing for
      // it: cancel the pending close and swap the content, rather than tearing
      // the card down and rebuilding it.
      clearClose()
      if (shownKeyRef.current === detail.key) {
        pendingRef.current = detail
        setHover(detail)
        return
      }

      // An enrichment for a name still inside its open delay: update what the
      // timer will show without pushing the deadline back.
      if (pendingRef.current?.key === detail.key && openTimerRef.current) {
        pendingRef.current = detail
        return
      }

      clearOpen()
      pendingRef.current = detail
      openTimerRef.current = setTimeout(() => {
        openTimerRef.current = null
        if (draggingRef.current) return
        const latest = pendingRef.current
        if (!latest) return
        shownKeyRef.current = latest.key
        setHover(latest)
      }, OPEN_DELAY_MS)
    }

    const handleHoverEnd = () => {
      clearOpen()
      clearClose()
      closeTimerRef.current = setTimeout(() => {
        shownKeyRef.current = null
        pendingRef.current = null
        setHover(null)
      }, CLOSE_DELAY_MS)
    }

    const handleKeyDown = () => {
      lastKeyAtRef.current = Date.now()
      dismiss()
    }
    const handleMouseDown = () => {
      draggingRef.current = true
      dismiss()
    }
    const handleMouseUp = () => {
      draggingRef.current = false
    }

    window.addEventListener('bobbinry:entity-hover', handleHover)
    window.addEventListener('bobbinry:entity-hover-end', handleHoverEnd)
    // A click promotes the peek to the preview panel — the card has done its job.
    window.addEventListener('bobbinry:entity-preview', dismiss)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)
    // Any scroll invalidates the anchor rect we were positioned against.
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)

    return () => {
      clearOpen()
      clearClose()
      window.removeEventListener('bobbinry:entity-hover', handleHover)
      window.removeEventListener('bobbinry:entity-hover-end', handleHoverEnd)
      window.removeEventListener('bobbinry:entity-preview', dismiss)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [])

  if (!hover) return null

  const entry = hover.entries[0]
  if (!entry) return null

  const summary = toPlainSummary(entry.description)
  const extraCount = hover.entries.length - 1
  const placeAbove = hover.rect.top >= FLIP_THRESHOLD_PX

  const maxLeft = Math.max(
    VIEWPORT_MARGIN_PX,
    window.innerWidth - CARD_WIDTH_PX - VIEWPORT_MARGIN_PX
  )
  const left = Math.min(Math.max(hover.rect.left, VIEWPORT_MARGIN_PX), maxLeft)

  // Placement and entrance animation are split across two elements on purpose:
  // the shell's `fade-in` keyframes animate `transform` with `both` fill, so an
  // inline transform on the same element gets overridden and "above" placement
  // silently collapses onto the word it describes.
  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{
        left,
        width: CARD_WIDTH_PX,
        top: placeAbove ? hover.rect.top - 8 : hover.rect.bottom + 8,
        ...(placeAbove ? { transform: 'translateY(-100%)' } : {}),
      }}
    >
      {/* A tooltip proper, not an aria-hidden decoration: the same content is
          reachable by keyboard through the highlight itself, which is a button
          that opens the panel. Nothing here is mouse-only information. */}
      <div
        role="tooltip"
        className="select-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl px-3 py-2.5 animate-fade-in"
      >
        <div className="flex items-start gap-2.5">
          {entry.imageUrl && (
            <img
              src={entry.imageUrl}
              alt=""
              className="w-10 h-10 rounded object-cover shrink-0 bg-gray-100 dark:bg-gray-700"
              onError={event => {
                event.currentTarget.style.display = 'none'
              }}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              {entry.typeIcon && <span className="text-sm shrink-0">{entry.typeIcon}</span>}
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {entry.name}
              </span>
            </div>
            <div className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mt-0.5">
              {entry.typeLabel}
            </div>
            {hover.locked ? (
              <p className="text-xs leading-relaxed mt-1.5 text-amber-600 dark:text-amber-400">
                🔒 Subscriber-only
              </p>
            ) : !summary && hover.pending ? (
              // Placeholder rather than "No description yet." — saying the
              // entity has no description while still fetching it is a lie the
              // reader would see for a few hundred milliseconds.
              <div className="mt-2 space-y-1.5" aria-hidden>
                <div className="h-2 w-full rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                <div className="h-2 w-2/3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
              </div>
            ) : (
              <p
                className={`text-xs leading-relaxed mt-1.5 ${
                  summary
                    ? 'text-gray-600 dark:text-gray-300'
                    : 'text-gray-400 dark:text-gray-500 italic'
                }`}
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {summary || 'No description yet.'}
              </p>
            )}
          </div>
        </div>
        {extraCount > 0 && (
          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
            +{extraCount} other {extraCount === 1 ? 'entity shares' : 'entities share'} this name —
            click to choose
          </div>
        )}
      </div>
    </div>
  )
}

export default EntityHoverCard
