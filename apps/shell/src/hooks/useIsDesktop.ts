import { useEffect, useState } from 'react'

/**
 * Tracks the lg breakpoint so callers can pick between a docked sidebar and a
 * modal (which has side effects like body scroll lock — CSS hiding alone isn't
 * enough). SSR-safe: starts false, resolves on mount.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration bridge
    setIsDesktop(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}
