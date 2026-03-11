'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { ConfirmModal } from '@/components/ConfirmModal'
import { apiFetch } from '@/lib/api'

interface TrashedItem {
  id: string
  name: string
  description: string | null
  coverImage?: string | null
  deletedAt: string
  autoDeleteAt: string
  type: 'project' | 'collection'
}

interface TrashData {
  projects: TrashedItem[]
  collections: TrashedItem[]
}

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

export function TrashContent({ apiToken }: { apiToken: string }) {
  const [data, setData] = useState<TrashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TrashedItem | null>(null)

  useEffect(() => {
    loadTrash()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiToken])

  const loadTrash = async () => {
    try {
      const res = await apiFetch('/api/users/me/trash', apiToken)
      if (res.ok) {
        setData(await res.json())
      }
    } catch (error) {
      console.error('Failed to load trash:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRestore = async (type: 'project' | 'collection', id: string) => {
    setActionLoading(id)
    try {
      const endpoint = type === 'project'
        ? `/api/projects/${id}/restore`
        : `/api/collections/${id}/restore`
      const res = await apiFetch(endpoint, apiToken, { method: 'PUT' })
      if (res.ok) {
        loadTrash()
      }
    } catch (error) {
      console.error('Failed to restore:', error)
    } finally {
      setActionLoading(null)
    }
  }

  const handlePermanentDelete = async (item: TrashedItem) => {
    setActionLoading(item.id)
    try {
      const endpoint = item.type === 'project'
        ? `/api/projects/${item.id}/permanent`
        : `/api/collections/${item.id}/permanent`
      const res = await apiFetch(endpoint, apiToken, { method: 'DELETE' })
      if (res.ok || res.status === 204) {
        loadTrash()
      }
    } catch (error) {
      console.error('Failed to permanently delete:', error)
    } finally {
      setActionLoading(null)
      setDeleteTarget(null)
    }
  }

  const allItems = useMemo<TrashedItem[]>(() =>
    [...(data?.projects || []), ...(data?.collections || [])]
      .sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime()),
    [data]
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard"
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Trash</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Items are automatically deleted after 30 days
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>
        ) : allItems.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400">Trash is empty</p>
          </div>
        ) : (
          <div className="space-y-3">
            {allItems.map((item) => {
              const days = daysUntil(item.autoDeleteAt)
              const isLoading = actionLoading === item.id

              return (
                <div
                  key={`${item.type}-${item.id}`}
                  className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">{item.name}</h3>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        item.type === 'project'
                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                          : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                      }`}>
                        {item.type}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      Deleted {new Date(item.deletedAt).toLocaleDateString()}
                      {' · '}
                      <span className={days <= 7 ? 'text-red-500 dark:text-red-400 font-medium' : ''}>
                        Auto-deletes in {days} day{days !== 1 ? 's' : ''}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleRestore(item.type, item.id)}
                      disabled={isLoading}
                      className="px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => setDeleteTarget(item)}
                      disabled={isLoading}
                      className="px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      Delete Forever
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!deleteTarget}
        title="Delete Permanently"
        description={deleteTarget ? `"${deleteTarget.name}" will be permanently deleted. This action cannot be undone.` : ''}
        confirmLabel="Delete Forever"
        variant="danger"
        loading={!!actionLoading}
        onConfirm={() => deleteTarget && handlePermanentDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
