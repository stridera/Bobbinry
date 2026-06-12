'use client'

import { useEffect, useRef, useState } from 'react'
import type { ViewRegistryEntry } from '@/lib/view-registry'

const MAX_INLINE_VIEWS = 4

export function ViewIcon({ type }: { type: string }) {
  switch (type) {
    case 'tree':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="2" y1="3" x2="12" y2="3" />
          <line x1="4" y1="6.5" x2="12" y2="6.5" />
          <line x1="4" y1="10" x2="12" y2="10" />
        </svg>
      )
    case 'board':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="1" width="5" height="5" rx="1" />
          <rect x="8" y="1" width="5" height="5" rx="1" />
          <rect x="1" y="8" width="5" height="5" rx="1" />
          <rect x="8" y="8" width="5" height="5" rx="1" />
        </svg>
      )
    case 'editor':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.5 1.5L12.5 4.5L4.5 12.5H1.5V9.5L9.5 1.5Z" />
        </svg>
      )
    case 'table':
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1.5" y="1.5" width="11" height="11" rx="1" />
          <line x1="1.5" y1="5" x2="12.5" y2="5" />
          <line x1="5" y1="5" x2="5" y2="12.5" />
        </svg>
      )
    default:
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="1" width="12" height="12" rx="2" />
        </svg>
      )
  }
}

function viewLabel(view: ViewRegistryEntry): string {
  return view.metadata.name || view.viewId.split('.').pop() || 'View'
}

function ViewTab({
  view,
  isActive,
  onClick,
}: {
  view: ViewRegistryEntry
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors
        ${isActive
          ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm border border-gray-200 dark:border-gray-600'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
        }
      `}
    >
      <ViewIcon type={view.metadata.type || 'custom'} />
      {viewLabel(view)}
    </button>
  )
}

interface ViewHeaderBarProps {
  compatibleViews: ViewRegistryEntry[]
  activeViewId: string | null
  onViewSwitch: (viewId: string) => void
}

export function ViewHeaderBar({ compatibleViews, activeViewId, onViewSwitch }: ViewHeaderBarProps) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!overflowOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(event.target as Node)) {
        setOverflowOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [overflowOpen])

  const showOverflow = compatibleViews.length > MAX_INLINE_VIEWS
  const inlineViews = showOverflow ? compatibleViews.slice(0, MAX_INLINE_VIEWS - 1) : compatibleViews
  const overflowViews = showOverflow ? compatibleViews.slice(MAX_INLINE_VIEWS - 1) : []
  const activeOverflowView = overflowViews.find(v => v.viewId === activeViewId)

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
      {/* View switcher (the breadcrumb lives in the shell top bar) */}
      {compatibleViews.length > 1 && (
        <div className="flex shrink-0 items-center gap-1">
          {inlineViews.map(view => (
            <ViewTab
              key={view.viewId}
              view={view}
              isActive={view.viewId === activeViewId}
              onClick={() => onViewSwitch(view.viewId)}
            />
          ))}
          {showOverflow && (
            <div className="relative" ref={overflowRef}>
              <button
                onClick={() => setOverflowOpen(open => !open)}
                title="More views"
                className={`
                  flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors
                  ${activeOverflowView
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm border border-gray-200 dark:border-gray-600'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
                  }
                `}
              >
                {activeOverflowView ? (
                  <>
                    <ViewIcon type={activeOverflowView.metadata.type || 'custom'} />
                    {viewLabel(activeOverflowView)}
                  </>
                ) : (
                  <span className="px-0.5">&#8943;</span>
                )}
              </button>
              {overflowOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                  {overflowViews.map(view => (
                    <button
                      key={view.viewId}
                      onClick={() => {
                        onViewSwitch(view.viewId)
                        setOverflowOpen(false)
                      }}
                      className={`
                        flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors
                        ${view.viewId === activeViewId
                          ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-medium'
                          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }
                      `}
                    >
                      <ViewIcon type={view.metadata.type || 'custom'} />
                      {viewLabel(view)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ViewHeaderBar
