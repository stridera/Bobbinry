'use client'

/**
 * Header actions shared by EntityModal and EntitySidebar: an optional back
 * arrow (when browsing a stack of entities in place), a link to the
 * entity's full subpage, plus a close button.
 */

import Link from 'next/link'

interface EntityHeaderActionsProps {
  subpageHref?: string | undefined
  onClose: () => void
  /** Pop back to the previously viewed entity. Rendered only when set. */
  onBack?: (() => void) | undefined
}

export default function EntityHeaderActions({ subpageHref, onClose, onBack }: EntityHeaderActionsProps) {
  return (
    <div className="flex items-center gap-1">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to previous entity"
          title="Back to previous entity"
          className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {subpageHref && (
        <Link
          href={subpageHref}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          title="Open this entity as its own page"
        >
          Open as page ↗
        </Link>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
