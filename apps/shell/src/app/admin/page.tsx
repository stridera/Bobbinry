'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { SiteNav } from '@/components/SiteNav'

interface Stats {
  totalUsers: number
  totalProjects: number
  signupsLast7d: number
  signupsLast30d: number
  badgeCounts: Record<string, number>
}

export default function AdminDashboard() {
  const { data: session } = useSession()
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session?.apiToken) return

    apiFetch('/api/admin/stats', session.apiToken)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load stats')
        setStats(await res.json())
      })
      .catch((err) => setError(err.message))
  }, [session?.apiToken])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <SiteNav />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Admin Dashboard</h1>
          <div className="flex gap-2">
            <Link
              href="/admin/promo-codes"
              className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              Promo Codes
            </Link>
            <Link
              href="/admin/users"
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Manage Users
            </Link>
          </div>
        </div>

        {error && (
          <div className="p-4 mb-6 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg">
            {error}
          </div>
        )}

        {!stats && !error && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20 mb-3" />
                <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-16" />
              </div>
            ))}
          </div>
        )}

        {stats && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <StatCard label="Total Users" value={stats.totalUsers} />
              <StatCard label="Total Projects" value={stats.totalProjects} />
              <StatCard label="Signups (7d)" value={stats.signupsLast7d} />
              <StatCard label="Signups (30d)" value={stats.signupsLast30d} />
            </div>

            {Object.keys(stats.badgeCounts).length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Badge Distribution</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {Object.entries(stats.badgeCounts).map(([badge, count]) => (
                    <div key={badge} className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{badge}</span>
                      <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value.toLocaleString()}</p>
    </div>
  )
}
