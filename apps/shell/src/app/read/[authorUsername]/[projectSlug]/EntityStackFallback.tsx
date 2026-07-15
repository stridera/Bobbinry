'use client'

/**
 * Rendered inside EntityModal / EntitySidebar when in-place navigation lands
 * on an entity the reader can't see: tier-locked (403) or not published
 * (404). Keeps the reader in the browsing flow with a back arrow instead of
 * dead-ending on a broken link.
 */

import EntityHeaderActions from './EntityHeaderActions'
import type { EntityStackEntry } from './useEntityStack'

interface EntityStackFallbackProps {
  entry: Extract<EntityStackEntry, { kind: 'locked' | 'missing' }>
  onClose: () => void
  onBack?: (() => void) | undefined
  /** Jump to the Support tab, highlighting the required tier. */
  onSubscribeNudge?: ((tierLevel?: number) => void) | undefined
}

export default function EntityStackFallback({ entry, onClose, onBack, onSubscribeNudge }: EntityStackFallbackProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-700">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xl dark:bg-gray-800">
            <svg className="h-5 w-5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </span>
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {entry.kind === 'locked' ? 'Subscriber entry' : 'Not available'}
          </div>
        </div>
        <EntityHeaderActions onClose={onClose} onBack={onBack} />
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-8">
        {entry.kind === 'locked' ? (
          <div className="rounded-lg border border-purple-200 bg-purple-50 p-6 text-sm text-purple-800 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-200">
            <p className="font-medium">
              This entry is available to subscribers at tier {entry.tierLevel} or higher.
            </p>
            {onSubscribeNudge && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onSubscribeNudge(entry.tierLevel)
                }}
                className="mt-3 inline-flex items-center gap-1 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700"
              >
                View subscription tiers →
              </button>
            )}
          </div>
        ) : (
          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            This entry isn't published.
          </p>
        )}
      </div>
    </div>
  )
}
