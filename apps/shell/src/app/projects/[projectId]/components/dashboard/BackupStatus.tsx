'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'

interface BackupStatusData {
  connection: {
    connected: boolean
    provider?: string
    driveEmail?: string | null
    rootFolderName?: string | null
  }
  projects: Array<{
    id: string
    name: string
    isBackedUp: boolean
    lastSyncedAt: string | null
    lastSyncStatus: string | null
    lastSyncError: string | null
    chapterCount: number
  }>
}

export function BackupStatus({ projectId }: { projectId: string }) {
  const { data: session } = useSession()
  const [status, setStatus] = useState<BackupStatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const apiToken = session?.apiToken

  const loadStatus = useCallback(async () => {
    if (!apiToken) return
    try {
      const res = await apiFetch('/api/backups/status', apiToken)
      if (res.ok) {
        setStatus(await res.json())
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [apiToken])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  if (loading || !status?.connection?.connected) {
    return null // Don't show card if no backup connection
  }

  const project = status.projects.find(p => p.id === projectId)
  const isBackedUp = project?.isBackedUp ?? true

  const handleSyncNow = async () => {
    if (!apiToken) return
    setSyncing(true)
    setMessage(null)
    try {
      const res = await apiFetch(`/api/backups/projects/${projectId}/sync`, apiToken, {
        method: 'POST',
      })
      if (res.ok) {
        const data = await res.json()
        setMessage({
          type: 'success',
          text: `Synced ${data.succeeded} of ${data.total} chapters`,
        })
        await loadStatus()
      } else {
        const err = await res.json().catch(() => ({}))
        setMessage({ type: 'error', text: err.error || 'Sync failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to sync' })
    } finally {
      setSyncing(false)
    }
  }

  const handleToggle = async () => {
    if (!apiToken) return
    try {
      await apiFetch(`/api/backups/projects/${projectId}`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isBackedUp }),
      })
      await loadStatus()
    } catch {
      setMessage({ type: 'error', text: 'Failed to update' })
    }
  }

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <h3 className="font-display font-semibold text-gray-900 dark:text-gray-100">Backup</h3>
        </div>
        <Link
          href="/backups"
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          Manage
        </Link>
      </div>
      <div className="px-6 py-4 space-y-3">
        {message && (
          <div
            className={`p-2 rounded text-xs ${
              message.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${isBackedUp ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className="text-gray-700 dark:text-gray-300">
              {isBackedUp ? 'Google Drive' : 'Backup disabled'}
            </span>
            {status.connection.driveEmail && isBackedUp && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                ({status.connection.driveEmail})
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isBackedUp && (
              <button
                onClick={handleSyncNow}
                disabled={syncing}
                className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            )}
            <button
              onClick={handleToggle}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                isBackedUp
                  ? 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  : 'text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/10'
              }`}
            >
              {isBackedUp ? 'Opt Out' : 'Enable'}
            </button>
          </div>
        </div>

        {project?.lastSyncedAt && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Last sync: {new Date(project.lastSyncedAt).toLocaleString()}
            {project.lastSyncStatus && (
              <span
                className={`ml-1 ${
                  project.lastSyncStatus === 'success'
                    ? 'text-green-600 dark:text-green-400'
                    : project.lastSyncStatus === 'failed'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-yellow-600 dark:text-yellow-400'
                }`}
              >
                ({project.lastSyncStatus})
              </span>
            )}
          </p>
        )}

        {project?.lastSyncError && project.lastSyncStatus === 'failed' && (
          <p className="text-xs text-red-500 dark:text-red-400">{project.lastSyncError}</p>
        )}
      </div>
    </section>
  )
}
