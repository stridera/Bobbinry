'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { UserMenu } from './UserMenu'

const NAV_LINKS = [
  { href: '/dashboard', label: 'Write' },
  { href: '/explore', label: 'Explore' },
  { href: '/marketplace', label: 'Bobbins' },
  { href: '/library', label: 'Library' },
]

export function SiteNav() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  return (
    <nav className="h-14 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
        {/* Wordmark */}
        <Link
          href={session ? '/dashboard' : '/'}
          className="font-display text-xl font-bold text-gray-900 dark:text-gray-100 tracking-tight flex-shrink-0"
        >
          Bobbinry
        </Link>

        {/* Center nav links - desktop */}
        {session ? (
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  isActive(link.href)
                    ? 'text-blue-700 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/30'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100/60 dark:hover:bg-gray-700/40'
                }`}
              >
                {link.label}
                {isActive(link.href) && (
                  <span className="block h-0.5 bg-blue-600 dark:bg-blue-400 rounded-full mt-0.5 -mb-1" />
                )}
              </Link>
            ))}
          </div>
        ) : (
          <div className="hidden md:flex items-center gap-1">
            <Link
              href="/explore"
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                isActive('/explore')
                  ? 'text-blue-700 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/30'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
              }`}
            >
              Explore
            </Link>
            <Link
              href="/marketplace"
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                isActive('/marketplace')
                  ? 'text-blue-700 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/30'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
              }`}
            >
              Bobbins
            </Link>
          </div>
        )}

        {/* Right side */}
        <div className="flex items-center gap-3">
          {session?.user ? (
            <UserMenu user={session.user as { id: string; email: string; name?: string | null }} />
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Get Started
              </Link>
            </div>
          )}

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-1.5 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50"
            aria-label="Toggle menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 animate-fade-in">
          <div className="px-4 py-3 space-y-1">
            {session ? (
              NAV_LINKS.map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={`block px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive(link.href)
                      ? 'text-blue-700 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/30'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                  }`}
                >
                  {link.label}
                </Link>
              ))
            ) : (
              <>
                <Link
                  href="/explore"
                  onClick={() => setMobileOpen(false)}
                  className="block px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 rounded-md"
                >
                  Explore
                </Link>
                <Link
                  href="/marketplace"
                  onClick={() => setMobileOpen(false)}
                  className="block px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 rounded-md"
                >
                  Bobbins
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
