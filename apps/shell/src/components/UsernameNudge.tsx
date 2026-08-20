'use client'

import Link from 'next/link'

/**
 * Shown on publishing pages when the author has no username set.
 * Without one, reader URLs fall back to the author's UUID, which is
 * unstable for sharing and excluded from the public sitemap.
 */
export function UsernameNudge({ className = '' }: { className?: string }) {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200 ${className}`}
    >
      <p>
        <span className="font-medium">Set a username to be discoverable.</span>{' '}
        Your published work currently uses an ID-based link; a username gives you a clean, permanent
        reader URL and includes your work in search engine sitemaps.
      </p>
      <Link
        href="/settings"
        className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-amber-950"
      >
        Choose a username
      </Link>
    </div>
  )
}
