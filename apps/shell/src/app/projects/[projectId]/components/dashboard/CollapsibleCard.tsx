'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'

interface CollapsibleCardProps {
  title: string
  defaultExpanded?: boolean
  /** Non-interactive content (e.g. a status badge) shown beside the title in the header. */
  headerAccessory?: ReactNode
  /** Anchor id: navigating to #<id> expands the card and scrolls it into view. */
  id?: string
  children: ReactNode
}

export function CollapsibleCard({ title, defaultExpanded = false, headerAccessory, id, children }: CollapsibleCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const cardRef = useRef<HTMLDivElement>(null)

  // Deep-link support: #<id> in the URL (on load or via in-page navigation)
  // expands this card and scrolls to it. The scroll re-fires for a while
  // because content above (stats, chapter list, images) keeps growing after
  // mount and would otherwise push the card back out of view — but any manual
  // scroll from the user cancels the remaining re-fires.
  useEffect(() => {
    if (!id) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const cancelEvents = ['wheel', 'touchstart', 'keydown'] as const
    const cancel = () => {
      timers.forEach(clearTimeout)
      cancelEvents.forEach(ev => window.removeEventListener(ev, cancel))
    }
    const openFromHash = () => {
      if (window.location.hash !== `#${id}`) return
      setExpanded(true)
      cancelEvents.forEach(ev => window.addEventListener(ev, cancel, { passive: true }))
      for (const delay of [0, 250, 700, 1400]) {
        timers.push(setTimeout(() => {
          cardRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
        }, delay))
      }
    }
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    return () => {
      window.removeEventListener('hashchange', openFromHash)
      cancel()
    }
  }, [id])

  return (
    <div ref={cardRef} id={id} className="scroll-mt-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in">
      <button
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between p-6 cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          {headerAccessory}
        </span>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-6 pb-6 border-t border-gray-100 dark:border-gray-700 pt-4">
          {children}
        </div>
      )}
    </div>
  )
}
