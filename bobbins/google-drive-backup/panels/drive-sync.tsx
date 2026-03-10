'use client'

/**
 * Google Drive Backup Panel
 *
 * Shown on the project dashboard via shell.projectBackup slot.
 * Uses the user-scoped /backups API routes.
 * Three states:
 *   1. Not connected — "Connect Google Drive" button
 *   2. Connected — status, folder, sync controls, opt-out toggle
 *   3. Error — error message, retry button
 */

import { useState, useEffect, useCallback } from 'react'

interface DriveSyncPanelProps {
  projectId: string
  apiToken?: string
  context?: {
    projectId: string
    apiToken?: string
  }
}

interface BackupStatus {
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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100'

function authFetch(path: string, apiToken: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${apiToken}` },
  })
}

export default function DriveSyncPanel(props: DriveSyncPanelProps) {
  const projectId = props.projectId || props.context?.projectId
  const apiToken = props.apiToken || props.context?.apiToken

  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadStatus = useCallback(async () => {
    if (!apiToken) return
    try {
      const res = await authFetch('/api/backups/status', apiToken)
      if (res.ok) {
        setStatus(await res.json())
      }
    } catch (err) {
      console.error('Failed to load backup status:', err)
    } finally {
      setLoading(false)
    }
  }, [apiToken])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const handleConnect = async () => {
    if (!apiToken) return
    try {
      const res = await authFetch('/api/backups/google-drive/authorize', apiToken)
      if (res.ok) {
        const { url } = await res.json()
        window.location.href = url
      } else {
        const data = await res.json().catch(() => ({}))
        setMessage({ type: 'error', text: data.error || 'Failed to start authorization' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to connect to server' })
    }
  }

  const handleSyncNow = async () => {
    if (!projectId || !apiToken) return
    setSyncing(true)
    setMessage(null)
    try {
      const res = await authFetch(
        `/api/backups/projects/${projectId}/sync`,
        apiToken,
        { method: 'POST' }
      )
      if (res.ok) {
        const data = await res.json()
        setMessage({
          type: 'success',
          text: `Synced ${data.succeeded || 0} of ${data.total || 0} chapters`,
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

  const handleToggle = async (isActive: boolean) => {
    if (!projectId || !apiToken) return
    try {
      await authFetch(`/api/backups/projects/${projectId}`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      await loadStatus()
    } catch {
      setMessage({ type: 'error', text: 'Failed to update backup setting' })
    }
  }

  if (loading) {
    return (
      <div className="px-5 py-4">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-32" />
          <div className="h-8 bg-gray-100 dark:bg-gray-800 rounded" />
        </div>
      </div>
    )
  }

  const connected = status?.connection?.connected
  const projectData = status?.projects?.find(p => p.id === projectId)

  // Not connected — show connect button
  if (!connected) {
    return (
      <div className="px-5 py-4 space-y-3">
        <Header />

        {message && (
          <div className="p-2 rounded text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
            {message.text}
          </div>
        )}

        <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
            <span className="text-gray-500 dark:text-gray-400">Not connected</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Connect Google Drive to automatically back up all your projects. Set up once, and every project is covered.
          </p>
        </div>

        <button
          onClick={handleConnect}
          className="w-full px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
        >
          Connect Google Drive
        </button>
      </div>
    )
  }

  // Connected — show project-specific status
  const isBackedUp = projectData?.isBackedUp ?? true
  const lastSyncError = projectData?.lastSyncError

  // Error state
  if (lastSyncError && projectData?.lastSyncStatus === 'failed') {
    return (
      <div className="px-5 py-4 space-y-3">
        <Header />
        <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            <span className="text-red-700 dark:text-red-400 font-medium">Sync Error</span>
          </div>
          <p className="text-xs text-red-600 dark:text-red-400">{lastSyncError}</p>
        </div>
        <button
          onClick={handleSyncNow}
          disabled={syncing}
          className="w-full px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {syncing ? 'Syncing...' : 'Retry Sync'}
        </button>
      </div>
    )
  }

  return (
    <div className="px-5 py-4 space-y-3">
      <Header />

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

      <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${isBackedUp ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className={`font-medium ${isBackedUp ? 'text-green-700 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
              {isBackedUp ? 'Backup Active' : 'Backup Disabled'}
            </span>
            {status?.connection?.driveEmail && (
              <span className="text-gray-400 dark:text-gray-500">({status.connection.driveEmail})</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {isBackedUp && (
              <button
                onClick={handleSyncNow}
                disabled={syncing}
                className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            )}
            <button
              onClick={() => handleToggle(!isBackedUp)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                isBackedUp
                  ? 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  : 'text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/10'
              }`}
            >
              {isBackedUp ? 'Opt Out' : 'Enable'}
            </button>
          </div>
        </div>
        {status?.connection?.rootFolderName && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Folder: <span className="font-medium text-gray-700 dark:text-gray-300">{status.connection.rootFolderName}</span>
          </p>
        )}
        {projectData?.lastSyncedAt && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Last sync: {new Date(projectData.lastSyncedAt).toLocaleString()}
            {projectData.lastSyncStatus && (
              <span
                className={`ml-1.5 ${
                  projectData.lastSyncStatus === 'success'
                    ? 'text-green-600 dark:text-green-400'
                    : projectData.lastSyncStatus === 'failed'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-yellow-600 dark:text-yellow-400'
                }`}
              >
                ({projectData.lastSyncStatus})
              </span>
            )}
          </p>
        )}
      </div>

      <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight">
        One-way backup sync. Content in Drive is auto-updated — edits made in Drive will be overwritten.
      </p>
    </div>
  )
}

function Header() {
  return (
    <div className="flex items-center justify-between">
      <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <svg className="w-4 h-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        Google Drive Backup
      </h4>
    </div>
  )
}
