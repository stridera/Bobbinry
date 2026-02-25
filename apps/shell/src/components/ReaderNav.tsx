'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { UserMenu } from './UserMenu'

interface Crumb {
  label: string
  href?: string
}

interface ReaderNavProps {
  /** Breadcrumb trail — last item is current page (no link) */
  crumbs?: Crumb[]
  /** Override colors for themed reader (chapter page) */
  themed?: {
    bg: string
    border: string
    text: string
    muted: string
    hover: string
  }
}

/**
 * Unified navigation for all /read/* pages.
 * Shows: Wordmark | Breadcrumbs | UserMenu
 *
 * Replaces the fragmented back-buttons and missing navs across
 * the reader experience with a consistent, slim breadcrumb bar.
 */
export function ReaderNav({ crumbs = [], themed }: ReaderNavProps) {
  const { data: session } = useSession()

  // Default (follows document dark mode)
  const bg = themed?.bg ?? 'bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm'
  const border = themed?.border ?? 'border-gray-200 dark:border-gray-700'
  const text = themed?.text ?? 'text-gray-900 dark:text-gray-100'
  const muted = themed?.muted ?? 'text-gray-500 dark:text-gray-400'
  const hover = themed?.hover ?? 'hover:text-gray-900 dark:hover:text-gray-100'

  return (
    <nav className={`h-11 ${bg} border-b ${border} sticky top-0 z-40`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
        {/* Left: Wordmark + breadcrumbs */}
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <Link
            href={session ? '/dashboard' : '/'}
            className={`font-display text-base font-bold ${text} tracking-tight flex-shrink-0`}
          >
            Bobbinry
          </Link>

          {crumbs.length > 0 && (
            <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
              {crumbs.map((crumb, i) => {
                const isLast = i === crumbs.length - 1
                return (
                  <div key={i} className="flex items-center gap-1.5 min-w-0">
                    <span className={`${muted} text-xs flex-shrink-0`}>/</span>
                    {isLast || !crumb.href ? (
                      <span className={`text-sm ${isLast ? text : muted} truncate font-medium`}>
                        {crumb.label}
                      </span>
                    ) : (
                      <Link
                        href={crumb.href}
                        className={`text-sm ${muted} ${hover} truncate transition-colors`}
                      >
                        {crumb.label}
                      </Link>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: Explore link + user */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <Link
            href="/explore"
            className={`text-sm ${muted} ${hover} transition-colors hidden sm:block`}
          >
            Explore
          </Link>
          {session?.user ? (
            <UserMenu user={session.user as { id: string; email: string; name?: string | null }} />
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className={`text-sm ${muted} ${hover} transition-colors`}
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="px-3 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
              >
                Join
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
