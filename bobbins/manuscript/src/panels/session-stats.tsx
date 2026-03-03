'use client'

import { useState, useEffect, useRef } from 'react'

/**
 * Session Stats panel for the shell.editorFooter slot.
 * Shows word count, words written this session, and session duration.
 *
 * Listens for bobbinry:view-context-change events to track the current
 * entity's word count and compute session deltas.
 */
export default function SessionStatsPanel() {
  const [wordCount, setWordCount] = useState(0)
  const [sessionWords, setSessionWords] = useState(0)
  const [sessionStart] = useState(() => Date.now())
  const [elapsed, setElapsed] = useState('0m')
  const initialWordCountRef = useRef<number | null>(null)

  // Listen for word count updates from the editor
  useEffect(() => {
    const handleContextChange = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, any>>).detail
      if (typeof detail?.wordCount === 'number') {
        const count = detail.wordCount
        setWordCount(count)

        if (initialWordCountRef.current === null) {
          initialWordCountRef.current = count
        } else {
          setSessionWords(count - initialWordCountRef.current)
        }
      }
    }

    window.addEventListener('bobbinry:view-context-change', handleContextChange)
    return () => window.removeEventListener('bobbinry:view-context-change', handleContextChange)
  }, [])

  // Update elapsed time display
  useEffect(() => {
    const timer = setInterval(() => {
      const ms = Date.now() - sessionStart
      const minutes = Math.floor(ms / 60000)
      if (minutes < 60) {
        setElapsed(`${minutes}m`)
      } else {
        const hours = Math.floor(minutes / 60)
        const mins = minutes % 60
        setElapsed(`${hours}h ${mins}m`)
      }
    }, 30000) // Update every 30s

    return () => clearInterval(timer)
  }, [sessionStart])

  return (
    <>
      {wordCount > 0 && (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {wordCount.toLocaleString()} words
        </span>
      )}
      {sessionWords !== 0 && (
        <span className={`text-xs ${sessionWords > 0 ? 'text-green-500 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
          {sessionWords > 0 ? '+' : ''}{sessionWords.toLocaleString()} this session
        </span>
      )}
      <span className="text-xs text-gray-400 dark:text-gray-500">
        {elapsed}
      </span>
    </>
  )
}
