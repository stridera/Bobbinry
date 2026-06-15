'use client'

import { useState, type ReactNode } from 'react'

interface CollapsibleCardProps {
  title: string
  defaultExpanded?: boolean
  /** Non-interactive content (e.g. a status badge) shown beside the title in the header. */
  headerAccessory?: ReactNode
  children: ReactNode
}

export function CollapsibleCard({ title, defaultExpanded = false, headerAccessory, children }: CollapsibleCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in">
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
