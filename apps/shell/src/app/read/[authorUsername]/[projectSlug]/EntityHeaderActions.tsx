'use client'

/**
 * Header actions shared by EntityModal and EntitySidebar: a link to the
 * entity's full subpage plus a close button.
 */

import Link from 'next/link'

interface EntityHeaderActionsProps {
  subpageHref: string
  onClose: () => void
}

export default function EntityHeaderActions({ subpageHref, onClose }: EntityHeaderActionsProps) {
  return (
    <div className="flex items-center gap-1">
      <Link
        href={subpageHref}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        title="Open this entity as its own page"
      >
        Open as page ↗
      </Link>
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
