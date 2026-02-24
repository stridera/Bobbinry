'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { useTheme } from '@/contexts/ThemeContext'

export default function SettingsPage() {
  const { data: session, status } = useSession()
  const { theme, setTheme } = useTheme()
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  if (!session?.user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
            <Link href="/dashboard" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
              Dashboard
            </Link>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-gray-900 dark:text-gray-100">Settings</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">User Settings</h1>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-fade-in">
        {/* Success message */}
        {success && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <p className="text-sm text-green-700 dark:text-green-300">{success}</p>
          </div>
        )}

        {/* Account Information */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Account Information</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Name
              </label>
              <input
                type="text"
                value={session.user.name || ''}
                disabled
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg cursor-not-allowed opacity-60"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={session.user.email || ''}
                disabled
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg cursor-not-allowed opacity-60"
              />
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Appearance</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Theme
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setTheme('light')}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                  theme === 'light'
                    ? 'border-blue-500 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-950/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                <span className="font-medium text-gray-900 dark:text-gray-100">Light</span>
              </button>

              <button
                onClick={() => setTheme('dark')}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                  theme === 'dark'
                    ? 'border-blue-500 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-950/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
                <span className="font-medium text-gray-900 dark:text-gray-100">Dark</span>
              </button>
            </div>
          </div>
        </div>

        {/* Notifications (placeholder) */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Notifications</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">
            Notification preferences will be available in a future update.
          </p>
        </div>
      </div>
    </div>
  )
}
