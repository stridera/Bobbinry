import { createContext, useContext, useEffect } from 'react'

/**
 * Rail badges let a panel that is not on screen signal attention — e.g.
 * Reader Feedback showing "7" open threads while Entity Preview is active.
 *
 * The shell provides a setter through context; panels call usePanelBadge()
 * with their current badge (or null). Outside a badge-aware host the hook is
 * a no-op, so panels can adopt it without checking where they are mounted.
 */
export interface PanelBadge {
  /** Numeric count. Rendered as a pill; values over 99 show as "99+". */
  count?: number
  /** Plain dot, for "something changed" without a number. */
  dot?: boolean
  /** `attention` is the warm accent; `neutral` is muted. Defaults to neutral. */
  tone?: 'neutral' | 'attention'
}

export type PanelBadgeSetter = (badge: PanelBadge | null) => void

const PanelBadgeContext = createContext<PanelBadgeSetter | null>(null)

export const PanelBadgeProvider = PanelBadgeContext.Provider

export function usePanelBadge(badge: PanelBadge | null): void {
  const setBadge = useContext(PanelBadgeContext)
  const count = badge?.count
  const dot = badge?.dot
  const tone = badge?.tone
  const active = badge != null && ((count ?? 0) > 0 || dot === true)

  useEffect(() => {
    if (!setBadge) return
    if (!active) {
      setBadge(null)
      return
    }
    const next: PanelBadge = {}
    if (count !== undefined) next.count = count
    if (dot !== undefined) next.dot = dot
    if (tone !== undefined) next.tone = tone
    setBadge(next)
  }, [setBadge, active, count, dot, tone])

  useEffect(() => {
    if (!setBadge) return
    return () => setBadge(null)
  }, [setBadge])
}
