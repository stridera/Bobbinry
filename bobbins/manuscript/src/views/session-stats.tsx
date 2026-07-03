'use client'

import { useState, useEffect, useRef } from 'react'

// A gap this long without any editing ends the session; the next edit starts
// a fresh one (new word baseline, elapsed timer restarts). Keeps an overnight
// tab from reporting yesterday's deletions as "this session".
const SESSION_IDLE_RESET_MS = 2 * 60 * 60 * 1000

interface EntityCounts {
  baseline: number
  latest: number
}

/**
 * Session Stats panel for the shell.editorFooter slot.
 * Shows words written this session and session duration.
 *
 * Listens for bobbinry:view-context-change events to track word counts and
 * compute session deltas. Baselines are kept per entity so switching chapters
 * mid-session doesn't corrupt the total.
 */
export default function SessionStatsPanel() {
  const [sessionWords, setSessionWords] = useState(0)
  const [sessionStart, setSessionStart] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState('')
  const countsRef = useRef<Map<string, EntityCounts>>(new Map())
  const lastActivityRef = useRef(0)

  // Listen for word count updates from the editor
  useEffect(() => {
    const handleContextChange = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, any>>).detail
      if (typeof detail?.wordCount !== 'number') return

      const now = Date.now()
      const stale = lastActivityRef.current > 0 && now - lastActivityRef.current > SESSION_IDLE_RESET_MS
      if (stale) countsRef.current.clear()
      lastActivityRef.current = now

      const entityId = typeof detail.entityId === 'string' ? detail.entityId : '__unknown__'
      const counts = countsRef.current.get(entityId)
      if (counts) {
        counts.latest = detail.wordCount
      } else {
        countsRef.current.set(entityId, { baseline: detail.wordCount, latest: detail.wordCount })
      }

      let total = 0
      for (const entry of countsRef.current.values()) {
        total += entry.latest - entry.baseline
      }
      setSessionWords(total)
      setSessionStart(prev => (stale || prev === null) ? now : prev)
    }

    window.addEventListener('bobbinry:view-context-change', handleContextChange)
    return () => window.removeEventListener('bobbinry:view-context-change', handleContextChange)
  }, [])

  // Update elapsed time display; end the session after a long idle gap
  useEffect(() => {
    const update = () => {
      if (sessionStart === null) {
        setElapsed('')
        return
      }
      if (lastActivityRef.current > 0 && Date.now() - lastActivityRef.current > SESSION_IDLE_RESET_MS) {
        countsRef.current.clear()
        setSessionWords(0)
        setSessionStart(null)
        setElapsed('')
        return
      }
      const ms = Date.now() - sessionStart
      const minutes = Math.floor(ms / 60000)
      if (minutes < 1) {
        setElapsed('')
      } else if (minutes < 60) {
        setElapsed(`${minutes}m`)
      } else {
        const hours = Math.floor(minutes / 60)
        const mins = minutes % 60
        setElapsed(`${hours}h ${mins}m`)
      }
    }

    update()
    const timer = setInterval(update, 30000)
    return () => clearInterval(timer)
  }, [sessionStart])

  const hasStats = sessionWords !== 0 || elapsed

  if (!hasStats) return null

  return (
    <span className="flex items-center gap-3 text-xs">
      {sessionWords !== 0 && (
        <span className={sessionWords > 0 ? 'text-green-500 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>
          {sessionWords > 0 ? '+' : ''}{sessionWords.toLocaleString()} words this session
        </span>
      )}
      {elapsed && (
        <span className="text-gray-400 dark:text-gray-500">
          {elapsed}
        </span>
      )}
    </span>
  )
}
