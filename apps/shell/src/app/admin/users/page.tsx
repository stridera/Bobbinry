'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { SiteNav } from '@/components/SiteNav'
import { useToast } from '@/contexts/ToastContext'

const KNOWN_BADGES = ['owner', 'supporter', 'moderator', 'crowdfunder', 'beta_tester', 'contributor']

interface UserBadge {
  badge: string
  label: string | null
}

interface AdminMembership {
  tier: string
  status: string
  source: 'admin' | 'stripe'
}

interface AdminUser {
  id: string
  email: string
  name: string | null
  emailVerified: string | null
  createdAt: string
  username: string | null
  badges: UserBadge[]
  membership: AdminMembership | null
}

export default function AdminUsersPage() {
  const { data: session } = useSession()
  const { showError } = useToast()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const limit = 50

  const fetchUsers = useCallback(async () => {
    if (!session?.apiToken) return
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (search) params.set('search', search)

    try {
      const res = await apiFetch(`/api/admin/users?${params}`, session.apiToken)
      if (!res.ok) throw new Error('Failed to load users')
      const data = await res.json()
      setUsers(data.users)
      setTotal(data.total)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [session?.apiToken, page, search, limit])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearch(searchInput)
  }

  const addBadge = async (userId: string, badge: string) => {
    if (!session?.apiToken) return
    const res = await apiFetch(`/api/admin/users/${userId}/badges`, session.apiToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ badge }),
    })
    if (res.ok) {
      fetchUsers()
    } else {
      const data = await res.json().catch(() => null)
      showError(data?.error || 'Failed to add badge')
    }
  }

  const removeBadge = async (userId: string, badge: string) => {
    if (!session?.apiToken) return
    const res = await apiFetch(`/api/admin/users/${userId}/badges/${encodeURIComponent(badge)}`, session.apiToken, {
      method: 'DELETE',
    })
    if (res.ok) {
      fetchUsers()
    } else {
      const data = await res.json().catch(() => null)
      showError(data?.error || 'Failed to remove badge')
    }
  }

  const toggleSupporter = async (userId: string, grant: boolean) => {
    if (!session?.apiToken) return
    const res = await apiFetch(`/api/admin/users/${userId}/supporter`, session.apiToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant }),
    })
    if (res.ok) {
      fetchUsers()
    } else {
      const data = await res.json().catch(() => null)
      showError(data?.error || `Failed to ${grant ? 'grant' : 'revoke'} supporter`)
    }
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <SiteNav />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/admin"
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            &larr; Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Users</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">({total})</span>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by email, name, or username..."
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Search
            </button>
            {search && (
              <button
                type="button"
                onClick={() => { setSearchInput(''); setSearch(''); setPage(1) }}
                className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </form>

        {error && (
          <div className="p-4 mb-6 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg">
            {error}
          </div>
        )}

        {/* User list */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">Loading...</div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">No users found</div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {users.map((user) => (
                <div key={user.id}>
                  <div
                    className="px-4 py-3 flex items-center gap-4 hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer transition-colors"
                    onClick={() => setExpandedUser(expandedUser === user.id ? null : user.id)}
                  >
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full bg-blue-600 dark:bg-blue-700 flex items-center justify-center text-white font-medium text-sm flex-shrink-0">
                      {(user.name || user.email).charAt(0).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {user.name || 'Unnamed'}
                        </span>
                        {user.username && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">@{user.username}</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user.email}</p>
                    </div>

                    {/* Badges */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {user.badges.map((b) => (
                        <span
                          key={b.badge}
                          className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                        >
                          {b.badge}
                        </span>
                      ))}
                    </div>

                    {/* Status + date */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {user.emailVerified ? (
                        <span className="w-2 h-2 rounded-full bg-green-500" title="Verified" />
                      ) : (
                        <span className="w-2 h-2 rounded-full bg-yellow-500" title="Unverified" />
                      )}
                      <span className="text-xs text-gray-400 dark:text-gray-500 w-20 text-right">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </span>
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${expandedUser === user.id ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* Expanded user management */}
                  {expandedUser === user.id && (
                    <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/20 border-t border-gray-100 dark:border-gray-700 space-y-3">
                      {/* Supporter status */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mr-1">Supporter:</span>
                        {user.membership?.tier === 'supporter' && user.membership.status === 'active' ? (
                          user.membership.source === 'stripe' ? (
                            <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                              Active (Stripe)
                            </span>
                          ) : (
                            <>
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                                Active (admin-granted)
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleSupporter(user.id, false) }}
                                className="px-2 py-1 text-xs font-medium rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                              >
                                Revoke
                              </button>
                            </>
                          )
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleSupporter(user.id, true) }}
                            className="px-2 py-1 text-xs font-medium rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
                          >
                            Grant Supporter
                          </button>
                        )}
                      </div>

                      {/* Badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mr-1">Badges:</span>
                        {user.badges.map((b) => (
                          <span
                            key={b.badge}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                          >
                            {b.badge}
                            <button
                              onClick={(e) => { e.stopPropagation(); removeBadge(user.id, b.badge) }}
                              className="ml-0.5 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                              title={`Remove ${b.badge}`}
                            >
                              &times;
                            </button>
                          </span>
                        ))}

                        {/* Add badge dropdown — supporter managed via toggle above */}
                        <select
                          className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 outline-none"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              addBadge(user.id, e.target.value)
                              e.target.value = ''
                            }
                          }}
                        >
                          <option value="">+ Add badge</option>
                          {KNOWN_BADGES
                            .filter((b) => b !== 'supporter' && !user.badges.some((ub) => ub.badge === b))
                            .map((b) => (
                              <option key={b} value={b}>{b}</option>
                            ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
